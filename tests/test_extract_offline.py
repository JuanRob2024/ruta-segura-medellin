"""Pruebas de EXTRACT y del colector de cámaras sin red (respuestas simuladas)."""
import io
import json
from pathlib import Path

import pandas as pd
from PIL import Image

from etl.camaras import Collector
from etl.common import Manifest, load_config
from etl.extract import ArcGISClient, MEDataClient


class FakeResp:
    def __init__(self, status=200, content=b"", js=None, headers=None):
        self.status_code, self.content, self._js = status, content, js
        self.headers = headers or {}

    def json(self):
        return self._js

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)

    def iter_content(self, n):
        yield self.content

    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass


def _cfg(tmp_path):
    txt = (Path(__file__).parents[1] / "config.yaml").read_text(encoding="utf-8")
    (tmp_path / "config.yaml").write_text(txt.replace("data/", f"{tmp_path.as_posix()}/data/"), encoding="utf-8")
    return load_config(tmp_path / "config.yaml")


def test_medata_incremental(tmp_path):
    cfg = _cfg(tmp_path)
    meta = {"title": "Víctimas", "modified": "02-03-2025", "distribution": [
        {"identifier": "abc", "data": {"format": "csv",
                                       "downloadURL": "http://medata.app.medellin.gov.co/x/Mede_Victimas_inci.csv"}}]}
    calls = []

    class S:
        def get(self, url, **kw):
            calls.append(url)
            if "dataset-fast" in url:
                return FakeResp(js=meta)
            return FakeResp(content=b"Gravedad_victima\nHeridos\n")

        def head(self, url, **kw):
            return FakeResp(headers={"Content-Length": "25"})

    c = MEDataClient(cfg)
    c.s = S()
    man = Manifest(cfg["paths"]["raw"] / "_manifest.json")
    out = c.download("victimas", "1-023-25-000360", cfg["paths"]["raw"], man)
    assert out.read_text().startswith("Gravedad_victima")
    assert any(u.startswith("https://medata") and u.endswith(".csv") for u in calls)  # forzado a https
    n = len(calls)
    c.download("victimas", "1-023-25-000360", cfg["paths"]["raw"], man)  # sin cambios → no descarga
    assert len(calls) == n + 1  # solo la consulta de metadatos


def test_arcgis_paginacion(tmp_path):
    cfg = _cfg(tmp_path)
    pages = [{"features": [{"properties": {"i": i}} for i in range(1000)], "exceededTransferLimit": True},
             {"features": [{"properties": {"i": 1000}}]}]

    class S:
        def get(self, url, params=None, **kw):
            return FakeResp(js=pages.pop(0))

    g = ArcGISClient(cfg)
    g.s = S()
    assert len(g.layer_geojson("x/MapServer/2")["features"]) == 1001


def test_colector_camaras(tmp_path):
    cfg = _cfg(tmp_path)
    buf = io.BytesIO()
    Image.effect_noise((1280, 720), 60).convert("RGB").save(buf, "JPEG", quality=90)
    jpg = buf.getvalue()
    pd.DataFrame({"id_camara": ["CCTV-8", "CCTV-9", "CCTV-10"], "tipo_camara": "CCTV", "nombre": "x",
                  "url_snapshot": [f"https://www.medellin.gov.co/simm/camaras-cctv/imagen{n}.jpg" for n in (8, 9, 10)]}
                 ).to_parquet(cfg["paths"]["clean"] / "dim_camara.parquet")

    class S:
        headers = {}

        def get(self, url, **kw):
            if "imagen9" in url:
                return FakeResp(content=b"x" * 500, headers={"Content-Type": "image/jpeg"})  # sin señal
            if "imagen10" in url:
                return FakeResp(status=404, headers={"Content-Type": "text/html"})
            return FakeResp(content=jpg, headers={"Content-Type": "image/jpeg"})

    col = Collector(cfg)
    col.s = S()
    r1 = col.ronda().set_index("id_camara")["estado"]
    assert r1.to_dict() == {"CCTV-8": "ok", "CCTV-9": "sin_senal", "CCTV-10": "error"}
    r2 = col.ronda().set_index("id_camara")["estado"]
    assert r2["CCTV-8"] == "congelada"                       # misma imagen que la ronda anterior
    assert list((cfg["paths"]["snapshots"]).rglob("*.jpg"))


# ------------------------------------------------------------------ fallos de extracción y respaldos
import pytest  # noqa: E402

from etl import respaldo  # noqa: E402
from etl.extract import DescargaRechazada, run_extract  # noqa: E402


def test_datastore_cortado_no_daña_la_copia_buena(tmp_path):
    """Si el respaldo paginado de MEData se corta, el archivo bueno queda intacto y no quedan temporales."""
    cfg = _cfg(tmp_path)
    out = tmp_path / "victimas.csv"
    out.write_text("a,b\n1,2\n", encoding="utf-8")
    pag = iter([FakeResp(js=[{"a": i, "b": i} for i in range(5000)]), FakeResp(status=503)])

    class S:
        def get(self, url, **kw):
            return next(pag)

    c = MEDataClient(cfg)
    c.s = S()
    with pytest.raises(RuntimeError):
        c._datastore_dump("recurso", out)
    assert out.read_text(encoding="utf-8") == "a,b\n1,2\n"
    assert not list(tmp_path.glob("*.part"))


