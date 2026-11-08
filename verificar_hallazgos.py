"""Imprime las cifras declaradas en guia_entrega.pdf y DOCUMENTACION.md a partir de lo que generó el ETL.

Uso (después de `python -m etl run`):
    python verificar_hallazgos.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "web" / "data"


def carga(nombre):
    p = DATA / f"{nombre}.js"
    if not p.exists():
        raise SystemExit(f"No existe {p}. Ejecute primero: python -m etl run")
    txt = p.read_text(encoding="utf-8")
    return json.loads(re.sub(r"^window\.RSM=window\.RSM\|\|\{\};RSM\.\w+=", "", txt).rstrip().rstrip(";"))


f0 = lambda x: f"{x:,.0f}".replace(",", ".")
f1 = lambda x: f"{x:,.1f}".replace(",", "X").replace(".", ",").replace("X", ".")
f2 = lambda x: f"{x:.2f}".replace(".", ",")

meta, d, g, i = carga("meta"), carga("diagnostico"), carga("grilla"), carga("intervencion")
k = d["kpis"]
fac = {f["id"]: {x["k"]: x for x in f["items"]} for f in d["factores"]}
item = lambda fid, pre: next(v for kk, v in fac[fid].items() if kk.startswith(pre))

print("=" * 76)
print(" HALLAZGOS · Ruta Segura Medellín · Hackathon de Datos ITM 2026")
print(f" Datos generados por el ETL el {meta['generado']}")
print("=" * 76)
print(f"\n[1] Serie unificada MEData + GeoMedellín {k['desde'][:7]} a {k['hasta'][:7]}: "
      f"{f0(k['siniestros_heridos'])} siniestros con heridos o muertos ({f1(k['heridos_dia'])} por día)")
print(f"    Víctimas MEData: {f0(k['victimas'])} · muertos {f0(k['muertos_medata'])} · en moto {f1(100 * k['pct_moto'])} %")
print(f"    Muertes SISC {k['sisc_desde']}-{k['sisc_hasta']}: {f0(k['muertes_sisc'])}")
print(f"\n[2] HALLAZGO PRINCIPAL · {f1(100 * k['pct_lejos_cctv'])} % de las víctimas georreferenciadas ocurrió a más de "
      f"300 m de una cámara CCTV (mediana {f0(k['mediana_m_cctv'])} m)")
print(f"    2019-2025: {f0(100 * (1 - i['pct_cubierto_cctv']))} % de los siniestros con heridos, lejos de una CCTV")
print(f"\n[3] Hora pico (días hábiles): {f2(item('hora_pico', 'Hora pico')['rr'])}× siniestros con heridos por hora")
print(f"[4] Letalidad: peatón {f1(item('actor', 'Peatón')['v'])} por 1.000 víctimas ({f2(item('actor', 'Peatón')['rr'])}× vehículo);"
      f" bicicleta {f2(item('actor', 'Bicicleta')['rr'])}×; madrugada {f2(item('franja', 'Madrugada')['rr'])}× la tarde")
ll = d["factores"][[f["id"] for f in d["factores"]].index("lluvia")]
print(f"[5] Lluvia (IDEAM, {f0(ll['horas'])} horas observadas): {f2(ll['rr'])}× siniestros por hora con lluvia")
print("\n[6] Comunas sin ninguna CCTV (siniestros con heridos 2019-2025):")
for c in i["comunas_sin_cctv"][:5]:
    print(f"    {c['comuna']:<26} {f0(c['siniestros']):>7}")
p = i["puntos"][0]
print(f"\n[7] Punto prioritario n.º 1 sin CCTV: {p['dir']} ({p['comuna']}) · {f0(p['con_heridos'])} siniestros con heridos"
      f" · CCTV a {f0(p['dist_cctv'])} m")
print(f"\n[8] Grilla de riesgo: {f0(len(g['celdas']))} celdas de ~55 m · {f1(g['anios'])} años · "
      f"umbrales p50/p75/p90 = {f2(g['umbrales']['p50'])}/{f2(g['umbrales']['p75'])}/{f2(g['umbrales']['p90'])}")
print("\nOK: cifras leídas de web/data/*.js (generado desde data/warehouse/movilidad_medellin.duckdb)")
