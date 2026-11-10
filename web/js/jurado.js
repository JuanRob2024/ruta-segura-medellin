/* Página del jurado: reproducibilidad, validación en vivo, calidad, estadística detallada, comportamiento temporal
 * y simulación de escenarios. Todo se calcula en el navegador con web/data/*.js (agregados que genera el ETL). */
(function () {
  const D = RSM.diagnostico, J = RSM.jurado, G = RSM.grilla;
  const P = U.paleta; // gris, blanco, gris oscuro, gris claro, ROJO (fatalidad), rojo oscuro, rojo claro, línea
  const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const COS = Math.cos((6.25 * Math.PI) / 180);
  const dm = (la1, lo1, la2, lo2) => { const y = (la2 - la1) * 110574, x = (lo2 - lo1) * 111320 * COS; return Math.sqrt(x * x + y * y); };
  const factor = (id, pre) => (D.factores.find((f) => f.id === id)?.items || []).find((i) => String(i.k).startsWith(pre)) || {};
  const hora = (h) => (h === 0 ? '12 a. m.' : h < 12 ? `${h} a. m.` : h === 12 ? '12 m.' : `${h - 12} p. m.`);

  // ================================================================ resumen y rúbrica
  function resumen() {
    U.$('#meta-gen').textContent = `Datos: ${RSM.meta.generado}`;
    U.$('#r-gen').textContent = `Última corrida: ${RSM.meta.generado}.`;
    const R = [
      ['Uso de datos abiertos de MEData', 30, '5 conjuntos integrados (Víctimas, Incidentes, Lesión fatal SISC, Aforos, Velocidad) + 1 perfilado; 6 hallazgos de calidad y 4 propuestas de apertura', '#calidad · Módulo 4 de la página pública'],
      ['Análisis de información', 20, 'Serie unificada sin duplicados, base comparable (solo con heridos), tasas y razones de tasas; cifras verificadas en vivo; 20 pruebas', '#validacion · #estadistica'],
      ['Diseño y creatividad', 15, 'Página pública personalizada por medio de transporte y comuna; consulta de ruta con mapa, cámaras en vivo y clima', 'index.html'],
      ['Impacto potencial', 15, 'Ciudadano: elegir ruta y hora. Secretaría de Movilidad: dónde ubicar cámaras (simulador A) con ranking robusto (simulador C)', '#simulaciones · Módulo 3'],
      ['Uso de otras fuentes', 10, 'GeoMedellín (siniestros 2019-2025, cámaras, comunas), SIATA en vivo, IDEAM vía datos.gov.co, SIMM', '#calidad · Módulo 4'],
      ['Automatización, IA o tecnologías emergentes', 10, 'Pipeline incremental y programable, reanudación de descargas, detección automática de comodines, motor de riesgo; IA declarada', 'instrucciones.txt · DOCUMENTACION.md'],
    ];
    U.$('#t-rubrica').innerHTML = `<thead><tr><th>Criterio</th><th class="n">Puntos</th><th>Evidencia</th><th>Dónde verlo</th></tr></thead><tbody>${
      R.map(([c, p, e, d]) => `<tr><td><b>${c}</b></td><td class="n">${p}</td><td>${e}</td><td class="small">${d.replace(/#(\w+)/g, '<a href="#$1">#$1</a>')}</td></tr>`).join('')}</tbody>`;
  }

  // ================================================================ validación en vivo
  function validacion() {
    const k = D.kpis, I = RSM.intervencion;
    const V = [
      ['Siniestros con heridos o muertos (2014-07 → 2025-12)', 284981, k.siniestros_heridos, U.n0, 0.5, 'diagnostico.kpis'],
      ['Víctimas MEData depuradas', 234769, k.victimas, U.n0, 0.5, 'fact_victima'],
      ['Muertes en las vías SISC 2014-2023', 2854, k.muertes_sisc, U.n0, 0.5, 'fact_muerte_sisc'],
      ['Víctimas a más de 300 m de una CCTV', 0.702, k.pct_lejos_cctv, (x) => U.pct(x), 0.0005, 'fact_victima.cubierto_cctv_300m'],
      ['Siniestros con heridos 2019-2025 lejos de una CCTV', 0.75, 1 - I.pct_cubierto_cctv, (x) => U.pct(x, 0), 0.005, 'intervencion'],
      ['Hora pico: razón de tasas por hora', 1.95, factor('hora_pico', 'Hora pico').rr, U.n2, 0.005, 'factores.hora_pico'],
      ['Peatón: letalidad frente a vehículo', 6.75, factor('actor', 'Peatón').rr, U.n2, 0.005, 'factores.actor'],
      ['Madrugada: letalidad frente a la tarde', 2.71, factor('franja', 'Madrugada').rr, U.n2, 0.005, 'factores.franja'],
      ['Lluvia: razón de tasas por hora', 1.02, D.factores.find((f) => f.id === 'lluvia')?.rr, U.n2, 0.005, 'factores.lluvia (IDEAM)'],
      ['Comuna sin CCTV con más siniestros 2019-2025', 'Aranjuez', I.comunas_sin_cctv[0]?.comuna, (x) => x, null, 'intervencion.comunas_sin_cctv'],
      ['Punto prioritario n.º 1 sin CCTV', 'CR 53 CL 53', I.puntos[0]?.dir, (x) => x, null, 'intervencion.puntos'],
      ['Controles de consistencia (total = Σ años = Σ gravedad; sin radicados repetidos)', 'sin fallas',
        (RSM.meta.controles_consistencia || []).length ? RSM.meta.controles_consistencia.join('; ') : 'sin fallas', (x) => x, null, 'meta.controles_consistencia'],
    ];
    U.$('#t-valida').innerHTML = `<thead><tr><th>Cifra declarada</th><th class="n">Declarado</th><th class="n">Calculado ahora</th><th>Estado</th><th>Origen</th></tr></thead><tbody>${
      V.map(([t, dec, cal, f, tol, src]) => {
        const ok = tol == null ? dec === cal : Math.abs(dec - cal) <= tol;
        return `<tr><td>${t}</td><td class="n">${f(dec)}</td><td class="n"><b>${f(cal)}</b></td>
          <td class="${ok ? 'ok-si' : 'ok-no'}">${ok ? U.ico('circle-check') + ' coincide' : U.ico('circle-exclamation') + ' cambió la fuente'}</td><td class="small muted">${src}</td></tr>`;
      }).join('')}</tbody>`;
  }

  // ================================================================ calidad
  function calidad() {
    const F = RSM.calidad.fuentes.filter((f) => f.leidas), vic = F.find((f) => f.id === 'victimas');
    U.$('#q-embudo').innerHTML = `<div class="emb">${F.map((f) => {
      const keep = f.limpias != null ? f.limpias / f.leidas : null;
      return `<span>${U.esc(f.nombre.replace('MEData · ', '').replace('GeoMedellín · ', 'GeoMedellín: '))}<br><small>${U.n0(f.leidas)} → ${f.limpias != null ? U.n0(f.limpias) : 'solo perfilado'}${keep != null ? ` (${U.pct(keep, 1)})` : ''}</small></span>
        <div class="barras"><span class="b leidas" style="--w:100%"></span>${keep != null ? `<span class="b limpias" style="--w:${100 * keep}%"></span>` : ''}</div>`;
    }).join('')}</div><p class="note" style="margin-top:8px">Gris: filas leídas. Blanco: filas limpias (proporción de lo leído).${vic ? ` Víctimas conserva el ${U.pct(vic.limpias / vic.leidas, 0)}
      porque el archivo viene rellenado con filas vacías hasta el límite de Excel.` : ''}</p>`;
    const reglas = [];
    for (const f of F) for (const r of f.reglas) if (!/%/.test(r.regla)) reglas.push({ ...r, f: f.nombre.replace('MEData · ', '').split(' ')[0] });
    reglas.sort((a, b) => b.n - a.n);
    const top = reglas.slice(0, 12), mx = Math.log10(top[0].n);
    U.$('#q-reglas').innerHTML = `<div class="emb">${top.map((r) => `<span>${U.esc(r.regla)}<br><small>${U.esc(r.f)}</small></span>
      <div class="barras"><span class="b limpias" style="--w:${(100 * Math.log10(r.n)) / mx}%"></span><small>${U.n0(r.n)} filas</small></div>`).join('')}</div>
      <p class="note" style="margin-top:8px">Escala logarítmica para que se vean las reglas pequeñas junto a las de cientos de miles.</p>`;
  }

  // ================================================================ estadística detallada
  function estadistica() {
    const k = D.kpis;
    const items = [['Siniestros con heridos o muertos', U.n0(k.siniestros_heridos), `${U.fecha(k.desde).slice(0, 7)} → ${U.fecha(k.hasta).slice(0, 7)}`],
      ['Por día', U.n1(k.heridos_dia), 'promedio'], ['Víctimas MEData', U.n0(k.victimas), `${U.fecha(k.victimas_desde).slice(0, 7)} → ${U.fecha(k.victimas_hasta).slice(0, 7)}`],
      ['Muertes SISC', U.n0(k.muertes_sisc), `${k.sisc_desde}-${k.sisc_hasta}`], ['Letalidad', U.n1(k.letalidad_x1000), 'muertos por 1.000 víctimas'],
      ['Víctimas lejos de una CCTV', U.pct(k.pct_lejos_cctv), `mediana ${U.n0(k.mediana_m_cctv)} m`]];
    U.$('#e-kpis').replaceChildren(...items.map(([l, v, s]) => U.el(`<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`)));
    const cuentas = [[k.siniestros_heridos, U.n0], [k.heridos_dia, U.n1], [k.victimas, U.n0], [k.muertes_sisc, U.n0], [k.letalidad_x1000, U.n1], [k.pct_lejos_cctv, (x) => U.pct(x)]];
    document.querySelectorAll('#e-kpis .kpi .v').forEach((el, i) => U.contar(el, cuentas[i][0], cuentas[i][1]));

    const s = D.serie;
    const parciales = (campo, etq) => s.filter((r) => r[campo] && r[campo] < 12).map((r) => `${r.anio} (${r[campo]} meses de ${etq})`);
    const parc = [...parciales('meses', 'siniestros'), ...parciales('meses_victimas', 'víctimas'), ...parciales('meses_sisc', 'muertes SISC')];
    U.$('#e-serie-nota').innerHTML = 'Barras: siniestros por gravedad; línea roja: muertes SISC. <b>Desde 2023 GeoMedellín casi no publica «solo daños»</b>: por eso los análisis usan solo siniestros con heridos o muertos.' +
      (parc.length ? ` <b>Años incompletos</b> (no son caídas reales): ${parc.join(' · ')}.` : '');
    new Chart(U.$('#ch-serie'), {
      data: { labels: s.map((r) => r.anio), datasets: [
        { type: 'bar', label: 'Con heridos', data: s.map((r) => r.con_heridos), backgroundColor: P[0], stack: 's' },
        { type: 'bar', label: 'Con muertos', data: s.map((r) => r.con_muertos), backgroundColor: P[4], stack: 's' },
        { type: 'bar', label: 'Solo daños', data: s.map((r) => r.solo_danos), backgroundColor: P[7], stack: 's' },
        { type: 'line', label: 'Muertes (SISC)', data: s.map((r) => r.muertes_sisc), borderColor: P[4], backgroundColor: P[4], yAxisID: 'y2', tension: .25 }] },
      options: { interaction: { mode: 'index', intersect: false },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true }, y2: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false } } },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${U.n0(c.raw)}` } } } },
    });

    const m = J.mensual, corte = J.corte_medata.slice(0, 7);
    new Chart(U.$('#ch-mensual'), {
      type: 'line',
      data: { labels: m.map((r) => r.mes), datasets: [
        { label: 'MEData', data: m.map((r) => (r.mes < corte ? r.heridos : null)), borderColor: P[0], pointRadius: 0, borderWidth: 1.6 },
        { label: 'GeoMedellín', data: m.map((r) => (r.mes >= corte ? r.heridos : null)), borderColor: P[1], pointRadius: 0, borderWidth: 1.6 },
        { label: 'Marcas', type: 'bar', data: m.map((r) => (r.mes === '2020-03' || r.mes === corte ? Math.max(...m.map((x) => x.heridos)) : null)),
          backgroundColor: 'rgba(229,57,69,.35)', barThickness: 2 }] },
      options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { beginAtZero: true } },
        plugins: { legend: { labels: { filter: (l) => l.text !== 'Marcas' } },
          tooltip: { filter: (c) => c.dataset.label !== 'Marcas', callbacks: { label: (c) => `${c.dataset.label}: ${U.n0(c.raw)}` } } } },
    });

    // hora × día
    const { dias, matriz } = D.calor, max = Math.max(...matriz.flat()), box = U.$('#e-heat');
    box.append(U.el('<span></span>'));
    for (let h = 0; h < 24; h++) box.append(U.el(`<span class="h">${h % 3 === 0 ? h : ''}</span>`));
    matriz.forEach((fila, d) => {
      box.append(U.el(`<span class="d">${dias[d]}</span>`));
      fila.forEach((v, h) => { const c = U.el(`<span class="c" title="${dias[d]} ${h}:00 · ${U.n0(v)}"></span>`); c.style.background = `color-mix(in srgb, #F0F0F0 ${Math.round(6 + 94 * (v / max))}%, #101114)`; box.append(c); });
    });

    // factores
    const fb = U.$('#e-factores');
    for (const f of D.factores) {
      const mx = Math.max(...f.items.map((i) => i.v || 0));
      fb.append(U.el(`<div class="factor" style="display:flex;flex-direction:column;gap:6px"><h3 style="font-size:15px">${f.titulo}</h3>
        <p class="note" style="margin-top:-4px">${f.unidad}</p>${f.items.map((i) => `<div class="row"><span>${U.esc(i.k)}</span>
        <span class="bar"><span class="${i.ref ? 'ref' : ''}" style="width:${(100 * (i.v || 0)) / mx}%"></span></span>
        <span class="rr ${i.ref ? '' : i.rr > 1.05 ? 'up' : 'down'}">${i.ref ? 'ref.' : U.veces(i.rr)}</span></div>`).join('')}</div>`));
    }

    const a = D.actores;
    new Chart(U.$('#ch-actor'), { type: 'bar', data: { labels: a.map((r) => r.actor), datasets: [
      { label: 'Víctimas', data: a.map((r) => r.victimas), backgroundColor: P[0], yAxisID: 'y' },
      { label: 'Muertos por 1.000 víctimas', data: a.map((r) => r.letalidad_x1000), backgroundColor: P[4], yAxisID: 'y2' }] },
      options: { scales: { y: { beginAtZero: true }, y2: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false } } } } });
    const e = D.edad_sexo, gr = [...new Set(e.map((r) => r.grupo_edad))], val = (g, sx) => (e.find((r) => r.grupo_edad === g && r.sexo === sx) || {}).n || 0;
    new Chart(U.$('#ch-edad'), { type: 'bar', data: { labels: gr, datasets: [
      { label: 'Hombres', data: gr.map((g) => val(g, 'M')), backgroundColor: P[0] }, { label: 'Mujeres', data: gr.map((g) => val(g, 'F')), backgroundColor: P[1] }] } });

    U.$('#t-comunas').closest('.card').querySelector('.note').textContent =
      `Ubicadas con el polígono oficial. Resaltadas, las comunas sin cámaras CCTV. ${U.n0(D.kpis.victimas_sin_comuna_geo)} víctimas sin coordenada válida no se pueden asignar a una comuna: cuentan en el total de la ciudad, pero no en esta tabla.`;
    U.$('#t-comunas').innerHTML = `<thead><tr><th>Comuna</th><th class="n">Siniestros con heridos 2014-2025</th><th class="n">2021-2025</th>
      <th class="n">Víctimas</th><th class="n">Muertos</th><th class="n">CCTV</th><th class="n">Fotomultas</th><th class="n">Apoyo semafórico</th></tr></thead><tbody>${
      D.comunas.map((r) => `<tr class="${r.cctv === 0 ? 'hi' : ''}"><td>${U.esc(r.comuna)}</td><td class="n">${U.n0(r.siniestros)}</td><td class="n">${U.n0(r.siniestros_2021_2025)}</td>
      <td class="n">${U.n0(r.victimas)}</td><td class="n">${U.n0(r.muertos)}</td><td class="n">${r.cctv}</td><td class="n">${r.fdt}</td><td class="n">${r.ars}</td></tr>`).join('')}</tbody>`;
  }

  // ================================================================ comportamiento en el tiempo
  function tiempo() {
    const A = J.anios, pts = J.puntos_anio, maxAll = Math.max(...pts.flatMap((p) => p[4]));
    const mapa = U.mapa('map-tiempo', { preferCanvas: true });
    const marcas = pts.map((p) => L.circleMarker([p[0], p[1]], { radius: 0, color: P[1], weight: .6, fillColor: P[1], fillOpacity: .35 })
      .bindTooltip('').addTo(mapa));
    const sl = U.$('#t-anio'); sl.max = A.length - 1;
    function pintar(i) {
      const a = A[i];
      U.$('#t-label').textContent = a;
      pts.forEach((p, k) => {
        const v = p[4][i];
        marcas[k].setRadius(v ? 1.5 + 13 * Math.sqrt(v / maxAll) : 0).setTooltipContent(`<b>${U.esc(p[2] || '')}</b><br>${U.esc(p[3] || '')}<br>${a}: ${U.n0(v)} siniestros con heridos`);
      });
      const top = pts.map((p) => [p, p[4][i], i ? p[4][i - 1] : null]).sort((x, y) => y[1] - x[1]).slice(0, 10);
      U.$('#t-tit').textContent = `Los más siniestrados en ${a}`;
      const notas = { 2014: 'Datos desde julio (MEData).', 2020: 'Pandemia: confinamiento desde marzo; desde septiembre la fuente es GeoMedellín.', 2021: 'Primer año completo con GeoMedellín.' };
      U.$('#t-nota').textContent = notas[a] || '';
      U.$('#t-top').innerHTML = `<thead><tr><th>#</th><th>Lugar</th><th class="n">${a}</th><th class="n">vs. año anterior</th></tr></thead><tbody>${
        top.map(([p, v, prev], k) => { const d = prev == null ? null : v - prev;
          return `<tr><td>${k + 1}</td><td><b>${U.esc(p[2] || '—')}</b><br><span class="muted small">${U.esc(p[3] || '')}</span></td><td class="n">${U.n0(v)}</td>
            <td class="n ${d > 0 ? 'delta-up' : 'delta-dn'}">${d == null ? '—' : (d > 0 ? '+' : '') + U.n0(d)}</td></tr>`; }).join('')}</tbody>`;
    }
    let timer = null;
    sl.addEventListener('input', () => pintar(+sl.value));
    U.$('#t-play').addEventListener('click', () => {
      if (timer) { clearInterval(timer); timer = null; U.$('#t-play').innerHTML = U.ico('play') + ' Reproducir'; return; }
      U.$('#t-play').innerHTML = U.ico('pause') + ' Pausa';
      if (+sl.value >= A.length - 1) sl.value = 0;
      timer = setInterval(() => {
        if (+sl.value >= A.length - 1) { clearInterval(timer); timer = null; U.$('#t-play').innerHTML = U.ico('play') + ' Reproducir'; return; }
        sl.value = +sl.value + 1; pintar(+sl.value);
      }, U.reducir() ? 1800 : 1100);
      pintar(+sl.value);
    });
    pintar(0);
  }

  // ================================================================ simulador A · cámaras
  const C = J.celdas_2019_2025, TOT = C.reduce((s, c) => s + c[2], 0);
  const dExist = C.map((c) => Math.min(...J.cctv.map(([la, lo]) => dm(c[0], c[1], la, lo))));
  const vecinosCache = new Map();
  function vecinos(i, r) {
    const key = i + '|' + r;
    if (vecinosCache.has(key)) return vecinosCache.get(key);
    const [la, lo] = C[i], out = [];
    const dLat = r / 110574, dLon = r / (111320 * COS);
    for (let j = 0; j < C.length; j++) {
      if (Math.abs(C[j][0] - la) > dLat || Math.abs(C[j][1] - lo) > dLon) continue;
      if (dm(la, lo, C[j][0], C[j][1]) <= r) out.push(j);
    }
    vecinosCache.set(key, out);
    return out;
  }
  function estrategias(r, N = 50) {
    const base = C.map((_, i) => dExist[i] <= r);
    const cov0 = C.reduce((s, c, i) => s + (base[i] ? c[2] : 0), 0) / TOT;
    const correr = (orden) => { // coloca cámaras en el orden dado
      const cub = base.slice(); let s = cov0 * TOT; const curva = [cov0], el = [];
      for (const i of orden.slice(0, N)) { for (const j of vecinos(i, r)) if (!cub[j]) { cub[j] = true; s += C[j][2]; } curva.push(s / TOT); el.push(i); }
      return { curva, el };
    };
    // optimizada (voraz) sobre los 700 lugares con más siniestros
    const cand = C.map((_, i) => i).slice(0, 700), cub = base.slice(); let s = cov0 * TOT; const curva = [cov0], el = [];
    for (let k = 0; k < N; k++) {
      let best = -1, gan = -1;
      for (const i of cand) { let g = 0; for (const j of vecinos(i, r)) if (!cub[j]) g += C[j][2]; if (g > gan) { gan = g; best = i; } }
      if (best < 0 || gan <= 0) break;
      for (const j of vecinos(best, r)) if (!cub[j]) { cub[j] = true; s += C[j][2]; }
      curva.push(s / TOT); el.push(best);
    }
    const mod3 = C.map((c, i) => [c[2] + 10 * c[3], i]).filter(([, i]) => dExist[i] > 300).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    const ing = C.map((_, i) => i); // ya viene ordenado por siniestros
    return { cov0, opt: { curva, el }, mod3: correr(mod3), ing: correr(ing) };
  }

  function simA() {
    const st = { e: 'opt' }, mapa = U.mapa('map-s1', { preferCanvas: true, zoom: 12 });
    const capa = L.layerGroup().addTo(mapa); let chart, res = null, rAct = null;
    function calc() {
      const n = +U.$('#s1-n').value, r = +U.$('#s1-r').value;
      U.$('#s1-nv').textContent = n; U.$('#s1-rv').textContent = r + ' m';
      if (r !== rAct) { res = estrategias(r); rAct = r; }
      const E = { opt: ['Optimizada', P[1]], mod3: ['Ranking módulo 3', P[0]], ing: ['Más siniestros', P[2]] };
      const val = (e) => res[e].curva[Math.min(n, res[e].curva.length - 1)];
      const elegido = res[st.e];
      U.$('#s1-res').innerHTML = `<span>Cobertura con ${n} cámara${n === 1 ? '' : 's'} nueva${n === 1 ? '' : 's'} (${E[st.e][0].toLowerCase()})</span>
        <b class="big">${U.pct(val(st.e))}</b><span>Hoy: <b>${U.pct(res.cov0)}</b> de los siniestros con heridos 2019-2025 a ≤ ${r} m de una CCTV
        (+${U.n1(100 * (val(st.e) - res.cov0))} puntos). Optimizada: ${U.pct(val('opt'))} · Módulo 3: ${U.pct(val('mod3'))} · Más siniestros: ${U.pct(val('ing'))}.</span>`;
      const labels = Array.from({ length: 51 }, (_, i) => i);
      const ds = Object.entries(E).map(([k, [lab, col]]) => ({ label: lab, data: labels.map((i) => 100 * (res[k].curva[Math.min(i, res[k].curva.length - 1)])),
        borderColor: col, borderWidth: k === st.e ? 3 : 1.5, pointRadius: labels.map((i) => (i === n && k === st.e ? 5 : 0)), pointBackgroundColor: col }));
      if (!chart) chart = new Chart(U.$('#ch-s1'), { type: 'line', data: { labels, datasets: ds },
        options: { animation: { duration: 300 }, scales: { x: { title: { display: true, text: 'cámaras nuevas' } }, y: { title: { display: true, text: '% de siniestros cubiertos' } } },
          plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${U.n1(c.raw)} %` } } } } });
      else { chart.data.datasets = ds; chart.update(); }
      capa.clearLayers();
      for (const [la, lo] of J.cctv) L.circle([la, lo], { radius: r, color: P[2], weight: 1, fillOpacity: .08, interactive: false }).addTo(capa);
      const sel = elegido.el.slice(0, n);
      sel.forEach((i, k) => {
        L.circle([C[i][0], C[i][1]], { radius: r, color: P[1], weight: 1.2, fillOpacity: .12, interactive: false }).addTo(capa);
        L.marker([C[i][0], C[i][1]], { icon: L.divIcon({ className: '', html: `<div class="nuevo" style="width:20px;height:20px">${k + 1}</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }) })
          .bindTooltip(`Cámara nueva ${k + 1}<br>${U.esc(C[i][4] || `${C[i][0]}, ${C[i][1]}`)}<br>${U.n0(C[i][2])} siniestros con heridos en la celda`).addTo(capa);
      });
    }
    ['#s1-n', '#s1-r'].forEach((s) => U.$(s).addEventListener('input', calc));
    U.$('#s1-e').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.e = b.dataset.e;
      U.$('#s1-e').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); calc(); });
    calc();
  }

  // ================================================================ simulador B · riesgo de ruta
  function simB() {
    const R = window.RUTA_EJEMPLO; let chart;
    const heat = U.$('#s2-heat');
    function calc() {
      const h = +U.$('#s2-h').value, d = +U.$('#s2-d').value, t = +U.$('#s2-t').value, rad = +U.$('#s2-rad').value, rr = +U.$('#s2-rr').value, ll = U.$('#s2-l').checked;
      U.$('#s2-hv').textContent = hora(h); U.$('#s2-dv').textContent = DIAS[d]; U.$('#s2-tv').textContent = t + ' min';
      U.$('#s2-radv').textContent = rad + ' m'; U.$('#s2-rrv').textContent = U.n2(rr) + '×';
      const fecha = new Date(2026, 10, 9 + d, h, 0); // 9-nov-2026 es lunes
      const ev = Riesgo.evaluar(R, G, { fecha, duracionMin: t, lluvia: ll, radio: rad, rr });
      U.$('#s2-res').innerHTML = `<span>Probabilidad de un siniestro con heridos en el corredor durante el viaje</span>
        <b class="big">${U.pct(ev.pViaje, 2)}</b><span>Nivel <b>${ev.nivel}</b> (${U.n2(ev.veces)}× la vía típica) · ${U.n0(ev.celdas)} celdas ·
        ${U.n1(ev.anual)} siniestros/año en el corredor · λ = ${ev.lambdaHora.toLocaleString('es-CO', { maximumFractionDigits: 4 })} por hora${ll ? ` · factor lluvia ${U.n2(ev.fLluvia)}` : ''}</span>`;
      // mapa de calor 7 × 24 con la misma ruta y supuestos (cálculo directo, sin rehacer el corredor)
      const k = (ev.anual / 365) * ev.fLluvia * (t / 60);
      const M = DIAS.map((_, di) => Array.from({ length: 24 }, (_, hi) => 1 - Math.exp(-k * 7 * G.perfil_dia[di] * G.perfil_hora[hi])));
      const mx = Math.max(...M.flat());
      heat.replaceChildren(U.el('<span></span>'));
      for (let x = 0; x < 24; x++) heat.append(U.el(`<span class="h">${x % 3 === 0 ? x : ''}</span>`));
      M.forEach((fila, di) => {
        heat.append(U.el(`<span class="d">${DIAS[di].slice(0, 3)}</span>`));
        fila.forEach((v, hi) => { const c = U.el(`<span class="c ${di === d && hi === h ? 'sel' : ''}" title="${DIAS[di]} ${hora(hi)} · ${U.pct(v, 2)}"></span>`);
          c.style.background = `color-mix(in srgb, #F0F0F0 ${Math.round(5 + 95 * (v / mx))}%, #101114)`; c.style.cursor = 'pointer';
          c.onclick = () => { U.$('#s2-h').value = hi; U.$('#s2-d').value = di; calc(); }; heat.append(c); });
      });
      const radios = Array.from({ length: 13 }, (_, i) => 20 + 5 * i);
      const data = radios.map((x) => 100 * Riesgo.evaluar(R, G, { fecha, duracionMin: t, lluvia: ll, radio: x, rr }).pViaje);
      const ds = [{ label: 'Probabilidad del viaje (%) según el radio del corredor', data, borderColor: P[1], pointRadius: radios.map((x) => (x === rad ? 5 : 2)), pointBackgroundColor: radios.map((x) => (x === rad ? P[4] : P[1])) }];
      if (!chart) chart = new Chart(U.$('#ch-s2'), { type: 'line', data: { labels: radios.map((x) => x + ' m'), datasets: ds },
        options: { animation: { duration: 250 }, scales: { y: { beginAtZero: true } }, plugins: { tooltip: { callbacks: { label: (c) => U.n2(c.raw) + ' %' } } } } });
      else { chart.data.datasets = ds; chart.update(); }
    }
    U.$('#s2-rr').value = G.rr_lluvia ? G.rr_lluvia.toFixed(2) : 1;
    ['#s2-h', '#s2-d', '#s2-t', '#s2-rad', '#s2-rr', '#s2-l'].forEach((s) => U.$(s).addEventListener('input', calc));
    calc();
  }

  // ================================================================ simulador C · robustez de la priorización
  function simC() {
    const rank = (w, r) => C.map((c, i) => [c[2] + w * c[3], i]).filter(([, i]) => dExist[i] > r).sort((a, b) => b[0] - a[0]).slice(0, 10).map((x) => x[1]);
    const base = rank(10, 300);
    function calc() {
      const w = +U.$('#s3-w').value, r = +U.$('#s3-r').value;
      U.$('#s3-wv').textContent = w + '×'; U.$('#s3-rv').textContent = r + ' m';
      const top = rank(w, r), comun = top.filter((i) => base.includes(i)).length;
      U.$('#s3-res').innerHTML = `<span>Lugares del top 10 de referencia (peso 10, 300 m) que se mantienen</span><b class="big">${comun} de 10</b>
        <span>${comun >= 8 ? 'La recomendación es robusta a estos supuestos.' : comun >= 5 ? 'Cambia parcialmente: conviene revisar los lugares nuevos.' : 'Cambia bastante: la decisión depende del supuesto.'}</span>`;
      U.$('#t-s3').innerHTML = `<thead><tr><th>#</th><th>Lugar</th><th class="n">Heridos</th><th class="n">Muertes</th><th class="n">Puntaje</th><th class="n">CCTV más cercana</th><th>vs. referencia</th></tr></thead><tbody>${
        top.map((i, k) => { const b = base.indexOf(i), c = C[i];
          const cambio = b < 0 ? '<span class="delta-up">nuevo</span>' : b === k ? '=' : b > k ? `<span class="delta-up">↑ ${b - k}</span>` : `<span class="delta-dn">↓ ${k - b}</span>`;
          return `<tr><td>${k + 1}</td><td>${U.esc(c[4] || `${c[0]}, ${c[1]}`)}</td><td class="n">${U.n0(c[2])}</td><td class="n">${c[3] ? `<b style="color:var(--accent)">${c[3]}</b>` : 0}</td>
            <td class="n">${U.n0(c[2] + w * c[3])}</td><td class="n">${U.n0(dExist[i])} m</td><td>${cambio}</td></tr>`; }).join('')}</tbody>`;
    }
    ['#s3-w', '#s3-r'].forEach((s) => U.$(s).addEventListener('input', calc));
    calc();
  }

  function limites() {
    const L_ = [
      ['ruler', 'La probabilidad de una ruta mide qué tan frecuentes son los siniestros en el corredor, no la probabilidad personal de accidentarse: no hay conteos de vehículos abiertos por vía (exposición).'],
      ['video', 'Cobertura = distancia en línea recta ≤ radio. No considera hacia dónde apunta la cámara ni los obstáculos. Cercanía a una cámara es asociación, no causalidad.'],
      ['folder-open', 'Base comparable: solo siniestros con heridos o muertos, porque GeoMedellín dejó de publicar «solo daños» en 2023. Las víctimas por actor llegan a sep-2021.'],
      ['skull', `Muertes en la grilla y en el puntaje del capítulo 3: ${RSM.intervencion.cobertura_muertes?.nota || ''}`],
      ['clone', 'Víctimas: sin un identificador por persona, dos víctimas reales del mismo incidente con igual edad, sexo y condición se ven como filas idénticas; las 197 que se descartan como duplicadas (0,08 %) pueden incluir algunos casos así.'],
      ['cloud-rain', 'La lluvia histórica es una sola estación IDEAM (Olaya Herrera) con vacíos; solo se usan horas observadas. SIATA en vivo da el detalle espacial en la consulta de ruta.'],
      ['calculator', 'Simulador A: las celdas se miden desde su centro; el algoritmo voraz da una buena solución, no necesariamente la óptima global.'],
    ];
    U.$('#j-limites').replaceChildren(...U.lista(L_));
  }

  document.addEventListener('DOMContentLoaded', () => {
    U.chartDefaults();
    const pasos = [resumen, validacion, calidad, estadistica, tiempo, simA, simB, simC, limites];
    for (const f of pasos) { try { f(); } catch (e) { console.error(f.name, e); } }
    const rev = document.querySelectorAll('.reveal');
    if (U.reducir() || !('IntersectionObserver' in window)) rev.forEach((e) => e.classList.add('in'));
    else { const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .05 });
      rev.forEach((e) => io.observe(e)); }
  });
})();
