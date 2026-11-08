# Ruta Segura Medellín

**[Abrir la página en línea](https://juanrob2024.github.io/ruta-segura-medellin/)** · [Ejemplo del cálculo de riesgo](https://juanrob2024.github.io/ruta-segura-medellin/docs/ejemplo_funcionamiento.html)

**¿Qué tan riesgosa es tu ruta por Medellín?** Pipeline automático + página web con datos abiertos de **MEData**,
**GeoMedellín**, **SIATA** y **datos.gov.co** · Hackathon de Datos ITM 2026 · Modalidad *Pipelines automáticos*.

| Módulo | Qué hace |
|---|---|
| **1 · ¿Qué está pasando?** | Evolución 2014-2025, horas y días críticos, factores influyentes (hora pico, tipo de día, temporada, lluvia, franja, actor vial), víctimas, puntos críticos y comunas |
| **2 · Consulta tu ruta** | Hasta 3 rutas con su probabilidad de siniestro durante el viaje, nivel de riesgo, tramos críticos, cámaras en la vía con foto en vivo, lluvia ahora (SIATA), probabilidad histórica de lluvia y recomendaciones |
| **3 · ¿Dónde intervenir?** | Los 25 puntos con más siniestros con heridos sin cámara CCTV a 300 m y las comunas sin cámaras |
| **4 · Datos y calidad** | Fuentes, reglas de limpieza con sus conteos, hallazgos y propuesta de mejora a MEData |

## Probarlo

* **En línea:** https://juanrob2024.github.io/ruta-segura-medellin/
* **Sin instalar nada:** abrir `web/index.html` con doble clic (los datos agregados ya vienen incluidos).
* **Regenerar todo desde las fuentes:**

```bash
python -m venv .venv
.venv\Scripts\activate          # Linux/Mac: source .venv/bin/activate
pip install -r requirements.txt
python -m etl run               # ~15 min la primera vez
python verificar_hallazgos.py
pytest -q                       # 20 pruebas
```

## Hallazgos

* **70,2 %** de las víctimas viales cayó a más de 300 m de una cámara de circuito cerrado.
* En **hora pico** hay **1,95×** siniestros con heridos por hora.
* Un **peatón** víctima tiene **6,75×** la letalidad de un ocupante de vehículo; la **madrugada**, **2,7×** la de la tarde.
* La **lluvia** casi no cambia la tasa de siniestros por hora (**1,02×**, medido con IDEAM).

## Documentos

* [`instrucciones.txt`](instrucciones.txt): pasos para el jurado.
* [`DOCUMENTACION.md`](DOCUMENTACION.md): fuentes, arquitectura, calidad de datos, decisiones, reglas de negocio, modelo de riesgo y diagramas.
* [`docs/ejemplo_funcionamiento.html`](docs/ejemplo_funcionamiento.html): el cálculo del riesgo de una ruta, paso a paso e interactivo.
* `guia_entrega.pdf`: formulario de entrega diligenciado.

Datos: Alcaldía de Medellín (MEData, GeoMedellín, SIMM), SIATA e IDEAM vía datos.gov.co · CC BY-SA 4.0 donde aplica.
Mapas © colaboradores de OpenStreetMap · Rutas OSRM · Búsqueda Photon.
