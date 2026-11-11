/* Módulo 4 · Datos y calidad */
(function () {
  const FUENTES = [
    ['MEData', 'Víctimas en Incidentes viales', '1-023-25-000360', 'https://medata.app.medellin.gov.co/dataset/1-023-25-000360', 'Víctimas: gravedad, actor vial, edad, sexo, ubicación', 'fact_victima'],
    ['MEData', 'Incidentes viales', '1-023-25-000094', 'https://medata.app.medellin.gov.co/dataset/1-023-25-000094', 'Siniestros 2014-07 a 2020-08 de la serie unificada', 'fact_incidente'],
    ['MEData', 'Lesión fatal accidente de tránsito según Policía (SISC)', '1-027-23-000019', 'https://medata.app.medellin.gov.co/dataset/1-027-23-000019', 'Muertes 2003-2023; muertes en la grilla desde sep-2020', 'fact_muerte_sisc'],
    ['MEData', 'Lesión fatal … con precipitación', '1-027-23-000307', 'https://medata.app.medellin.gov.co/dataset/1-027-23-000307', 'Solo perfilado: la columna de precipitación llega vacía', null],
    ['MEData', 'Incidentes con motos · Aforos · Velocidad GT', '1-023-25-000277 / 301 / 287', 'https://medata.app.medellin.gov.co/', 'Exposición (staging para análisis futuros)', 'stg_aforos'],
    ['Distrito · GeoMedellín', 'Siniestralidad (VM_Accidentes)', 'ArcGIS REST', 'https://www.medellin.gov.co/servidormapas/rest/services/transporte/VM_Accidentes/MapServer/0', 'Siniestros desde sep-2020 de la serie unificada', 'fact_siniestro'],
    ['Distrito · GeoMedellín', 'Cámaras CCTV, fotodetección y apoyo semafórico', 'ArcGIS REST', 'https://www.medellin.gov.co/servidormapas/rest/services/transporte/VC_Infraest_Gestion_Transito/MapServer', 'Cámaras en la ruta y cobertura a 300 m', 'dim_camara'],
    ['Distrito · GeoMedellín', 'Límite de comunas y corregimientos', 'ArcGIS REST', 'https://www.medellin.gov.co/servidormapas/rest/services/mapas_nacionales/VC_Limite_Politico_Admtivo/MapServer', 'Validar coordenadas y asignar comuna', 'dim_comuna'],
    ['Distrito · SIMM', 'Cámaras de circuito cerrado (foto en vivo)', 'HTTP', 'https://www.medellin.gov.co/simm/camaras-de-circuito-cerrado', 'Foto de cada cámara en la ruta', null],
    ['SIATA', 'Pluviómetros en tiempo real', 'JSON', 'https://siata.gov.co/data/siata_app/Pluviometrica.json', 'Lluvia ahora cerca de la ruta (en vivo)', null],
    ['datos.gov.co · IDEAM', 'Precipitación (s54a-sgyg), estación Olaya Herrera', 'Socrata API', 'https://www.datos.gov.co/Ambiente-y-Desarrollo-Sostenible/Precipitaci-n/s54a-sgyg', 'Efecto de la lluvia y probabilidad histórica de lluvia', 'fact_clima_hora'],
  ];

  const ESTADO = {
    ok: ['circle-check', 'Actualizada'], sin_cambios: ['circle-check', 'Sin cambios en la fuente'],
    rechazada: ['triangle-exclamation', 'Rechazada'], error: ['circle-xmark', 'No respondió'],
  };
  const NOMBRE = (k) => k.replace('medata:', 'MEData · ').replace('arcgis:', 'GeoMedellín · ').replace('lluvia', 'datos.gov.co · lluvia IDEAM')
    .replace('siata', 'SIATA · pluviómetros').replace(/_/g, ' ');

  /* mensaje técnico → frase corta para el lector (el detalle completo queda en data/reports/extraccion.json) */
  function detalleClaro(d) {
    if (!d) return '';
    const host = /host='([^']+)'/.exec(d);
    if (host) return `El servidor ${host[1]} no respondió.`;
    if (/servidor sin respuesta/.test(d)) return 'Mismo servidor caído: no se volvió a intentar.';
    if (/Timeout|timed out/i.test(d)) return 'La fuente tardó demasiado en responder.';
    return d.length > 140 ? d.slice(0, 140) + '…' : d;
  }

  function estadoExtraccion(M) {
    const E = M.estado_fuentes || {};
    const claves = Object.keys(E);
    if (!claves.length) { U.$('#d-estado-nota').textContent = 'Aún no hay un reporte de extracción (ejecute python -m etl run).'; return; }
    const fall = M.fuentes_fallidas || [];
    U.$('#d-estado-nota').innerHTML = `Última extracción: ${U.esc(String(M.ultima_extraccion || '').replace('T', ' ').slice(0, 16))} UTC. ` +
      (fall.length ? `<b>${fall.length} fuente(s) no se actualizaron</b>; la página usa su última copia buena, sin datos a medias.`
        : 'Todas las fuentes respondieron bien.') + ' Antes de cada extracción se guarda una copia comprimida de los datos crudos.';
    U.$('#t-estado').innerHTML = `<thead><tr><th>Fuente</th><th>Estado</th><th>Última descarga buena</th><th>Detalle</th></tr></thead><tbody>${
      claves.sort().map((k) => { const e = E[k], [ic, txt] = ESTADO[e.estado] || ['circle-question', e.estado];
        return `<tr class="${fall.includes(k) ? 'hi' : ''}"><td>${U.esc(NOMBRE(k))}</td><td class="est-${e.estado}">${U.ico(ic)} ${txt}</td>
          <td class="small">${U.esc(String(e.ultima_descarga_buena || '—').replace('T', ' ').slice(0, 16))}</td><td class="small muted" title="${U.esc(e.detalle || '')}">${U.esc(detalleClaro(e.detalle))}</td></tr>`; }).join('')}</tbody>`;
  }

  function render() {
    const M = RSM.meta;
    estadoExtraccion(M);
    U.$('#d-flow').replaceChildren(...[
      ['1 · Extraer', 'MEData (DKAN), GeoMedellín (ArcGIS), datos.gov.co (Socrata), SIATA. Incremental, con reintentos.'],
      ['2 · Limpiar', 'Texto, fechas, coordenadas, comodines, duplicados. Lo inservible va a cuarentena con su motivo.'],
      ['3 · Integrar', 'Serie unificada sin duplicados, comuna por polígono, cámara más cercana, lluvia de la hora, festivos.'],
      ['4 · Cargar', 'Parquet + bodega DuckDB con vistas SQL y reporte de calidad.'],
      ['5 · Publicar', `Agregados para esta página (web/data). Última corrida: ${M.generado}.`],
    ].map(([t, d]) => U.el(`<div class="st"><b>${t}</b>${d}</div>`)));

    U.$('#t-fuentes').innerHTML = `<thead><tr><th>Entidad</th><th>Conjunto</th><th>Id / acceso</th><th>Uso en la página</th><th class="n">Filas cargadas</th></tr></thead><tbody>${
      FUENTES.map(([e, n, id, url, uso, tabla]) => `<tr><td>${e}</td><td><a href="${url}" target="_blank" rel="noopener">${U.esc(n)}</a></td><td class="small">${id}</td>
      <td class="small">${uso}</td><td class="n">${tabla && M.filas[tabla] != null ? U.n0(M.filas[tabla]) : '—'}</td></tr>`).join('')}</tbody>`;

    U.$('#d-reglas').replaceChildren(...RSM.calidad.fuentes.filter((f) => f.reglas.length).map((f) => U.el(`<div>
      <h3 style="font-size:15px">${U.esc(f.nombre)}</h3>
      <p class="note">${f.leidas != null ? U.n0(f.leidas) + ' filas leídas' : ''}${f.limpias != null ? ' → ' + U.n0(f.limpias) + ' limpias' : ''}${f.rango ? ' · ' + f.rango.join(' a ') : ''}</p>
      <table><tbody>${f.reglas.map((r) => `<tr><td>${U.esc(r.regla)}</td><td class="n">${U.n0(r.n)}</td></tr>`).join('')}</tbody></table></div>`)));

    const cal = Object.fromEntries(RSM.calidad.fuentes.map((f) => [f.id, Object.fromEntries(f.reglas.map((r) => [r.regla, r.n]))]));
    const g = (ds, r) => (cal[ds] || {})[r];
    const vi = U.cal('victimas'), inc = U.cal('incidentes'), pr = U.cal('lesion_fatal_precipitacion'), caida = U.caidaSoloDanos();
    const hastaV = U.mesAnio(vi.rango?.[1]), hastaI = U.mesAnio(inc.rango?.[1]);
    const hall = [
      ['file-lines', `<b>Víctimas en incidentes viales</b> trae ${U.n0(g('victimas', 'Filas vacías eliminadas'))} filas vacías (el ${U.pct(g('victimas', 'Filas vacías eliminadas') / vi.leidas)} del archivo): está rellenado hasta el límite de Excel.`],
      ['calendar-days', `<b>Víctimas</b> declara actualización mensual, pero llega solo a ${hastaV}; <b>Incidentes viales</b>, a ${hastaI}.`],
      ['location-dot', `<b>Incidentes viales</b> usa la coordenada comodín [-75,7037; 6,2214] en ${U.n0(g('incidentes', 'Coordenada comodín anulada'))} registros. En GeoMedellín encontramos además ${U.n0(g('siniestralidad', 'Comodín detectado (punto repetido con direcciones dispersas)'))} siniestros en puntos repetidos que reciben direcciones de toda la ciudad (comodines no declarados).`],
      ['font', `Textos con escapes hexadecimales («Solo da\\xF1os») en ${U.n0(g('incidentes', 'Texto con escapes \\xNN reparado'))} filas y el año con «\\r» pegado.`],
      ['cloud-rain', `<b>Lesión fatal … con precipitación</b>: la columna <code>precipitacion</code> está ${U.n0(pr.r['Columna precipitación vacía (%)'])} % vacía en las ${U.n0(pr.leidas)} filas.`],
      ...(caida ? [['folder-open', `GeoMedellín dejó de publicar los siniestros «solo daños» desde ${caida.desde.anio} (de ${U.n0(caida.antes.solo_danos)} en ${caida.antes.anio} a ${U.n0(caida.desde.solo_danos)}) sin advertirlo.`]] : []),
    ];
    U.$('#d-hall').replaceChildren(...U.lista(hall));
    const prop = [
      ['1', `Actualizar <b>Víctimas</b> e <b>Incidentes viales</b> después de ${hastaV} con la periodicidad mensual que declara la ficha, sin filas vacías, en UTF-8 y con coordenada nula en vez de comodín.`],
      ['2', 'Agregar <code>COD_COMUNA</code> y <code>NRO_RADICADO</code> en ambos conjuntos para unirlos sin heurísticas.'],
      ['3', 'Llenar la columna <code>precipitacion</code> del conjunto SISC con la estación SIATA más cercana, o retirarla de la ficha.'],
      ['4', 'Abrir un conjunto <b>Cámaras de tránsito</b> con <code>ID_CAMARA, TIPO, LATITUD, LONGITUD, FECHA_INSTALACION</code>: permitiría medir si la siniestralidad baja alrededor de una cámara después de instalarla.'],
    ];
    U.$('#d-prop').replaceChildren(...prop.map(([i, t]) => U.el(`<li><span class="ri num-ri">${i}</span><span>${t}</span></li>`)));
    U.$('#d-lim').replaceChildren(...U.lista([
      ['ruler', 'La probabilidad de una ruta mide qué tan frecuentes son los siniestros en el corredor, no la probabilidad personal de accidentarse: no hay conteos de vehículos abiertos por vía.'],
      ['video', 'Estar cerca de una cámara es una asociación, no una causa: sin la fecha de instalación de cada cámara no se puede medir su efecto.'],
      ['folder-open', `Los análisis usan solo siniestros con heridos o muertos, porque GeoMedellín dejó de publicar los de «solo daños» en ${caida?.desde.anio ?? '2023'}. Las víctimas por actor vial llegan a ${hastaV}.`],
      ['cloud-rain', 'La lluvia histórica viene de una sola estación del IDEAM con vacíos; SIATA en vivo aporta el detalle de cada ruta.'],
    ]));
  }

  let listo = false;
  window.Datos = { init() { if (!listo) { listo = true; render(); } } };
})();
