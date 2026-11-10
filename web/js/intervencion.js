/* Módulo 3 · ¿Dónde intervenir? — priorización de puntos críticos sin cámara CCTV */
(function () {
  let mapa, listo = false;

  function render() {
    const I = RSM.intervencion;
    U.$('#i-lede').innerHTML = `Entre 2019 y 2025, el <b>${U.pct(1 - I.pct_cubierto_cctv, 0)}</b> de los siniestros con heridos o muertos
      ocurrió a más de 300 m de una cámara de circuito cerrado. Esta lista ordena los lugares donde una cámara nueva, un operativo
      o un rediseño vial tendrían más impacto.`;
    U.$('#i-regla').textContent = `Regla de priorización: ${I.regla}.`;

    mapa = U.mapa('map-int', { scroll: true });
    for (const c of RSM.camaras.filter((c) => c.tipo === 'CCTV')) {
      L.circle([c.lat, c.lon], { radius: 300, color: '#8A8D96', weight: 1, fillOpacity: .05 }).bindTooltip(`CCTV · ${U.esc(c.nombre)}`).addTo(mapa);
    }
    const max = I.puntos[0]?.puntaje || 1;
    I.puntos.forEach((p, k) => {
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: '', html: `<div style="background:#E53945;color:#08090B;border-radius:0;;width:${22 + 10 * p.puntaje / max}px;height:${22 + 10 * p.puntaje / max}px;display:grid;place-items:center;font:700 13px Inter,sans-serif;border:1px solid #F0F0F0">${k + 1}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
      }).bindTooltip(`<b>${k + 1}. ${U.esc(p.dir || '')}</b><br>${U.esc(p.comuna || '')}<br>${U.n0(p.con_heridos)} siniestros con heridos · ${U.n0(p.muertes)} muertes<br>CCTV más cercana: ${U.n0(p.dist_cctv)} m`).addTo(mapa);
    });
    // los 3 primeros laten para guiar la mirada
    I.puntos.slice(0, 3).forEach((p) => L.marker([p.lat, p.lon], { interactive: false, keyboard: false, zIndexOffset: -10,
      icon: L.divIcon({ className: '', html: '<div class="pulso grande"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(mapa));
    if (I.puntos.length) mapa.fitBounds(I.puntos.map((p) => [p.lat, p.lon]), { padding: [30, 30] });
    conclusiones();

    U.$('#t-int').innerHTML = `<thead><tr><th>#</th><th>Lugar</th><th class="n">Siniestros con heridos</th><th class="n">Muertes</th>
      <th class="n">2023-2025</th><th class="n">CCTV más cercana</th></tr></thead><tbody>${I.puntos.map((p, k) =>
      `<tr><td>${k + 1}</td><td><b>${U.esc(p.dir || '—')}</b><br><span class="muted small">${U.esc(p.comuna || '')}</span></td>
       <td class="n">${U.n0(p.con_heridos)}</td><td class="n">${U.n0(p.muertes)}</td><td class="n">${U.n0(p.ultimos_3)}</td>
       <td class="n">${U.n0(p.dist_cctv)} m</td></tr>`).join('')}</tbody>`;

    const sc = I.comunas_sin_cctv;
    new Chart(U.$('#ch-sincctv'), {
      type: 'bar',
      data: { labels: sc.map((r) => r.comuna), datasets: [{ label: 'Siniestros con heridos 2019-2025', data: sc.map((r) => r.siniestros), backgroundColor: '#E53945' }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => U.n0(c.raw) + ' siniestros' } } } },
    });
  }

  /* conclusiones del informe, calculadas con los mismos datos (nada escrito a mano) */
  function conclusiones() {
    const D = RSM.diagnostico, k = D.kpis, I = RSM.intervencion;
    const f = (id, pre) => (D.factores.find((x) => x.id === id)?.items || []).find((i) => String(i.k).startsWith(pre)) || {};
    const s = D.serie.filter((r) => r.meses === 12), ult = s[s.length - 1], her = (r) => (r.con_heridos || 0) + (r.con_muertos || 0);
    const prom = s.slice(0, -1).reduce((a, r) => a + her(r), 0) / (s.length - 1);
    const sin = I.comunas_sin_cctv.slice(0, 3).map((c) => c.comuna).join(', ');
    const C = [
      ['La siniestralidad no está bajando.', `${ult.anio} cerró con ${U.n0(her(ult))} siniestros con heridos, ${U.pct(her(ult) / prom - 1, 0)} por encima del promedio de los años anteriores.`],
      ['La vigilancia no está donde ocurren los siniestros.', `El ${U.pct(k.pct_lejos_cctv, 0)} de las víctimas cayó a más de 300 m de una cámara de circuito cerrado, y comunas como ${sin} no tienen ninguna.`],
      ['El riesgo se concentra en horas y personas identificables.', `En hora pico hay ${U.n1(f('hora_pico', 'Hora pico').rr)}× más siniestros por hora; un peatón víctima tiene ${U.n1(f('actor', 'Peatón').rr)}× la letalidad de quien va en carro, y la madrugada es ${U.n1(f('franja', 'Madrugada').rr)}× más letal que la tarde.`],
      ['Recomendación para la Secretaría de Movilidad.', `Priorizar cámaras, operativos o rediseños en los ${I.puntos.length} lugares de este capítulo, empezando por ${U.esc(I.puntos[0]?.dir || '')} (${U.esc(I.puntos[0]?.comuna || '')}), y medir su efecto con una fecha de instalación pública de cada cámara.`],
      ['Recomendación para quien se mueve por la ciudad.', 'Consultar la ruta antes de salir, evitar la hora pico cuando sea posible y extremar el cuidado en los tramos críticos que señala el capítulo 2.'],
    ];
    U.$('#i-concl').innerHTML = C.map(([t, d]) => `<li><b>${t}</b> ${d}</li>`).join('');
  }

  window.Intervencion = { init() { if (listo) { mapa.invalidateSize(); return; } listo = true; render(); } };
})();
