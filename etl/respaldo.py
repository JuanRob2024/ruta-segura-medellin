"""Copias de respaldo de data/raw (la última copia buena de cada fuente).

* Antes de cada extracción se comprime data/raw en data/backups/raw_AAAAMMDD_HHMMSS_mmm.zip.
* Se conservan las `respaldo.conservar` copias más recientes (3 por defecto); las demás se borran.
* Si `respaldo.copia_externa` apunta a una carpeta (p. ej. una carpeta sincronizada con OneDrive), la copia
  también se guarda allí: protege los datos si el disco del proyecto falla o se desconecta.
* `python -m etl restaurar` devuelve data/raw al estado de una copia (la más reciente por defecto).
"""
from __future__ import annotations

import logging
import shutil
import time
import zipfile
from datetime import datetime
from pathlib import Path

log = logging.getLogger("etl.respaldo")
PATRON = "raw_*.zip"


def _carpeta(cfg: dict) -> Path:
    p = Path(cfg["paths"]["backups"])
    p.mkdir(parents=True, exist_ok=True)
    return p


def copias(cfg: dict) -> list[Path]:
    """Copias existentes, de la más reciente a la más antigua."""
    return sorted(_carpeta(cfg).glob(PATRON), key=lambda p: p.name, reverse=True)


def respaldar(cfg: dict, forzar: bool = False) -> Path | None:
    raw = Path(cfg["paths"]["raw"])
    r = cfg.get("respaldo", {})
    archivos = [f for f in raw.rglob("*") if f.is_file() and not f.name.endswith((".part", ".nuevo.csv"))] if raw.exists() else []
    if not archivos:
        log.info("[respaldo] data/raw está vacío: no hay nada que respaldar")
        return None
    previas = copias(cfg)
    if previas and not forzar:
        edad_h = (time.time() - previas[0].stat().st_mtime) / 3600
        if edad_h < r.get("min_horas", 20):
            log.info("[respaldo] se omite: la última copia (%s) tiene %.1f h", previas[0].name, edad_h)
            return previas[0]
    sello = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]  # hasta milisegundos: dos copias nunca chocan
    destino = _carpeta(cfg) / f"raw_{sello}.zip"
    tmp = destino.with_suffix(".zip.part")
    t0 = time.perf_counter()
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for f in archivos:
            z.write(f, f.relative_to(raw).as_posix())
    tmp.replace(destino)  # la copia solo existe si quedó completa
    log.info("[respaldo] %s (%d archivos, %.0f MB) en %.0f s", destino.name, len(archivos),
             destino.stat().st_size / 2**20, time.perf_counter() - t0)
    externa = r.get("copia_externa")
    if externa:
        try:
            ext = Path(externa)
            ext.mkdir(parents=True, exist_ok=True)
            shutil.copy2(destino, ext / destino.name)
            _rotar(sorted(ext.glob(PATRON), reverse=True), r.get("conservar", 3))
            log.info("[respaldo] copia externa en %s", ext)
        except Exception as e:  # noqa: BLE001  (la copia externa nunca detiene el pipeline)
            log.warning("[respaldo] no se pudo copiar a %s: %s", externa, e)
    _rotar(copias(cfg), r.get("conservar", 3))
    return destino


def _rotar(lista: list[Path], conservar: int) -> None:
    for viejo in lista[max(conservar, 1):]:
        viejo.unlink(missing_ok=True)
        log.info("[respaldo] se borra la copia antigua %s", viejo.name)


def restaurar(cfg: dict, archivo: str | None = None) -> Path:
    """Devuelve data/raw al contenido de una copia (la más reciente si no se indica cuál)."""
    if archivo:
        zip_path = Path(archivo)
        if not zip_path.is_absolute() and not zip_path.exists():
            zip_path = _carpeta(cfg) / archivo
    else:
        disponibles = copias(cfg)
        if not disponibles:
            raise FileNotFoundError("No hay copias en data/backups. Copie un raw_*.zip allí o indique --archivo.")
        zip_path = disponibles[0]
    raw = Path(cfg["paths"]["raw"])
    raw.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(raw)
    log.info("[respaldo] data/raw restaurado desde %s", zip_path.name)
    return zip_path
