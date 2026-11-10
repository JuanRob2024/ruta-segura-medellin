"""Pruebas de las correcciones de la auditoría técnica del 10-nov-2026 (una por hallazgo verificado)."""
import io
import json
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import pytest
from PIL import Image

from etl import cleaning as C
from etl.camaras import Collector
from etl.common import load_config
from etl.extract import MEDataClient
from etl.transform import Report, _comodin_dinamico, build_incidentes_camaras
from etl.web_export import _vista_unificada

from test_etl import pipeline  # noqa: F401  (reutiliza el pipeline extremo a extremo)


def _cfg(tmp_path):
    txt = (Path(__file__).parents[1] / "config.yaml").read_text(encoding="utf-8")
    (tmp_path / "config.yaml").write_text(txt.replace("data/", f"{tmp_path.as_posix()}/data/"), encoding="utf-8")
    return load_config(tmp_path / "config.yaml")


def _fila(radicado, fecha):
    f = pd.Timestamp(fecha)
    return {"radicado": radicado, "fecha_hora": f, "fecha": f.normalize(), "anio": f.year, "mes": f.month, "hora": f.hour,
            "dia_semana": "Lun", "es_festivo": False, "es_fin_de_semana": False, "es_dia_habil": True,
            "franja_horaria": "Mañana", "hora_pico": False, "gravedad_incidente": "Con heridos", "clase_incidente": "Choque",
            "latitud": 6.25, "longitud": -75.57, "codigo_comuna_geo": "10", "comuna_geo": "La Candelaria",
            "direccion": "CR 50 CL 50", "dist_m_camara_cctv": 100.0, "llovia": False}


def test_w01_siniestro_sin_radicado_no_se_pierde_de_la_serie():
    con = duckdb.connect()
    inc = pd.DataFrame([_fila("1", "2019-05-01 08:00")])
    sin = pd.DataFrame([_fila("1", "2021-01-01 08:00"), _fila("2", "2021-02-01 08:00"),
                        _fila(None, "2021-03-01 08:00"), _fila(None, "2021-04-01 08:00")])
    con.register("inc_df", inc); con.register("sin_df", sin)
    con.execute("CREATE TABLE fact_incidente AS SELECT * FROM inc_df")
    con.execute("CREATE TABLE fact_siniestro AS SELECT * FROM sin_df")
    con.execute("CREATE TABLE fact_muerte_sisc AS SELECT NULL::DOUBLE latitud, NULL::DOUBLE longitud, "
                "NULL::TIMESTAMP fecha_hora, NULL::INT cantidad WHERE false")
    _vista_unificada(con, "2020-09-01")
    # MEData (1) + GeoMedellín sin el radicado repetido (2) + los 2 sin radicado = 4
    assert con.execute("SELECT COUNT(*) FROM u").fetchone()[0] == 4


def test_t01_csv_local_no_colapsa_radicados_nulos_ni_guarda_radicado():
    a = pd.DataFrame([_fila("7", "2019-01-01"), _fila(None, "2019-01-02"), _fila(None, "2019-01-03")])
    b = pd.DataFrame([_fila("7", "2019-01-01")])
    out = build_incidentes_camaras({"fact_incidente": a, "fact_siniestro": b})
    assert len(out) == 3                      # el repetido una vez + los dos sin radicado
    assert "radicado" not in out.columns


def test_l02_banderas_son_boolean_en_la_bodega(pipeline):  # noqa: F811
    cfg, _, _ = pipeline
    con = duckdb.connect(str(cfg["paths"]["warehouse"]), read_only=True)
    tipos = dict(con.execute("SELECT column_name, data_type FROM information_schema.columns "
                             "WHERE table_name = 'fact_victima'").fetchall())
    assert tipos["cubierto_cctv_300m"] == "BOOLEAN"


def test_w06_controles_de_consistencia_vacios(pipeline):  # noqa: F811
    cfg, _, _ = pipeline
    txt = (cfg["paths"]["web_out"] / "meta.js").read_text(encoding="utf-8")
    meta = json.loads(txt.split("RSM.meta=", 1)[1].rstrip().rstrip(";"))
    assert meta["controles_consistencia"] == []


def test_p01_comodin_optimizado_da_lo_mismo_que_la_version_anterior():
    rng = np.random.default_rng(0)
    filas = []
    for k in range(300):  # puntos con 1 a 120 registros; algunos comodín, otros cruces reales
        n = int(rng.integers(1, 120))
        comodin = k % 7 == 0
        for i in range(n):
            filas.append({"latitud": 6.2 + k * 1e-4, "longitud": -75.5,
                          "direccion": f"CR {i} CL {i + 3}" if comodin else rng.choice(["CR 65 CL 80", "CRA 65 CLL 80"])})
    df = pd.DataFrame(filas)
    out = _comodin_dinamico(df.copy(), "direccion", C.Flags(df.index), Report(), "x")
    # versión anterior (lenta): moda por grupo con value_counts
    key = df["latitud"].round(5).astype("string") + "," + df["longitud"].round(5).astype("string")
    norm = df["direccion"].str.upper().str.findall(r"\d+").map(lambda x: " ".join(x[:2]))
    g = pd.DataFrame({"k": key, "norm": norm}).groupby("k")["norm"].agg(n="size", modal=lambda s: s.value_counts(normalize=True).iloc[0])
    malos = g[(g["n"] >= 50) & (g["modal"] < 0.3)].index
    assert (out["latitud"].isna() == key.isin(malos)).all()


def test_k01_camara_congelada_se_detecta_entre_procesos(tmp_path):
    cfg = _cfg(tmp_path)
    buf = io.BytesIO()
    Image.effect_noise((640, 360), 60).convert("RGB").save(buf, "JPEG", quality=90)
    jpg = buf.getvalue()
    pd.DataFrame({"id_camara": ["CCTV-8"], "tipo_camara": "CCTV", "nombre": "x",
                  "url_snapshot": ["https://www.medellin.gov.co/simm/camaras-cctv/imagen8.jpg"]}
                 ).to_parquet(cfg["paths"]["clean"] / "dim_camara.parquet")

    class R:
        status_code, content, headers = 200, jpg, {"Content-Type": "image/jpeg"}

    class S:
        headers = {}

        def get(self, url, **kw):
            return R()

    estados = []
    for _ in range(2):  # dos procesos distintos, como la tarea programada
        col = Collector(cfg)
        col.s = S()
        estados.append(col.ronda()["estado"].iloc[0])
    assert estados == ["ok", "congelada"]


def test_d07_sin_selenium_el_error_dice_la_causa_real(tmp_path, monkeypatch):
    cfg = _cfg(tmp_path)

    class S:
        def get(self, url, **kw):
            raise ConnectionError("TLS: conexión cerrada por el servidor")

    c = MEDataClient(cfg)
    c.s = S()

    def sin_selenium(self, dataset_id):
        raise ImportError("No module named 'selenium'")

    monkeypatch.setattr(MEDataClient, "_metadata_selenium", sin_selenium)
    with pytest.raises(RuntimeError, match="TLS: conexión cerrada"):
        c.metadata("1-023-25-000360")
