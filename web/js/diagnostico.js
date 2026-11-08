/* Módulo 1 · ¿Qué está pasando? */
(function () {
  const D = () => RSM.diagnostico;

  function kpis() {
    const k = D().kpis;
    const items = [
      ['Siniestros con heridos o muertos', U.n0(k.siniestros_heridos), `${U.fecha(k.desde).slice(0, 7)} a ${U.fecha(k.hasta).slice(0, 7)}`],
      ['Por día, en promedio', U.n1(k.heridos_dia), 'siniestros con heridos'],
      ['Víctimas registradas', U.n0(k.victimas), `MEData ${U.fecha(k.victimas_desde).slice(0, 4)}-${U.fecha(k.victimas_hasta).slice(0, 7)}`],
      ['Muertes en vías', U.n0(k.muertes_sisc), `SISC ${k.sisc_desde}-${k.sisc_hasta}`],
      ['Víctimas que iban en moto', U.pct(k.pct_moto), 'conductor o acompañante'],
      ['Víctimas a más de 300 m de una CCTV', U.pct(k.pct_lejos_cctv), `distancia mediana ${U.n0(k.mediana_m_cctv)} m`],
    ];
    U.$('#d-kpis').replaceChildren(...items.map(([l, v, s]) =>
      U.el(`<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`)));
    U.$('#d-periodo').textContent = `Datos generados por el ETL el ${RSM.meta.generado}.`;
  }

  function serie() {
    const s = D().serie;
    U.$('#d-serie-nota').innerHTML = 'Barras: siniestros por año según su gravedad. Línea: muertes (SISC). 2014 solo tiene datos desde julio. ' +
      '<b>Desde 2023 GeoMedellín casi no publica siniestros “solo daños”</b>; por eso los análisis de esta página usan solo los siniestros con heridos o muertos.';
    new Chart(U.$('#ch-serie'), {
      data: {
        labels: s.map((r) => r.anio),
        datasets: [
          { type: 'bar', label: 'Con heridos', data: s.map((r) => r.con_heridos), backgroundColor: U.paleta[0], stack: 's' },
          { type: 'bar', label: 'Con muertos', data: s.map((r) => r.con_muertos), backgroundColor: U.paleta[4], stack: 's' },
          { type: 'bar', label: 'Solo daños', data: s.map((r) => r.solo_danos), backgroundColor: U.color('--line'), stack: 's' },
          { type: 'line', label: 'Muertes (SISC)', data: s.map((r) => r.muertes_sisc), borderColor: U.paleta[1], backgroundColor: U.paleta[1],
            yAxisID: 'y2', tension: .25, spanGaps: false },
        ],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'siniestros' } },
          y2: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'muertes' } } },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${U.n0(c.raw)}` } } },
      },
    });
  }

  function calor() {
    const { dias, matriz } = D().calor;
    const max = Math.max(...matriz.flat());
    const acc = U.color('--accent');
    const box = U.$('#d-heat');
    box.append(U.el('<span></span>'));
    for (let h = 0; h < 24; h++) box.append(U.el(`<span class="h">${h % 3 === 0 ? h : ''}</span>`));
    matriz.forEach((fila, d) => {
      box.append(U.el(`<span class="d">${dias[d]}</span>`));
      fila.forEach((v, h) => {
        const c = U.el(`<span class="c" title="${dias[d]} ${h}:00 · ${U.n0(v)} siniestros"></span>`);
        c.style.background = `color-mix(in srgb, ${acc} ${Math.round(8 + 92 * (v / max))}%, transparent)`;
        box.append(c);
      });
    });
    const leg = U.$('#d-heat-leg');
    [10, 30, 55, 80, 100].forEach((p) => { const i = U.el('<i style="width:18px;height:10px;border-radius:2px"></i>'); i.style.background = `color-mix(in srgb, ${acc} ${p}%, transparent)`; leg.append(i); });
  }

  function factores() {
    const box = U.$('#d-factores');
    for (const f of D().factores) {
      const max = Math.max(...f.items.map((i) => i.v || 0));
      const rows = f.items.map((i) => {
        const cls = i.ref ? '' : i.rr > 1.05 ? 'up' : i.rr < 0.95 ? 'down' : '';
        return `<div class="row"><span>${U.esc(i.k)}</span>
          <span class="bar"><span class="${i.ref ? 'ref' : ''}" style="width:${(100 * (i.v || 0)) / max}%"></span></span>
          <span class="rr ${cls}">${i.ref ? 'ref.' : U.veces(i.rr)}</span></div>`;
      }).join('');
      const extra = f.id === 'lluvia' ? `<p class="note">${U.n0(f.horas)} horas con medición de la estación IDEAM Olaya Herrera.</p>` : '';
      box.append(U.el(`<div class="factor" style="display:flex;flex-direction:column;gap:7px"><h3 style="font-size:15px">${f.titulo}</h3>
        <p class="note" style="margin-top:-4px">${f.unidad}</p>${rows}${extra}</div>`));
    }
  }

  function actores() {
    const a = D().actores;
    new Chart(U.$('#ch-actor'), {
      type: 'bar',
      data: { labels: a.map((r) => r.actor), datasets: [
        { label: 'Víctimas', data: a.map((r) => r.victimas), backgroundColor: U.paleta[0], yAxisID: 'y' },
        { label: 'Muertos por 1.000 víctimas', data: a.map((r) => r.letalidad_x1000), backgroundColor: U.paleta[4], yAxisID: 'y2' }] },
      options: { scales: { y: { beginAtZero: true, title: { display: true, text: 'víctimas' } }, y2: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'por 1.000' } } },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.datasetIndex ? U.n1(c.raw) : U.n0(c.raw)}` } } } },
    });
    const e = D().edad_sexo;
    const grupos = [...new Set(e.map((r) => r.grupo_edad))];
    const val = (g, s) => (e.find((r) => r.grupo_edad === g && r.sexo === s) || {}).n || 0;
    new Chart(U.$('#ch-edad'), {
      type: 'bar',
      data: { labels: grupos, datasets: [
        { label: 'Hombres', data: grupos.map((g) => val(g, 'M')), backgroundColor: U.paleta[0] },
        { label: 'Mujeres', data: grupos.map((g) => val(g, 'F')), backgroundColor: U.paleta[3] }] },
      options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${U.n0(c.raw)}` } } } },
    });
  }

  function mapa() {
    const m = U.mapa('map-diag');
    const pts = RSM.grilla.puntos;
    const max = pts[0]?.tot || 1;
    for (const p of pts) {
      L.circleMarker([p.lat, p.lon], { radius: 1.5 + 9 * Math.sqrt(p.tot / max), color: U.paleta[4], weight: .6, fillOpacity: .3 })
        .bindTooltip(`<b>${U.esc(p.dir || 'Sin dirección')}</b><br>${U.esc(p.comuna || '')}<br>${U.n0(p.tot)} siniestros con heridos`).addTo(m);
    }
    for (const c of RSM.camaras.filter((c) => c.tipo === 'CCTV')) {
      L.circleMarker([c.lat, c.lon], { radius: 4, color: U.paleta[0], weight: 2, fillOpacity: .9 }).bindTooltip(`CCTV · ${U.esc(c.nombre)}`).addTo(m);
    }
    return m;
  }

  function comunas() {
    const c = D().comunas;
    const rows = c.map((r) => `<tr class="${r.cctv === 0 ? 'hi' : ''}"><td>${U.esc(r.comuna)}</td><td class="n">${U.n0(r.siniestros)}</td>
      <td class="n">${U.n0(r.siniestros_2021_2025)}</td><td class="n">${U.n0(r.victimas)}</td><td class="n">${U.n0(r.muertos)}</td>
      <td class="n">${r.cctv}</td><td class="n">${r.fdt}</td></tr>`).join('');
    U.$('#t-comunas').innerHTML = `<thead><tr><th>Comuna</th><th class="n">Siniestros con heridos 2014-2025</th><th class="n">2021-2025</th>
      <th class="n">Víctimas</th><th class="n">Muertos</th><th class="n">CCTV</th><th class="n">Fotomultas</th></tr></thead><tbody>${rows}</tbody>`;
  }

  let mapaDiag = null, listo = false;
  window.Diagnostico = {
    init() {
      if (listo) { mapaDiag && mapaDiag.invalidateSize(); return; }
      listo = true;
      kpis(); serie(); calor(); factores(); actores(); comunas();
      mapaDiag = mapa();
    },
  };
})();
