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
      L.circle([c.lat, c.lon], { radius: 300, color: '#0f6cbd', weight: 1, fillOpacity: .06 }).bindTooltip(`CCTV · ${U.esc(c.nombre)}`).addTo(mapa);
    }
    const max = I.puntos[0]?.puntaje || 1;
    I.puntos.forEach((p, k) => {
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: '', html: `<div style="background:#c0392b;color:#fff;border-radius:50%;width:${22 + 10 * p.puntaje / max}px;height:${22 + 10 * p.puntaje / max}px;display:grid;place-items:center;font:700 12px Inter;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${k + 1}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
      }).bindTooltip(`<b>${k + 1}. ${U.esc(p.dir || '')}</b><br>${U.esc(p.comuna || '')}<br>${U.n0(p.con_heridos)} siniestros con heridos · ${U.n0(p.muertes)} muertes<br>CCTV más cercana: ${U.n0(p.dist_cctv)} m`).addTo(mapa);
    });
    if (I.puntos.length) mapa.fitBounds(I.puntos.map((p) => [p.lat, p.lon]), { padding: [30, 30] });

    U.$('#t-int').innerHTML = `<thead><tr><th>#</th><th>Lugar</th><th class="n">Siniestros con heridos</th><th class="n">Muertes</th>
      <th class="n">2023-2025</th><th class="n">CCTV más cercana</th></tr></thead><tbody>${I.puntos.map((p, k) =>
      `<tr><td>${k + 1}</td><td><b>${U.esc(p.dir || '—')}</b><br><span class="muted small">${U.esc(p.comuna || '')}</span></td>
       <td class="n">${U.n0(p.con_heridos)}</td><td class="n">${U.n0(p.muertes)}</td><td class="n">${U.n0(p.ultimos_3)}</td>
       <td class="n">${U.n0(p.dist_cctv)} m</td></tr>`).join('')}</tbody>`;

    const sc = I.comunas_sin_cctv;
    new Chart(U.$('#ch-sincctv'), {
      type: 'bar',
      data: { labels: sc.map((r) => r.comuna), datasets: [{ label: 'Siniestros con heridos 2019-2025', data: sc.map((r) => r.siniestros), backgroundColor: '#c0392b' }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => U.n0(c.raw) + ' siniestros' } } } },
    });
  }

  window.Intervencion = { init() { if (listo) { mapa.invalidateSize(); return; } listo = true; render(); } };
})();