def test_medata_rechaza_descarga_mucho_mas_pequeña(tmp_path):
    cfg = _cfg(tmp_path)
    raw = cfg["paths"]["raw"]
    (raw / "victimas").mkdir(parents=True)
    bueno = "g\n" + "x\n" * 100
    (raw / "victimas" / "victimas.csv").write_text(bueno, encoding="utf-8")
    man = Manifest(raw / "_manifest.json")
    man.update("medata:victimas", modified="viejo", filas=100)
    meta = {"title": "V", "modified": "nuevo", "distribution": [{"identifier": "r", "data": {"format": "csv", "downloadURL": "https://x/v.csv"}}]}

    class S:
        def get(self, url, **kw):
            return FakeResp(js=meta) if "dataset-fast" in url else FakeResp(content=b"g\nx\nx\nx\n")

        def head(self, url, **kw):
            return FakeResp()

    c = MEDataClient(cfg)
    c.s = S()
    with pytest.raises(DescargaRechazada):
        c.download("victimas", "id", raw, man)
    assert (raw / "victimas" / "victimas.csv").read_text(encoding="utf-8") == bueno   # se conserva la copia buena
    assert not list((raw / "victimas").glob("*.nuevo.csv"))
    assert man.get("medata:victimas")["modified"] == "viejo"                          # el manifiesto no avanza


def test_arcgis_capa_vacia_no_reemplaza_la_buena(tmp_path):
    cfg = _cfg(tmp_path)
    raw = cfg["paths"]["raw"]
    (raw / "arcgis").mkdir(parents=True)
    buena = json.dumps({"type": "FeatureCollection", "features": [{"properties": {}}] * 5})
    (raw / "arcgis" / "camaras_cctv.geojson").write_text(buena, encoding="utf-8")
    man = Manifest(raw / "_manifest.json")
    man.update("arcgis:camaras_cctv", features=5)

    class S:
        def get(self, url, params=None, **kw):
            return FakeResp(js={"features": []})

    g = ArcGISClient(cfg)
    g.s = S()
    with pytest.raises(DescargaRechazada):
        g.download("camaras_cctv", {"path": "x/MapServer/2"}, raw, man)
    assert (raw / "arcgis" / "camaras_cctv.geojson").read_text(encoding="utf-8") == buena


def test_respaldo_rota_y_restaura(tmp_path):
    cfg = _cfg(tmp_path)
    raw = cfg["paths"]["raw"]
    (raw / "victimas").mkdir(parents=True)
    f = raw / "victimas" / "victimas.csv"
    f.write_text("original", encoding="utf-8")
    for _ in range(4):
        respaldo.respaldar(cfg, forzar=True)
    assert len(respaldo.copias(cfg)) == cfg["respaldo"]["conservar"] == 3   # rota: se quedan las 3 más recientes
    assert respaldo.respaldar(cfg) == respaldo.copias(cfg)[0]                # < min_horas: no hace otra copia
    f.write_text("dañado", encoding="utf-8")
    respaldo.restaurar(cfg)
    assert f.read_text(encoding="utf-8") == "original"


def test_extraccion_con_fallos_queda_reportada_y_sale_con_codigo_2(tmp_path, monkeypatch):
    cfg = _cfg(tmp_path)

    def falla(*a, **k):
        raise ConnectionError("medata.app.medellin.gov.co no responde")

    monkeypatch.setattr(MEDataClient, "download", falla)
    resumen = run_extract(cfg, only=["victimas"])
    assert resumen["fallidas"] == ["medata:victimas"]
    assert resumen["fuentes"]["medata:victimas"]["estado"] == "error"
    rep = json.loads((cfg["paths"]["reports"] / "extraccion.json").read_text(encoding="utf-8"))
    assert rep["fallidas"] == ["medata:victimas"]
    from etl.__main__ import main
    assert main(["extract", "--only", "victimas", "--config", str(tmp_path / "config.yaml")]) == 2


def test_servidor_arcgis_caido_no_se_reintenta_capa_por_capa(tmp_path, monkeypatch):
    import requests
    cfg = _cfg(tmp_path)
    llamadas = []

    def caido(self, name, *a, **k):
        llamadas.append(name)
        raise requests.exceptions.ConnectionError("Max retries exceeded")

    monkeypatch.setattr(ArcGISClient, "download", caido)
    resumen = run_extract(cfg, only=["arcgis"])
    capas = [f"arcgis:{n}" for n in cfg["arcgis"]["layers"]]
    assert len(llamadas) == 1                                   # solo se intenta la primera capa
    assert sorted(resumen["fallidas"]) == sorted(capas)         # todas quedan reportadas
