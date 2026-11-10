"""WEB — convierte la bodega DuckDB en los archivos de datos de la página (web/data/*.js).

Cada archivo es JavaScript plano (`RSM.<nombre> = {...}`) para que la página funcione con doble clic
(file://) y en GitHub Pages sin servidor. Solo se exportan AGREGADOS: ningún registro individual,
ningún dato personal.

Serie unificada de siniestros (sin duplicar):
    MEData "Incidentes viales"  2014-07 → 2020-08   (incluye "Con muertos")
  + GeoMedellín "Siniestralidad" 2020-09 → 2025-12  (sin radicados ya presentes en MEData)
Muertes después del corte: SISC "Lesión fatal accidente de tránsito" (MEData) con coordenada.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from .common import ROOT

log = logging.getLogger("etl.web")

DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]


# ----------------------------------------------------------------------------- utilidades
def _df(con, sql: str) -> pd.DataFrame:
    return con.execute(sql).df()


def _one(con, sql: str):
    return con.execute(sql).fetchone()


def _tables(con) -> set[str]:
    return {r[0] for r in con.execute("SHOW TABLES").fetchall()}


def _clean(o):
    """Convierte tipos numpy/pandas a JSON y redondea floats."""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        return None if np.isnan(o) else round(float(o), 4)
    if isinstance(o, (pd.Timestamp, datetime)):
        return o.isoformat()[:19]
    if o is pd.NA or o is pd.NaT:
        return None
    return o


def _write(out: Path, name: str, obj) -> int:
    txt = json.dumps(_clean(obj), ensure_ascii=False, separators=(",", ":"))
    (out / f"{name}.js").write_text(f"window.RSM=window.RSM||{{}};RSM.{name}={txt};\n", encoding="utf-8")
    return len(txt)


# ----------------------------------------------------------------------------- serie unificada
def _vista_unificada(con, corte: str) -> None:
    con.execute(f"""
    CREATE OR REPLACE TEMP VIEW u AS
    SELECT radicado, fecha_hora, fecha, anio, mes, hora, dia_semana, es_festivo, es_fin_de_semana, es_dia_habil,
           franja_horaria, hora_pico, gravedad_incidente, clase_incidente, latitud, longitud,
           codigo_comuna_geo, comuna_geo, direccion, dist_m_camara_cctv, llovia, 'MEData' AS fuente
    FROM fact_incidente WHERE fecha_hora < TIMESTAMP '{corte}'
    UNION ALL BY NAME
    SELECT radicado, fecha_hora, fecha, anio, mes, hora, dia_semana, es_festivo, es_fin_de_semana, es_dia_habil,
           franja_horaria, hora_pico, gravedad_incidente, clase_incidente, latitud, longitud,
           codigo_comuna_geo, comuna_geo, direccion, dist_m_camara_cctv, llovia, 'GeoMedellín' AS fuente
    FROM fact_siniestro
    WHERE fecha_hora >= TIMESTAMP '{corte}'
      AND radicado NOT IN (SELECT radicado FROM fact_incidente WHERE radicado IS NOT NULL)""")
    # Base comparable entre años: GeoMedellín dejó de publicar "Solo daños" desde 2023, así que los análisis
    # usan solo siniestros con heridos o muertos (estables en todo el periodo).
    con.execute("""CREATE OR REPLACE TEMP VIEW uh AS
                   SELECT * FROM u WHERE gravedad_incidente IN ('Con heridos', 'Con muertos')""")
    # Dirección y comuna representativas de cada celda de ~110 m. La moda estadística elige al azar entre empates;
    # aquí se desempata por orden alfabético para que dos corridas generen exactamente los mismos archivos.
    hd = 0.001
    con.execute(f"""CREATE OR REPLACE TEMP TABLE etiqueta_celda AS
        WITH d AS (SELECT FLOOR(latitud/{hd}) gi, FLOOR(longitud/{hd}) gj, direccion, COUNT(*) n FROM uh
                   WHERE latitud IS NOT NULL AND direccion IS NOT NULL GROUP BY ALL),
             c AS (SELECT FLOOR(latitud/{hd}) gi, FLOOR(longitud/{hd}) gj, comuna_geo, COUNT(*) n FROM uh
                   WHERE latitud IS NOT NULL AND comuna_geo IS NOT NULL GROUP BY ALL),
             d1 AS (SELECT gi, gj, FIRST(direccion ORDER BY n DESC, direccion) dir FROM d GROUP BY 1, 2),
             c1 AS (SELECT gi, gj, FIRST(comuna_geo ORDER BY n DESC, comuna_geo) comuna FROM c GROUP BY 1, 2)
        SELECT * FROM d1 FULL JOIN c1 USING (gi, gj)""")
    con.execute(f"""
    CREATE OR REPLACE TEMP VIEW muertes AS
    SELECT latitud, longitud, fecha_hora, 1 AS n FROM fact_incidente
      WHERE gravedad_incidente = 'Con muertos' AND fecha_hora < TIMESTAMP '{corte}'
    UNION ALL
    SELECT latitud, longitud, fecha_hora, cantidad AS n FROM fact_muerte_sisc
      WHERE fecha_hora >= TIMESTAMP '{corte}'""")


# ----------------------------------------------------------------------------- módulo 1
def diagnostico(con, cfg) -> dict:
    t = _tables(con)
    d0, d1, n_sin = _one(con, "SELECT MIN(fecha), MAX(fecha), COUNT(*) FROM u")
    n_her = _one(con, "SELECT COUNT(*) FROM uh")[0]
    dias = (pd.Timestamp(d1) - pd.Timestamp(d0)).days + 1
    v = _one(con, """SELECT COUNT(*), SUM((gravedad_victima='Muerto')::INT),
                        AVG((actor_vial='Moto')::INT), MIN(fecha), MAX(fecha) FROM fact_victima""")
    lejos = _one(con, "SELECT AVG((NOT cubierto_cctv_300m)::INT), MEDIAN(dist_m_camara_cctv) "
                      "FROM fact_victima WHERE latitud IS NOT NULL")
    sisc = _one(con, "SELECT SUM(cantidad), MIN(anio), MAX(anio) FROM fact_muerte_sisc WHERE anio >= 2014") \
        if "fact_muerte_sisc" in t else (None, None, None)

    serie = _df(con, """
        WITH s AS (SELECT anio, COUNT(*) siniestros,
                          SUM((gravedad_incidente='Con heridos')::INT) con_heridos,
                          SUM((gravedad_incidente='Solo daños')::INT) solo_danos,
                          SUM((gravedad_incidente='Con muertos')::INT) con_muertos,
                          ANY_VALUE(fuente) fuente FROM u GROUP BY 1),
             v AS (SELECT anio, COUNT(*) victimas, SUM((gravedad_victima='Muerto')::INT) muertos_medata
                   FROM fact_victima GROUP BY 1),
             m AS (SELECT anio, SUM(cantidad) muertes_sisc FROM fact_muerte_sisc GROUP BY 1)
        SELECT s.*, v.victimas, v.muertos_medata, m.muertes_sisc
        FROM s LEFT JOIN v USING (anio) LEFT JOIN m USING (anio) ORDER BY anio""")
    meses_anio = _df(con, "SELECT anio, COUNT(DISTINCT mes) meses FROM u GROUP BY 1")
    serie = serie.merge(meses_anio, on="anio")

    calor = _df(con, "SELECT dia_semana, hora, COUNT(*) n FROM uh GROUP BY ALL")
    mat = [[0] * 24 for _ in range(7)]
    for r in calor.itertuples():
        if r.dia_semana in DIAS and pd.notna(r.hora):
            mat[DIAS.index(r.dia_semana)][int(r.hora)] = int(r.n)

    actores = _df(con, """SELECT actor_vial AS actor, COUNT(*) victimas,
                             SUM((gravedad_victima='Muerto')::INT) muertos
                          FROM fact_victima WHERE actor_vial IS NOT NULL GROUP BY 1 ORDER BY 2 DESC""")
    actores["letalidad_x1000"] = 1000 * actores["muertos"] / actores["victimas"]
    edad = _df(con, """SELECT grupo_edad, sexo, COUNT(*) n FROM fact_victima
                       WHERE grupo_edad IS NOT NULL AND sexo IS NOT NULL GROUP BY ALL ORDER BY 1, 2""")
    clase = _df(con, """SELECT clase_incidente AS clase, COUNT(*) n,
                           SUM((gravedad_incidente='Con muertos')::INT) con_muertos,
                           SUM((gravedad_incidente='Con heridos')::INT) con_heridos
                        FROM uh WHERE clase_incidente IS NOT NULL GROUP BY 1 ORDER BY 2 DESC""")
    comunas = _df(con, """
        WITH s AS (SELECT codigo_comuna_geo cod, ANY_VALUE(comuna_geo) comuna, COUNT(*) siniestros,
                          SUM((anio >= 2021)::INT) siniestros_2021_2025
                   FROM uh WHERE codigo_comuna_geo IS NOT NULL GROUP BY 1),
             v AS (SELECT codigo_comuna_geo cod, COUNT(*) victimas, SUM((gravedad_victima='Muerto')::INT) muertos
                   FROM fact_victima WHERE codigo_comuna_geo IS NOT NULL GROUP BY 1),
             c AS (SELECT codigo_comuna cod, SUM((tipo_camara='CCTV')::INT) cctv,
                          SUM((tipo_camara='FDT')::INT) fdt, SUM((tipo_camara='ARS')::INT) ars
                   FROM dim_camara GROUP BY 1)
        SELECT s.*, v.victimas, v.muertos, COALESCE(c.cctv,0) cctv, COALESCE(c.fdt,0) fdt, COALESCE(c.ars,0) ars
        FROM s LEFT JOIN v USING (cod) LEFT JOIN c USING (cod) ORDER BY siniestros DESC""")

    return {
        "kpis": {
            "siniestros": n_sin, "siniestros_heridos": n_her, "desde": d0, "hasta": d1,
            "heridos_dia": n_her / dias,
            "victimas": v[0], "muertos_medata": v[1], "pct_moto": v[2], "victimas_desde": v[3], "victimas_hasta": v[4],
            "letalidad_x1000": 1000 * v[1] / v[0], "pct_lejos_cctv": lejos[0], "mediana_m_cctv": lejos[1],
            "muertes_sisc": sisc[0], "sisc_desde": sisc[1], "sisc_hasta": sisc[2],
            "cctv": _one(con, "SELECT COUNT(*) FROM dim_camara WHERE tipo_camara='CCTV'")[0],
            "cctv_con_foto": _one(con, "SELECT COUNT(*) FROM dim_camara WHERE tipo_camara='CCTV' "
                                       "AND url_snapshot IS NOT NULL")[0],
        },
        "serie": serie.to_dict("records"),
        "calor": {"dias": DIAS, "matriz": mat},
        "actores": actores.to_dict("records"),
        "edad_sexo": edad.to_dict("records"),
        "clase": clase.to_dict("records"),
        "comunas": comunas.to_dict("records"),
        "factores": factores(con),
    }


def factores(con) -> list[dict]:
    """Factores influyentes como tasas comparables (siniestros por día u hora, letalidad)."""
    out = []
    d0, d1 = _one(con, "SELECT MIN(fecha), MAX(fecha) FROM uh")
    # días del periodo por tipo de día
    dias = _df(con, f"""SELECT es_festivo, es_fin_de_semana, temporada, COUNT(*) dias FROM dim_fecha
                        WHERE fecha BETWEEN DATE '{d0}' AND DATE '{d1}' GROUP BY ALL""")
    sin = _df(con, """SELECT uh.es_festivo, uh.es_fin_de_semana, f.temporada, COUNT(*) n
                      FROM uh JOIN dim_fecha f ON f.fecha = uh.fecha GROUP BY ALL""")

    def tasa(mask_d, mask_s):
        dd, ss = dias[mask_d(dias)]["dias"].sum(), sin[mask_s(sin)]["n"].sum()
        return ss / dd if dd else None

    habil = tasa(lambda x: ~x.es_festivo & ~x.es_fin_de_semana, lambda x: ~x.es_festivo & ~x.es_fin_de_semana)
    findes = tasa(lambda x: ~x.es_festivo & x.es_fin_de_semana, lambda x: ~x.es_festivo & x.es_fin_de_semana)
    fest = tasa(lambda x: x.es_festivo, lambda x: x.es_festivo)
    out.append({"id": "tipo_dia", "titulo": "Tipo de día", "unidad": "siniestros con heridos por día",
                "items": [{"k": "Día hábil", "v": habil, "ref": True}, {"k": "Sábado o domingo", "v": findes},
                          {"k": "Festivo", "v": fest}]})
    temp = []
    for t in ("Normal", "Navidad/Fin de año", "Vacaciones mitad de año", "Feria de las Flores"):
        temp.append({"k": t, "v": tasa(lambda x, t=t: x.temporada == t, lambda x, t=t: x.temporada == t),
                     "ref": t == "Normal"})
    out.append({"id": "temporada", "titulo": "Temporada", "unidad": "siniestros con heridos por día", "items": temp})

    # lluvia: solo horas con observación de la estación (no se imputan vacíos)
    ll = _df(con, """
        WITH h AS (SELECT llovia, COUNT(*) horas FROM fact_clima_hora
                   WHERE fecha_hora BETWEEN (SELECT MIN(fecha_hora) FROM uh) AND (SELECT MAX(fecha_hora) FROM uh)
                   GROUP BY 1),
             s AS (SELECT llovia, COUNT(*) n FROM uh WHERE llovia IS NOT NULL GROUP BY 1)
        SELECT h.llovia, h.horas, s.n, s.n / h.horas AS por_hora FROM h JOIN s USING (llovia)""")
    if len(ll) == 2:
        seco = float(ll.loc[~ll.llovia, "por_hora"].iloc[0])
        moj = float(ll.loc[ll.llovia, "por_hora"].iloc[0])
        out.append({"id": "lluvia", "titulo": "Lluvia en la hora del siniestro", "unidad": "siniestros con heridos por hora",
                    "items": [{"k": "Sin lluvia", "v": seco, "ref": True}, {"k": "Con lluvia", "v": moj}],
                    "horas": int(ll.horas.sum()), "rr": moj / seco})

    pico = _df(con, """SELECT hora_pico, COUNT(*) n FROM uh WHERE es_dia_habil GROUP BY 1""")
    # horas pico: 6 por día hábil (6-8 y 17-19); resto 18
    hab_dias = dias[~dias.es_festivo & ~dias.es_fin_de_semana]["dias"].sum()
    if len(pico) == 2 and hab_dias:
        p = float(pico.loc[pico.hora_pico, "n"].iloc[0]) / (6 * hab_dias)
        np_ = float(pico.loc[~pico.hora_pico, "n"].iloc[0]) / (18 * hab_dias)
        out.append({"id": "hora_pico", "titulo": "Hora pico (días hábiles)", "unidad": "siniestros con heridos por hora",
                    "items": [{"k": "Fuera de hora pico", "v": np_, "ref": True},
                              {"k": "Hora pico (6-9 y 17-20 h)", "v": p}]})

    fr = _df(con, """SELECT franja_horaria k, COUNT(*) victimas, SUM((gravedad_victima='Muerto')::INT) muertos
                     FROM fact_victima WHERE franja_horaria IS NOT NULL GROUP BY 1""")
    fr["v"] = 1000 * fr["muertos"] / fr["victimas"]
    orden = ["Madrugada", "Mañana", "Tarde", "Noche"]
    fr["o"] = fr["k"].map(lambda k: next((i for i, o in enumerate(orden) if str(k).startswith(o)), 9))
    items = [{"k": r.k, "v": r.v, "ref": str(r.k).startswith("Tarde")} for r in fr.sort_values("o").itertuples()]
    out.append({"id": "franja", "titulo": "Letalidad según la franja horaria", "unidad": "muertos por 1.000 víctimas",
                "items": items})

    ac = _df(con, """SELECT actor_vial k, COUNT(*) victimas, SUM((gravedad_victima='Muerto')::INT) muertos
                     FROM fact_victima WHERE actor_vial IS NOT NULL GROUP BY 1 ORDER BY 1""")
    ac["v"] = 1000 * ac["muertos"] / ac["victimas"]
    out.append({"id": "actor", "titulo": "Letalidad según el actor vial", "unidad": "muertos por 1.000 víctimas",
                "items": [{"k": r.k, "v": r.v, "ref": r.k == "Vehículo"} for r in ac.itertuples()]})
    for f in out:
        ref = next((i["v"] for i in f["items"] if i.get("ref")), None)
        for i in f["items"]:
            i["rr"] = (i["v"] / ref) if ref and i["v"] is not None else None
    return out


# ----------------------------------------------------------------------------- módulo 2: grilla de riesgo
def grilla(con, cfg) -> dict:
    g = cfg["web"]["grid_deg"]
    d0, d1 = _one(con, "SELECT MIN(fecha_hora), MAX(fecha_hora) FROM uh")
    anios = (pd.Timestamp(d1) - pd.Timestamp(d0)).days / 365.25
    lat0, lon0 = 6.10, -75.75
    cel = _df(con, f"""
        WITH s AS (SELECT CAST(FLOOR((latitud-{lat0})/{g}) AS INT) i, CAST(FLOOR((longitud-({lon0}))/{g}) AS INT) j,
                          COUNT(*) tot
                   FROM uh WHERE latitud IS NOT NULL GROUP BY 1,2),
             m AS (SELECT CAST(FLOOR((latitud-{lat0})/{g}) AS INT) i, CAST(FLOOR((longitud-({lon0}))/{g}) AS INT) j,
                          SUM(n) mue FROM muertes WHERE latitud IS NOT NULL GROUP BY 1,2),
             v AS (SELECT CAST(FLOOR((latitud-{lat0})/{g}) AS INT) i, CAST(FLOOR((longitud-({lon0}))/{g}) AS INT) j,
                          SUM((actor_vial='Moto')::INT) moto, SUM((actor_vial='Peatón')::INT) peat,
                          SUM((actor_vial='Bicicleta')::INT) bici, SUM((actor_vial='Vehículo')::INT) veh
                   FROM fact_victima WHERE latitud IS NOT NULL GROUP BY 1,2)
        SELECT COALESCE(s.i,m.i,v.i) i, COALESCE(s.j,m.j,v.j) j, COALESCE(tot,0) tot,
               COALESCE(mue,0) mue, COALESCE(moto,0) moto, COALESCE(peat,0) peat, COALESCE(bici,0) bici,
               COALESCE(veh,0) veh
        FROM s FULL JOIN m USING (i,j) FULL JOIN v USING (i,j) ORDER BY i, j""")
    # referencia: media del bloque 3×3 alrededor de cada celda con registros (incluye celdas vacías vecinas,
    # igual que el corredor de una ruta) → umbrales de nivel
    idx = {(r.i, r.j): r.tot for r in cel.itertuples() if r.tot > 0}
    suav = np.array([sum(idx.get((i + a, j + b), 0) for a in (-1, 0, 1) for b in (-1, 0, 1)) / 9 / anios
                     for (i, j) in idx])
    q = np.quantile(suav, [0.5, 0.75, 0.9])

    perfil_h = _df(con, "SELECT hora, COUNT(*) n FROM uh WHERE hora IS NOT NULL GROUP BY 1 ORDER BY 1")
    ph = np.zeros(24)
    ph[perfil_h.hora.astype(int)] = perfil_h.n
    perfil_d = _df(con, "SELECT dia_semana, COUNT(*) n FROM uh GROUP BY 1")
    pdia = [float(perfil_d.loc[perfil_d.dia_semana == d, "n"].sum()) for d in DIAS]
    ll = next((f for f in factores_cache if f["id"] == "lluvia"), None) if factores_cache else None
    p_h_lluvia = _one(con, "SELECT AVG(llovia::INT) FROM fact_clima_hora")[0]

    hot = _df(con, f"""
        SELECT ROUND(AVG(latitud),5) lat, ROUND(AVG(longitud),5) lon, COUNT(*) tot,
               ANY_VALUE(e.dir) dir, ANY_VALUE(e.comuna) comuna
        FROM uh LEFT JOIN etiqueta_celda e ON e.gi = FLOOR(uh.latitud/{cfg['web']['hotspot_deg']}) AND e.gj = FLOOR(uh.longitud/{cfg['web']['hotspot_deg']}) WHERE latitud IS NOT NULL
        GROUP BY FLOOR(latitud/{cfg['web']['hotspot_deg']}), FLOOR(longitud/{cfg['web']['hotspot_deg']})
        HAVING COUNT(*) >= 15 ORDER BY tot DESC, lat, lon LIMIT 600""")
    return {
        "deg": g, "lat0": lat0, "lon0": lon0, "anios": anios, "desde": d0, "hasta": d1,
        "base": "siniestros con heridos o muertos (MEData 2014-07→2020-08 + GeoMedellín 2020-09→2025)",
        "campos": ["i", "j", "siniestros_heridos", "muertes", "vict_moto", "vict_peaton", "vict_bici",
                   "vict_vehiculo"],
        "celdas": cel[["i", "j", "tot", "mue", "moto", "peat", "bici", "veh"]].astype(int).values.tolist(),
        "umbrales": {"p50": q[0], "p75": q[1], "p90": q[2]},
        "media_ref": float(suav.mean()),
        "perfil_hora": (ph / ph.sum()).tolist(),
        "perfil_dia": (np.array(pdia) / sum(pdia)).tolist(),
        "rr_lluvia": ll["rr"] if ll else None,
        "p_horas_lluvia": p_h_lluvia,
        "puntos": hot.to_dict("records"),
    }


factores_cache: list[dict] = []


# ----------------------------------------------------------------------------- cámaras
def camaras(con) -> list[dict]:
    t = _tables(con)
    sin300 = "LEFT JOIN v_camaras_cctv_siniestros s USING (id_camara)" if "v_camaras_cctv_siniestros" in t else ""
    col = "s.siniestros_300m" if sin300 else "NULL"
    df = _df(con, f"""
        SELECT c.id_camara id, c.tipo_camara tipo, c.nombre, c.direccion dir, ROUND(c.latitud,6) lat,
               ROUND(c.longitud,6) lon, c.comuna, c.url_snapshot foto, c.vel_max_kmh vel,
               c.detecta_exceso_velocidad d_vel, c.detecta_pico_placa d_pyp, c.detecta_semaforo_rojo d_rojo,
               c.detecta_soat d_soat, c.detecta_rtm d_rtm, {col} sin300
        FROM dim_camara c {sin300} WHERE c.latitud IS NOT NULL""")
    out = []
    for r in df.to_dict("records"):
        det = [n for k, n in (("d_vel", "Exceso de velocidad"), ("d_pyp", "Pico y placa"),
                              ("d_rojo", "Semáforo en rojo"), ("d_soat", "SOAT"), ("d_rtm", "Revisión técnico-mecánica"))
               if r.pop(k, None) in (True, 1, "X", "x", "Sí")]
        r["detecta"] = det
        out.append(r)
    return out


# ----------------------------------------------------------------------------- clima
def clima(con, cfg, raw: Path) -> dict:
    t = _tables(con)
    res = {"umbral_mm": cfg["lluvia"]["umbral_mm"], "estaciones": [
        {"codigo": k, **v} for k, v in cfg["lluvia"]["estaciones"].items()]}
    if "fact_clima_hora" in t:
        r = _one(con, "SELECT COUNT(*), MIN(fecha_hora), MAX(fecha_hora), AVG(llovia::INT) FROM fact_clima_hora")
        res |= {"horas_observadas": r[0], "desde": r[1], "hasta": r[2], "p_global": r[3]}
        m = _df(con, "SELECT MONTH(fecha_hora) mes, HOUR(fecha_hora) hora, AVG(llovia::INT) p, COUNT(*) n "
                     "FROM fact_clima_hora GROUP BY ALL")
        mat = [[None] * 24 for _ in range(12)]
        nn = [[0] * 24 for _ in range(12)]
        for x in m.itertuples():
            mat[x.mes - 1][x.hora] = x.p
            nn[x.mes - 1][x.hora] = x.n
        res |= {"p_lluvia": mat, "n_horas": nn}
    p = raw / "siata" / "pluviometros.json"
    if p.exists():
        est = json.loads(p.read_text(encoding="utf-8")).get("estaciones", [])
        res["siata"] = [{"codigo": e.get("codigo"), "nombre": e.get("nombre"), "ciudad": e.get("ciudad"),
                         "lat": e.get("latitud"), "lon": e.get("longitud")} for e in est]
    res["siata_url"] = cfg["siata"]["pluviometros_url"]
    return res


# ----------------------------------------------------------------------------- módulo 3: dónde intervenir
def intervencion(con, cfg) -> dict:
    h = cfg["web"]["hotspot_deg"]
    top = _df(con, f"""
        WITH c AS (
          SELECT FLOOR(latitud/{h}) gi, FLOOR(longitud/{h}) gj, ROUND(AVG(latitud),5) lat, ROUND(AVG(longitud),5) lon,
                 COUNT(*) siniestros, SUM((gravedad_incidente IN ('Con heridos','Con muertos'))::INT) con_heridos,
                 ANY_VALUE(e.dir) dir, ANY_VALUE(e.comuna) comuna, MIN(dist_m_camara_cctv) dist_cctv,
                 SUM((anio >= 2023)::INT) ultimos_3
          FROM uh LEFT JOIN etiqueta_celda e ON e.gi = FLOOR(uh.latitud/{h}) AND e.gj = FLOOR(uh.longitud/{h}) WHERE latitud IS NOT NULL AND anio >= 2019 GROUP BY 1,2),
        m AS (SELECT FLOOR(latitud/{h}) gi, FLOOR(longitud/{h}) gj, SUM(n) muertes FROM muertes
              WHERE latitud IS NOT NULL AND YEAR(fecha_hora) >= 2019 GROUP BY 1,2)
        SELECT c.*, COALESCE(m.muertes,0) muertes, c.con_heridos + 10*COALESCE(m.muertes,0) puntaje
        FROM c LEFT JOIN m USING (gi,gj)
        WHERE c.dist_cctv > 300 ORDER BY puntaje DESC, con_heridos DESC, lat, lon LIMIT 25""")
    top = top.drop(columns=["gi", "gj"])
    sin_cctv = _df(con, """
        SELECT codigo_comuna_geo cod, ANY_VALUE(comuna_geo) comuna, COUNT(*) siniestros
        FROM uh WHERE codigo_comuna_geo IS NOT NULL AND anio >= 2019
          AND codigo_comuna_geo NOT IN (SELECT codigo_comuna FROM dim_camara
                                        WHERE tipo_camara='CCTV' AND codigo_comuna IS NOT NULL)
        GROUP BY 1 ORDER BY 3 DESC""")
    cub = _one(con, "SELECT AVG((dist_m_camara_cctv <= 300)::INT) FROM uh WHERE latitud IS NOT NULL AND anio >= 2019")
    return {"periodo": "2019-2025", "regla": "puntaje = siniestros con heridos + 10 × muertes (2019-2025); solo celdas de ~110 m "
            "cuya cámara CCTV más cercana está a más de 300 m", "puntos": top.to_dict("records"), "comunas_sin_cctv": sin_cctv.to_dict("records"),
            "pct_cubierto_cctv": cub[0]}


# ----------------------------------------------------------------------------- módulo 4: calidad
NOMBRES_REGLA = {
    "filas_vacias_eliminadas": "Filas vacías eliminadas", "duplicados_exactos": "Duplicados exactos (cuarentena)",
    "radicado_repetido": "Radicado repetido (cuarentena)", "fecha_invalida": "Fecha inválida (cuarentena)",
    "sin_coordenada": "Sin coordenada (se conserva con bandera)", "coord_invertida_corregida": "Lat/lon invertidas corregidas",
    "coord_comodin_anulada": "Coordenada comodín anulada",
    "coord_comodin_detectada": "Comodín detectado (punto repetido con direcciones dispersas)", "punto_fuera_poligono_medellin": "Punto fuera del polígono de Medellín",
    "comuna_declarada_vs_geo_distinta": "Comuna declarada ≠ comuna del polígono",
    "comuna_imputada_por_geo": "Comuna imputada por polígono", "fuera_de_medellin_a_cuarentena": "Fuera de Medellín (cuarentena)",
    "anio_con_basura_corregido": "Año con \\r pegado corregido", "texto_con_escapes_hex_reparado": "Texto con escapes \\xNN reparado",
    "edad_invalida_anulada": "Edad 0 o > 99 anulada", "edad_sin_info": "Edad sin información", "sexo_sin_info": "Sexo sin información",
    "variantes_mayus_minus_unificadas": "Variantes de mayúsculas unificadas", "actor_sin_dato": "Actor vial sin dato",
    "precipitacion_vacia_pct": "Columna precipitación vacía (%)",
}
DATASETS = {
    "victimas": "MEData · Víctimas en incidentes viales", "incidentes": "MEData · Incidentes viales",
    "lesion_fatal": "MEData · Lesión fatal accidente de tránsito (SISC)",
    "lesion_fatal_precipitacion": "MEData · Lesión fatal … con precipitación",
    "incidentes_motos": "MEData · Incidentes viales con motos", "aforos": "MEData · Aforos vehiculares",
    "velocidad_gt": "MEData · Velocidad y tiempo de viaje GT", "siniestralidad": "GeoMedellín · Siniestralidad",
    "camaras": "GeoMedellín · Cámaras de tránsito",
}


def calidad(cfg) -> dict:
    p = cfg["paths"]["reports"] / "calidad_datos.json"
    rep = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    fuentes = []
    for k, v in rep.items():
        reglas = [{"regla": NOMBRES_REGLA[r], "n": n} for r, n in v.items()
                  if r in NOMBRES_REGLA and isinstance(n, (int, float)) and n]
        fuentes.append({"id": k, "nombre": DATASETS.get(k, k), "leidas": v.get("filas_leidas"),
                        "limpias": v.get("filas_limpias"), "rango": v.get("rango_fechas") or v.get("rango_anios"),
                        "reglas": reglas})
    return {"fuentes": fuentes}


# ----------------------------------------------------------------------------- meta
# ----------------------------------------------------------------------------- página del jurado
def jurado(con, cfg) -> dict:
    """Datos más finos para la página técnica (simuladores y comportamiento temporal). Siguen siendo agregados."""
    h = cfg["web"]["hotspot_deg"]
    anios = [r[0] for r in con.execute("SELECT DISTINCT anio FROM uh ORDER BY 1").fetchall()]
    piv = ", ".join(f"SUM((anio = {a})::INT) AS a{a}" for a in anios)
    pa = _df(con, f"""
        SELECT ROUND(AVG(latitud),5) lat, ROUND(AVG(longitud),5) lon, ANY_VALUE(e.dir) dir, ANY_VALUE(e.comuna) comuna,
               COUNT(*) tot, {piv}
        FROM uh LEFT JOIN etiqueta_celda e ON e.gi = FLOOR(uh.latitud/{h}) AND e.gj = FLOOR(uh.longitud/{h}) WHERE latitud IS NOT NULL
        GROUP BY FLOOR(latitud/{h}), FLOOR(longitud/{h}) ORDER BY tot DESC, lat, lon LIMIT 400""")
    puntos_anio = [[r["lat"], r["lon"], r["dir"], r["comuna"], [int(r[f"a{a}"]) for a in anios]]
                   for r in pa.to_dict("records")]
    # celdas de ~110 m con siniestros con heridos 2019-2025: base de los simuladores de cámaras y priorización
    cel = _df(con, f"""
        WITH c AS (SELECT FLOOR(latitud/{h}) gi, FLOOR(longitud/{h}) gj, ROUND(AVG(latitud),5) lat,
                          ROUND(AVG(longitud),5) lon, COUNT(*) n, ANY_VALUE(e.dir) dir
                   FROM uh LEFT JOIN etiqueta_celda e ON e.gi = FLOOR(uh.latitud/{h}) AND e.gj = FLOOR(uh.longitud/{h}) WHERE latitud IS NOT NULL AND anio >= 2019 GROUP BY 1,2),
             m AS (SELECT FLOOR(latitud/{h}) gi, FLOOR(longitud/{h}) gj, SUM(n) mue FROM muertes
                   WHERE latitud IS NOT NULL AND YEAR(fecha_hora) >= 2019 GROUP BY 1,2)
        SELECT c.lat, c.lon, c.n, COALESCE(m.mue,0) mue, c.dir FROM c LEFT JOIN m USING (gi,gj) ORDER BY c.n DESC, c.lat, c.lon""")
    celdas = [[r.lat, r.lon, int(r.n), int(r.mue), r.dir if r.n >= 20 else None] for r in cel.itertuples()]
    mensual = _df(con, """SELECT strftime(fecha_hora, '%Y-%m') mes, COUNT(*) heridos, ANY_VALUE(fuente) fuente
                          FROM uh GROUP BY 1 ORDER BY 1""")
    cctv = _df(con, "SELECT ROUND(latitud,6) lat, ROUND(longitud,6) lon FROM dim_camara "
                    "WHERE tipo_camara='CCTV' AND latitud IS NOT NULL")
    return {"anios": anios, "puntos_anio": puntos_anio, "celdas_2019_2025": celdas,
            "celdas_campos": ["lat", "lon", "siniestros_heridos", "muertes", "direccion"],
            "mensual": mensual.to_dict("records"), "cctv": cctv.values.tolist(),
            "corte_medata": cfg["web"]["corte_medata"]}


def meta(con, cfg) -> dict:
    man_p = cfg["paths"]["raw"] / "_manifest.json"
    man = json.loads(man_p.read_text(encoding="utf-8")) if man_p.exists() else {}
    t = _tables(con)
    filas = {x: _one(con, f"SELECT COUNT(*) FROM {x}")[0] for x in sorted(t) if x.startswith(("fact_", "dim_", "stg_"))}
    return {"generado": datetime.now().strftime("%Y-%m-%d %H:%M"), "extraccion": {
        k: v.get("extracted_at") for k, v in man.items()}, "filas": filas,
        "corte_medata": cfg["web"]["corte_medata"]}


# ----------------------------------------------------------------------------- orquestación
def run_web(cfg: dict) -> dict:
    out = Path(cfg["paths"].get("web_out") or (ROOT / cfg["web"]["out"]))
    out.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(cfg["paths"]["warehouse"]), read_only=True)
    try:
        t = _tables(con)
        need = {"fact_incidente", "fact_siniestro", "fact_victima", "dim_camara"}
        if not need <= t:
            raise RuntimeError(f"Faltan tablas en la bodega: {sorted(need - t)}. Ejecute 'python -m etl run'.")
        if "fact_muerte_sisc" not in t:
            con.execute("CREATE TEMP TABLE fact_muerte_sisc AS SELECT NULL::TIMESTAMP fecha_hora, NULL::INT anio, "
                        "NULL::INT cantidad, NULL::DOUBLE latitud, NULL::DOUBLE longitud WHERE false")
        if "fact_clima_hora" not in t:
            con.execute("CREATE TEMP TABLE fact_clima_hora AS SELECT NULL::TIMESTAMP fecha_hora, "
                        "NULL::DOUBLE precipitacion_mm, NULL::BOOLEAN llovia WHERE false")
        _vista_unificada(con, cfg["web"]["corte_medata"])
        tam = {}
        diag = diagnostico(con, cfg)
        factores_cache[:] = diag["factores"]
        tam["diagnostico"] = _write(out, "diagnostico", diag)
        tam["grilla"] = _write(out, "grilla", grilla(con, cfg))
        tam["camaras"] = _write(out, "camaras", camaras(con))
        tam["clima"] = _write(out, "clima", clima(con, cfg, cfg["paths"]["raw"]))
        tam["intervencion"] = _write(out, "intervencion", intervencion(con, cfg))
        tam["calidad"] = _write(out, "calidad", calidad(cfg))
        tam["jurado"] = _write(out, "jurado", jurado(con, cfg))
        tam["meta"] = _write(out, "meta", meta(con, cfg))
    finally:
        con.close()
    for k, n in tam.items():
        log.info("[web] %-13s %8.1f KB → %s", k, n / 1024, out / f"{k}.js")
    return tam
