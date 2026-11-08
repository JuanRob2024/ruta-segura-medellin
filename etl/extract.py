"""EXTRACT — descarga automática de todas las fuentes (MEData, GeoMedellín, datos.gov.co, SIATA).

Estrategia (de más estable a menos):
  1. API JSON (DKAN de MEData / ArcGIS REST / Socrata de datos.gov.co / SIATA) con `requests`;
     la descarga directa reanuda con `Range` si la conexión se corta.
  2. Si la API de metadatos de MEData cambia, fallback a Selenium: renderiza la página
     del dataset (es una SPA en React) y lee el enlace de descarga del DOM.
  3. Si la descarga del CSV falla, fallback al datastore SQL paginado de DKAN.

Es incremental: solo vuelve a bajar un archivo si cambió su fecha `modified`,
su ETag/Content-Length o si se fuerza con --force.
"""
from __future__ import annotations

import csv
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from urllib.parse import quote

from .common import Manifest, Timer, http_session, now_utc

log = logging.getLogger("etl.extract")


# --------------------------------------------------------------------------- MEData
class MEDataClient:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.base = cfg["medata"]["base_url"].rstrip("/")
        self.s = http_session(cfg)
        self.timeout = cfg["http"]["timeout_s"]

    def metadata(self, dataset_id: str) -> dict:
        try:
            r = self.s.get(f"{self.base}/api/dataset-fast/{dataset_id}", timeout=self.timeout)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            log.warning("API de metadatos falló (%s); intento con Selenium", e)
            return self._metadata_selenium(dataset_id)

    def _metadata_selenium(self, dataset_id: str) -> dict:
        """Fallback: abre la página con Chrome headless y extrae el link .csv."""
        from selenium import webdriver
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.support.ui import WebDriverWait

        opts = webdriver.ChromeOptions()
        opts.add_argument("--headless=new")
        drv = webdriver.Chrome(options=opts)
        try:
            drv.get(f"{self.base}/dataset/{dataset_id}")
            WebDriverWait(drv, 40).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "a[href$='.csv']"))
            )
            links = [a.get_attribute("href") for a in drv.find_elements(By.CSS_SELECTOR, "a[href$='.csv']")]
            title = drv.title.replace("Dataset - ", "").replace(" - Medata", "")
        finally:
            drv.quit()
        return {
            "title": title,
            "modified": None,
            "distribution": [{"identifier": None, "data": {"format": "csv", "downloadURL": u}} for u in links],
        }

    @staticmethod
    def _csv_distribution(meta: dict) -> dict:
        for d in meta.get("distribution", []):
            data = d.get("data", {})
            if str(data.get("format", "")).lower() == "csv":
                return {"resource_id": d.get("identifier"), **data}
        raise ValueError(f"El dataset '{meta.get('title')}' no tiene distribución CSV")

    def download(self, name: str, dataset_id: str, raw_dir: Path, manifest: Manifest, force=False) -> Path:
        meta = self.metadata(dataset_id)
        dist = self._csv_distribution(meta)
        url = dist["downloadURL"].replace("http://", "https://")
        out_dir = raw_dir / name
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"{name}.csv"
        (out_dir / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

        prev = manifest.get(f"medata:{name}")
        head = {}
        try:
            h = self.s.head(url, timeout=self.timeout, allow_redirects=True)
            head = {"etag": h.headers.get("ETag"), "length": h.headers.get("Content-Length")}
        except Exception:  # noqa: BLE001
            pass
        unchanged = (
            out.exists()
            and prev.get("modified") == meta.get("modified")
            and prev.get("url") == url
            and (not head.get("length") or prev.get("length") == head.get("length"))
        )
        if unchanged and not force:
            log.info("[%s] sin cambios en la fuente (modified=%s) → se omite descarga", name, meta.get("modified"))
            return out

        with Timer(f"[{name}] descarga {url}"):
            try:
                self._stream(url, out)
            except Exception as e:  # noqa: BLE001
                log.warning("[%s] descarga directa falló (%s) → datastore SQL paginado", name, e)
                self._datastore_dump(dist["resource_id"], out)

        manifest.update(
            f"medata:{name}", dataset_id=dataset_id, title=meta.get("title"), url=url,
            modified=meta.get("modified"), periodicity=meta.get("accrualPeriodicity"),
            bytes=out.stat().st_size, extracted_at=now_utc(), **head,
        )
        return out

    def _stream(self, url: str, out: Path, intentos: int = 4) -> None:
        """Descarga en streaming; si la conexión se corta, reanuda con `Range` desde el último byte."""
        tmp = out.with_suffix(".part")
        tmp.unlink(missing_ok=True)
        for i in range(1, intentos + 1):
            pos = tmp.stat().st_size if tmp.exists() else 0
            headers = {"Range": f"bytes={pos}-"} if pos else {}
            try:
                expected = None
                with self.s.get(url, stream=True, timeout=self.timeout, headers=headers) as r:
                    r.raise_for_status()
                    if pos and r.status_code != 206:  # el servidor no soporta Range → empezar de cero
                        pos = 0
                    cr = r.headers.get("Content-Range", "")
                    if "/" in cr and cr.rsplit("/", 1)[1].isdigit():
                        expected = int(cr.rsplit("/", 1)[1])
                    elif not pos and r.headers.get("Content-Length", "").isdigit():
                        expected = int(r.headers["Content-Length"])
                    with open(tmp, "ab" if pos else "wb") as f:
                        for chunk in r.iter_content(1 << 20):
                            f.write(chunk)
                if expected and tmp.stat().st_size < expected:
                    raise IOError(f"descarga incompleta ({tmp.stat().st_size} de {expected} bytes)")
                tmp.replace(out)
                return
            except Exception as e:  # noqa: BLE001
                if i == intentos:
                    raise
                log.warning("  corte en la descarga (%s); reintento %d/%d reanudando en %s bytes",
                            e, i, intentos - 1, tmp.stat().st_size if tmp.exists() else 0)
                time.sleep(3 * i)

    def _datastore_dump(self, resource_id: str, out: Path, page: int = 5000) -> None:
        """Descarga vía /api/1/datastore/sql con paginación LIMIT/OFFSET."""
        offset, first = 0, True
        with open(out, "w", encoding="utf-8", newline="") as f:
            w = None
            while True:
                q = f"[SELECT * FROM {resource_id}][LIMIT {page} OFFSET {offset}];"
                r = self.s.get(f"{self.base}/api/1/datastore/sql/?query={quote(q)}&show-db-columns",
                               timeout=self.timeout)
                r.raise_for_status()
                rows = r.json()
                if not rows:
                    break
                if first:
                    w = csv.DictWriter(f, fieldnames=[c for c in rows[0] if c != "record_number"],
                                       extrasaction="ignore")
                    w.writeheader()
                    first = False
                w.writerows(rows)
                offset += page
                if offset % 50_000 == 0:
                    log.info("  datastore: %s filas", offset)


# --------------------------------------------------------------------------- ArcGIS
class ArcGISClient:
    def __init__(self, cfg: dict):
        self.base = cfg["arcgis"]["base_url"].rstrip("/")
        self.s = http_session(cfg)
        self.timeout = cfg["http"]["timeout_s"]

    def layer_geojson(self, path: str, simplify: float | None = None, page: int = 1000) -> dict:
        feats, offset = [], 0
        while True:
            params = {
                "where": "1=1", "outFields": "*", "outSR": 4326, "f": "geojson",
                "resultOffset": offset, "resultRecordCount": page,
            }
            if simplify:
                params |= {"maxAllowableOffset": simplify, "geometryPrecision": 6}
            r = self.s.get(f"{self.base}/{path}/query", params=params, timeout=self.timeout)
            r.raise_for_status()
            gj = r.json()
            batch = gj.get("features", [])
            feats += batch
            if len(batch) < page and not gj.get("exceededTransferLimit"):
                break
            offset += page
        return {"type": "FeatureCollection", "features": feats}

    def download(self, name: str, spec: dict, raw_dir: Path, manifest: Manifest) -> Path:
        out = raw_dir / "arcgis" / f"{name}.geojson"
        out.parent.mkdir(parents=True, exist_ok=True)
        with Timer(f"[{name}] ArcGIS {spec['path']}"):
            gj = self.layer_geojson(spec["path"], spec.get("simplify"))
        out.write_text(json.dumps(gj, ensure_ascii=False), encoding="utf-8")
        manifest.update(f"arcgis:{name}", path=spec["path"], features=len(gj["features"]), extracted_at=now_utc())
        log.info("[%s] %d elementos", name, len(gj["features"]))
        return out


# --------------------------------------------------------------------------- Lluvia (datos.gov.co · IDEAM)
SOQL_HORA = ("date_trunc_ymd(fechaobservacion) as dia, date_extract_hh(fechaobservacion) as h, "
             "sum(valorobservado) as mm, count(*) as n")


def extract_lluvia(cfg: dict, raw_dir: Path, manifest: Manifest, force=False) -> Path:
    """Lluvia horaria por estación desde datos.gov.co (dataset IDEAM s54a-sgyg).

    El dataset tiene una fila cada 10 min por estación (cientos de millones de filas en el país), así que
    se pide YA agregado por hora con SoQL y año por año. Los años cerrados se guardan y no se vuelven a pedir.
    """
    c = cfg["lluvia"]
    s = http_session(cfg)
    out_dir = raw_dir / "lluvia"
    out_dir.mkdir(parents=True, exist_ok=True)
    hoy = date.today()
    tareas = []
    for cod in c["estaciones"]:
        for year in range(int(c["desde"]), hoy.year + 1):
            f = out_dir / f"{cod}_{year}.json"
            if f.exists() and year < hoy.year and not force:
                continue
            tareas.append((cod, year, f))

    def bajar(t):
        cod, year, f = t
        params = {
            "$select": SOQL_HORA,
            "$where": f"codigoestacion='{cod}' AND fechaobservacion between "
                      f"'{year}-01-01T00:00:00' and '{year}-12-31T23:59:59'",
            "$group": "dia,h", "$order": "dia,h", "$limit": 50000,
        }
        for i in range(3):
            try:
                r = s.get(c["url"], params=params, timeout=c.get("timeout_s", 180))
                r.raise_for_status()
                rows = r.json()
                f.write_text(json.dumps(rows), encoding="utf-8")
                return cod, year, len(rows)
            except Exception as e:  # noqa: BLE001
                if i == 2:
                    log.error("[lluvia] %s %s falló: %s", cod, year, e)
                    return cod, year, -1
                time.sleep(5 * (i + 1))

    with ThreadPoolExecutor(max_workers=c.get("hilos", 4)) as ex:
        for cod, year, n in ex.map(bajar, tareas):
            if n >= 0:
                log.info("[lluvia] estación %s año %s: %s horas con dato", cod, year, f"{n:,}")
    manifest.update("lluvia", fuente=c["url"], estaciones=list(c["estaciones"]), extracted_at=now_utc())
    return out_dir


def extract_siata(cfg: dict, raw_dir: Path, manifest: Manifest) -> Path:
    """Foto del inventario de pluviómetros SIATA (la web consulta los valores en vivo)."""
    s = http_session(cfg)
    out = raw_dir / "siata" / "pluviometros.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    r = s.get(cfg["siata"]["pluviometros_url"], timeout=60)
    r.raise_for_status()
    out.write_text(r.text, encoding="utf-8")
    n = len(r.json().get("estaciones", []))
    manifest.update("siata", url=cfg["siata"]["pluviometros_url"], estaciones=n, extracted_at=now_utc())
    log.info("[siata] %d pluviómetros en el inventario", n)
    return out


# --------------------------------------------------------------------------- Orquestación
def run_extract(cfg: dict, only: list[str] | None = None, force=False) -> dict:
    raw = cfg["paths"]["raw"]
    manifest = Manifest(raw / "_manifest.json")
    results = {}

    md = MEDataClient(cfg)
    for name, spec in cfg["medata"]["datasets"].items():
        if not spec.get("enabled", True) or (only and name not in only):
            continue
        try:
            results[name] = md.download(name, spec["id"], raw, manifest, force=force)
        except Exception as e:  # noqa: BLE001
            log.error("[%s] ERROR en extracción: %s", name, e)

    gis = ArcGISClient(cfg)
    for name, spec in cfg["arcgis"]["layers"].items():
        if only and name not in only and "arcgis" not in only:
            continue
        try:
            results[name] = gis.download(name, spec, raw, manifest)
        except Exception as e:  # noqa: BLE001
            log.error("[%s] ERROR en extracción ArcGIS: %s", name, e)

    if not only or "lluvia" in only:
        try:
            results["lluvia"] = extract_lluvia(cfg, raw, manifest, force=force)
        except Exception as e:  # noqa: BLE001
            log.error("[lluvia] ERROR: %s", e)
    if not only or "siata" in only:
        try:
            results["siata"] = extract_siata(cfg, raw, manifest)
        except Exception as e:  # noqa: BLE001
            log.error("[siata] ERROR: %s", e)
    return results
