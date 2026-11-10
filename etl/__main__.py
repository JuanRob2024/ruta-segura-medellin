"""CLI del ETL.

  python -m etl run                     # extract + transform + load + web (todo)
  python -m etl run --only victimas comunas camaras_cctv
  python -m etl extract [--force]
  python -m etl transform               # re-procesa desde data/raw sin descargar
  python -m etl web                     # regenera solo los datos de la página (web/data/*.js)
  python -m etl camaras --rondas 1      # una captura de las 81 cámaras CCTV
  python -m etl camaras                 # captura continua cada `intervalo_s`
  python -m etl respaldar               # copia comprimida de data/raw ahora mismo
  python -m etl restaurar [--archivo raw_AAAAMMDD_HHMMSS.zip]   # vuelve data/raw a una copia

Códigos de salida: 0 = todo bien · 2 = terminó, pero alguna fuente no se actualizó y se usó su copia anterior
(detalle en data/reports/extraccion.json) · 1 = error que detuvo el proceso.
"""
from __future__ import annotations

import argparse
import logging
import sys

from .common import Timer, load_config, setup_logging

log = logging.getLogger("etl")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="etl", description="ETL Movilidad Medellín")
    ap.add_argument("comando", choices=["run", "extract", "transform", "web", "camaras", "respaldar", "restaurar"])
    ap.add_argument("--only", nargs="*", help="nombres de fuentes (ver config.yaml)")
    ap.add_argument("--force", action="store_true", help="re-descargar aunque no haya cambios")
    ap.add_argument("--rondas", type=int, default=None, help="n.º de rondas de captura de cámaras")
    ap.add_argument("--archivo", default=None, help="copia a restaurar (por defecto, la más reciente)")
    ap.add_argument("--config", default=None)
    ap.add_argument("--log", default="INFO")
    a = ap.parse_args(argv)
    setup_logging(a.log)
    cfg = load_config(a.config)
    codigo = 0

    if a.comando == "respaldar":
        from .respaldo import respaldar
        respaldar(cfg, forzar=True)
        return 0
    if a.comando == "restaurar":
        from .respaldo import restaurar
        restaurar(cfg, a.archivo)
        log.info("Ahora ejecute: python -m etl transform")
        return 0

    if a.comando in ("run", "extract"):
        from .extract import run_extract
        with Timer("EXTRACT"):
            resumen = run_extract(cfg, a.only, a.force)
        if resumen["fallidas"]:
            codigo = 2
    if a.comando in ("run", "transform"):
        from .load import run_load
        from .transform import run_transform
        with Timer("TRANSFORM"):
            tables, rep = run_transform(cfg, a.only)
        with Timer("LOAD"):
            run_load(cfg, tables, rep)
        log.info("Reporte de calidad: %s", cfg["paths"]["reports"] / "calidad_datos.md")
    if a.comando in ("run", "transform", "web"):
        from .web_export import run_web
        with Timer("WEB"):
            run_web(cfg)
        log.info("Página lista: abra web/index.html")
    if a.comando == "camaras":
        from .camaras import Collector
        Collector(cfg).loop(a.rondas)

    if codigo == 2:
        log.warning("Terminado CON AVISOS: %s no se actualizaron; se usó su última copia buena. "
                    "Detalle en %s", ", ".join(resumen["fallidas"]), cfg["paths"]["reports"] / "extraccion.json")
    return codigo


if __name__ == "__main__":
    sys.exit(main())
