/* Módulo 1 · ¿Qué está pasando? — versión para el ciudadano.
 * Sintetiza los datos en lo que le importa a quien se mueve por la ciudad: tendencia, gravedad según cómo se mueve,
 * horas y días, su comuna, la lluvia y qué hacer. El detalle técnico vive en jurado.html.
 * Todas las cifras salen de web/data (las genera el ETL); ninguna está escrita a mano.
 */
(function () {
  const D = () => RSM.diagnostico;
  const NOMBRE = { Moto: 'motociclistas', 'Vehículo': 'ocupantes de carro o bus', Bicicleta: 'ciclistas', 'Peatón': 'peatones' };
  const st = { medio: U.get('rsm:medio') || 'Moto', comuna: U.get('rsm:comuna') || '' };
  let mapa, capaPuntos;

  const hora = (h) => (h === 0 ? '12 a. m.' : h < 12 ? `${h} a. m.` : h === 12 ? '12 m.' : `${h - 12} p. m.`);
  const factor = (id, pre) => (D().factores.find((f) => f.id === id)?.items || []).find((i) => String(i.k).startsWith(pre)) || {};
  const svg = (w, h, inner, label) => `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${U.esc(label)}">${inner}</svg>`;

  // ------------------------------------------------------------------ tendencia
  function tendencia() {
    const s = D().serie.filter((r) => r.meses === 12);
    const her = s.map((r) => ({ a: r.anio, v: (r.con_heridos || 0) + (r.con_muertos || 0) }));
    const mue = D().serie.filter((r) => r.muertes_sisc).map((r) => ({ a: r.anio, v: r.muertes_sisc }));
    const ult = her[her.length - 1], maxH = her.reduce((a, x) => (x.v > a.v ? x : a));
    const prev = her.slice(0, -1), prom = prev.reduce((a, x) => a + x.v, 0) / prev.length;
    const maxM = mue.reduce((a, x) => (x.v > a.v ? x : a)), ultM = mue[mue.length - 1];
    const sube = ult.v > prom;
    const spark = (arr, color) => {
      const w = 220, h = 48, mn = Math.min(...arr.map((x) => x.v)) * .9, mx = Math.max(...arr.map((x) => x.v));
      const X = (i) => 4 + (i * (w - 8)) / (arr.length - 1), Y = (v) => h - 6 - ((v - mn) / (mx - mn)) * (h - 14);
      const d = arr.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x.v).toFixed(1)}`).join('');
      const n = arr.length - 1;
      return svg(w, h, `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" class="trazo"/>
        <circle cx="${X(n)}" cy="${Y(arr[n].v)}" r="3.5" fill="${color}"/>
        <text x="4" y="${h - 1}" font-size="9" fill="currentColor" opacity=".6">${arr[0].a}</text>
        <text x="${w - 4}" y="${h - 1}" font-size="9" fill="currentColor" opacity=".6" text-anchor="end">${arr[n].a}</text>`, 'tendencia');
    };
    U.$('#d-tendencia').innerHTML = `
      <div class="t-msg"><span class="t-tag ${sube ? 'sube' : ''}">${sube ? '▲ Va en aumento' : '▼ Va bajando'}</span>
        <p><b>${ult.a}</b> cerró con <b>${U.n0(ult.v)}</b> siniestros con heridos, ${U.pct(Math.abs(ult.v / prom - 1), 0)}
        ${sube ? 'más' : 'menos'} que el promedio de ${prev[0].a}-${prev[prev.length - 1].a}${maxH.a === ult.a ? ': <b>el año más alto de la serie</b>' : ''}.
        ${maxM.a === ultM.a ? `Y ${ultM.a} fue el año con más muertes en las vías (<b>${U.n0(ultM.v)}</b>).` : ''}</p></div>
      <div class="t-spark"><span class="note">Siniestros con heridos por año</span>${spark(her, '#F0F0F0')}</div>
      <div class="t-spark"><span class="note">Muertes en las vías (SISC)</span>${spark(mue, '#E53945')}</div>`;
  }

  // ------------------------------------------------------------------ gravedad según el medio
  function grave() {
    const a = D().actores, yo = a.find((r) => r.actor === st.medio) || a[0];
    const veh = a.find((r) => r.actor === 'Vehículo');
    const total = a.reduce((s, r) => s + r.victimas, 0);
    const m = Math.round(yo.letalidad_x1000);
    let cuadros = '';
    for (let i = 0; i < 1000; i++) cuadros += `<i class="${i < m ? 'm' : ''}" style="--d:${(i % 50) * 8}ms"></i>`;
    U.$('#d-grave').innerHTML = `
      <p class="g-big"><b>${m}</b> de cada <b>1.000</b> ${NOMBRE[yo.actor]} víctimas de un siniestro mueren.</p>
      <div class="picto" role="img" aria-label="${m} de 1.000">${cuadros}</div>
      <p class="note">${yo.actor === 'Vehículo' ? 'Es la referencia más baja de la ciudad.'
        : `Eso es <b>${U.n1(yo.letalidad_x1000 / veh.letalidad_x1000)} veces</b> la gravedad para quien va en carro o bus.`}
      Los ${NOMBRE[yo.actor]} son el <b>${U.pct(yo.victimas / total, 0)}</b> de las víctimas viales (MEData 2014-2021).</p>`;
  }

  // ------------------------------------------------------------------ reloj de 24 horas
  function reloj() {
    const mat = D().calor.matriz, horas = Array.from({ length: 24 }, (_, h) => mat.reduce((s, f) => s + f[h], 0));
    const max = Math.max(...horas), R0 = 40, R1 = 86, cx = 150, cy = 122, c = cy;
    const orden = horas.map((v, h) => [v, h]).sort((x, y) => y[0] - x[0]).slice(0, 3).map((x) => x[1]);
    const pol = (r, ang) => [cx + r * Math.sin(ang), cy - r * Math.cos(ang)];
    let bars = '';
    horas.forEach((v, h) => {
      const a0 = (h / 24) * 2 * Math.PI + 0.02, a1 = ((h + 1) / 24) * 2 * Math.PI - 0.02, r = R0 + ((R1 - R0) * v) / max;
      const [x0, y0] = pol(R0, a0), [x1, y1] = pol(r, a0), [x2, y2] = pol(r, a1), [x3, y3] = pol(R0, a1);
      bars += `<path d="M${x0},${y0}L${x1},${y1}A${r},${r} 0 0 1 ${x2},${y2}L${x3},${y3}A${R0},${R0} 0 0 0 ${x0},${y0}Z"
        class="hb ${orden.includes(h) ? 'top' : ''}" style="--i:${h}"><title>${h}:00 · ${U.n0(v)} siniestros con heridos</title></path>`;
    });
    // madrugada (0-6 h): la franja más letal → arco rojo exterior
    const [mx0, my0] = pol(R1 + 9, 0.02), [mx1, my1] = pol(R1 + 9, (6 / 24) * 2 * Math.PI - 0.02);
    const marcas = [0, 6, 12, 18].map((h) => { const [x, y] = pol(R1 + 24, (h / 24) * 2 * Math.PI); return `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" fill="currentColor" opacity=".7">${hora(h)}</text>`; }).join('');
    const pico = orden[0];
    U.$('#d-reloj').innerHTML = svg(300, 248, `${bars}
      <path d="M${mx0},${my0}A${R1 + 9},${R1 + 9} 0 0 1 ${mx1},${my1}" fill="none" stroke="#E53945" stroke-width="3"/>
      ${marcas}
      <text x="${cx}" y="${c - 2}" text-anchor="middle" font-size="19" font-weight="700" fill="currentColor">${hora(pico)}</text>
      <text x="${cx}" y="${c + 14}" text-anchor="middle" font-size="9.5" fill="currentColor" opacity=".7">la hora con</text>
      <text x="${cx}" y="${c + 25}" text-anchor="middle" font-size="9.5" fill="currentColor" opacity=".7">más siniestros</text>`, 'Siniestros por hora del día');
    const mad = factor('franja', 'Madrugada'), pic = factor('hora_pico', 'Hora pico');
    U.$('#d-reloj-txt').innerHTML = `Las barras más altas son las horas con más siniestros (sobre todo a las <b>${[...orden].sort((a, b) => a - b).map(hora).join(', ')}</b>).
      En hora pico hay <b>${U.n1(pic.rr)}×</b> más por hora. El arco rojo es la <b>madrugada</b>: hay menos siniestros, pero son
      <b>${U.n1(mad.rr)} veces</b> más letales que en la tarde.`;
  }

  // ------------------------------------------------------------------ días
  function dias() {
    const { dias, matriz } = D().calor, tot = matriz.map((f) => f.reduce((a, b) => a + b, 0)), max = Math.max(...tot);
    U.$('#d-dias').innerHTML = `<div class="semana">${tot.map((v, i) => `<div><span style="--h:${(100 * v) / max}%"
      title="${U.n0(v)}"></span><b>${dias[i]}</b></div>`).join('')}</div>`;
    const fin = factor('tipo_dia', 'Sábado'), fes = factor('tipo_dia', 'Festivo'), fer = factor('temporada', 'Feria');
    U.$('#d-dias-txt').innerHTML = `Entre semana hay más siniestros. Los fines de semana bajan a <b>${U.n2(fin.rr)}×</b> y los festivos a
      <b>${U.n2(fes.rr)}×</b> un día hábil. En Feria de las Flores suben a <b>${U.n2(fer.rr)}×</b>.`;
  }

  // ------------------------------------------------------------------ comuna
  function comuna() {
    const cs = D().comunas.filter((c) => !String(c.comuna).startsWith('Zona'));
    const c = cs.find((x) => x.comuna === st.comuna);
    const box = U.$('#d-comuna');
    if (!c) {
      U.$('#d-com-tit').textContent = 'Toda la ciudad';
      const sin = cs.filter((x) => x.cctv === 0).slice(0, 5).map((x) => x.comuna);
      const top = [...cs].sort((a, b) => b.siniestros_2021_2025 - a.siniestros_2021_2025).slice(0, 8), mx = top[0].siniestros_2021_2025;
      box.innerHTML = `<p class="note">Elige tu comuna arriba para ver cómo está. Siniestros con heridos 2021-2025:</p>
        <div class="c-cmp">${top.map((x) => `<span>${U.esc(x.comuna)}</span><span class="cmp ${x.cctv ? '' : 'rojo'}" style="--w:${(100 * x.siniestros_2021_2025) / mx}%"></span>
        <span class="num">${U.n0(x.siniestros_2021_2025)}</span>`).join('')}</div>
        <p class="note"><b>${sin.join(', ')}</b> no tienen ninguna cámara de circuito cerrado (en rojo si están en la lista).</p>`;
      pintarPuntos(null);
      return;
    }
    U.$('#d-com-tit').textContent = c.comuna;
    const rec = [...cs].sort((a, b) => b.siniestros_2021_2025 - a.siniestros_2021_2025);
    const pos = rec.findIndex((x) => x.comuna === c.comuna) + 1;
    const med = rec[Math.floor(rec.length / 2)].siniestros_2021_2025, max = rec[0].siniestros_2021_2025;
    const barra = (v, cls) => `<span class="cmp ${cls}" style="--w:${(100 * v) / max}%"></span>`;
    const pts = RSM.grilla.puntos.filter((p) => p.comuna === c.comuna).slice(0, 3);
    box.innerHTML = `
      <div class="c-rank"><b>#${pos}</b><span>de ${rec.length} en siniestros con heridos (2021-2025)</span></div>
      <div class="c-cmp"><span>${c.comuna}</span>${barra(c.siniestros_2021_2025, 'yo')}<span class="num">${U.n0(c.siniestros_2021_2025)}</span>
        <span class="muted">Comuna típica</span>${barra(med, '')}<span class="num muted">${U.n0(med)}</span></div>
      <div class="c-datos">
        <div><b>${U.n0(c.victimas)}</b><span>víctimas 2014-2021</span></div>
        <div><b class="${c.muertos ? 'rojo' : ''}">${U.n0(c.muertos)}</b><span>muertos 2014-2021</span></div>
        <div><b class="${c.cctv ? '' : 'rojo'}">${c.cctv}</b><span>cámaras CCTV${c.cctv ? '' : ': ninguna'}</span></div></div>
      ${pts.length ? `<p class="note">Esquinas con más siniestros en ${U.esc(c.comuna)}:</p><ol class="c-pts">${pts.map((p) =>
        `<li><b>${U.esc(p.dir || 'Sin dirección')}</b> · ${U.n0(p.tot)} siniestros con heridos</li>`).join('')}</ol>` : ''}`;
    pintarPuntos(c.comuna);
  }

  function pintarPuntos(nombre) {
    if (!mapa) return;
    capaPuntos.clearLayers();
    const pts = RSM.grilla.puntos, max = pts[0]?.tot || 1, sel = [];
    for (const p of pts) {
      const mio = nombre && p.comuna === nombre;
      if (mio) sel.push([p.lat, p.lon]);
      L.circleMarker([p.lat, p.lon], { radius: 1.5 + 9 * Math.sqrt(p.tot / max), color: mio ? '#E53945' : '#8A8D96',
        weight: mio ? 1.2 : .5, fillOpacity: mio ? .55 : .18 })
        .bindTooltip(`<b>${U.esc(p.dir || 'Sin dirección')}</b><br>${U.esc(p.comuna || '')}<br>${U.n0(p.tot)} siniestros con heridos`).addTo(capaPuntos);
    }
    if (sel.length) mapa.fitBounds(sel, { padding: [30, 30], maxZoom: 15 }); else mapa.setView([6.2476, -75.5658], 12);
  }

  // ------------------------------------------------------------------ lluvia
  function lluvia() {
    const ll = D().factores.find((f) => f.id === 'lluvia'), P = RSM.clima.p_lluvia;
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const pm = P.map((f) => f.filter((x) => x != null).reduce((a, b) => a + b, 0) / f.filter((x) => x != null).length);
    const ph = Array.from({ length: 24 }, (_, h) => P.reduce((a, f) => a + (f[h] || 0), 0) / 12);
    const topM = pm.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 2).map((x) => MESES[x[1]]);
    const topH = ph.map((v, h) => [v, h]).sort((a, b) => b[0] - a[0])[0][1];
    const max = Math.max(...pm);
    U.$('#d-lluvia').innerHTML = `
      <div class="lluvia-mes">${pm.map((v, i) => `<div title="${MESES[i]}: llueve el ${U.pct(v, 0)} de las horas"><span style="--h:${(100 * v) / max}%"></span><b>${MESES[i][0].toUpperCase()}</b></div>`).join('')}</div>
      <p>Llueve más en <b>${topM.join(' y ')}</b>, y sobre todo hacia las <b>${hora(topH)}</b> (IDEAM ${String(RSM.clima.desde).slice(0, 4)}-${String(RSM.clima.hasta).slice(0, 4)}).
      Un dato que sorprende: con lluvia <b>no hay más siniestros por hora</b> (${U.n2(ll?.rr)}×). Quizás porque mucha gente sale menos o maneja con
      más cuidado; aun así, el piso mojado alarga el frenado. En <a href="#ruta">Consulta tu ruta</a> te avisamos si está lloviendo en tu camino (SIATA en vivo).</p>`;
  }

  // ------------------------------------------------------------------ consejos según el medio
  function tips() {
    const pic = factor('hora_pico', 'Hora pico'), mad = factor('franja', 'Madrugada');
    const T = {
      Moto: [['🪖', 'Casco abrochado y luces encendidas siempre, también de día.'],
        ['↔️', 'No zigzaguees entre carros: es donde ocurren los choques con motos en los corredores más siniestrados.'],
        ['⏱️', `Si puedes, sal antes o después de la hora pico: hay ${U.n1(pic.rr)}× más siniestros por hora.`]],
      'Vehículo': [['👀', `Revisa espejos y punto ciego antes de girar o cambiar de carril: el ${U.pct(D().kpis.pct_moto, 0)} de las víctimas iban en moto.`],
        ['🚸', 'Cede el paso en las cebras: el peatón es quien más arriesga su vida en un siniestro.'],
        ['📵', 'Nada de celular al volante, sobre todo en las esquinas críticas de tu ruta.']],
      Bicicleta: [['💡', 'Luces delantera y trasera y ropa visible: la gravedad para un ciclista es varias veces la de un carro.'],
        ['🛣️', 'Prefiere las ciclorrutas y evita los corredores con más siniestros de tu ruta.'],
        ['🌙', `Evita la madrugada: es ${U.n1(mad.rr)} veces más letal que la tarde.`]],
      'Peatón': [['🚦', 'Cruza solo por cebra, puente o semáforo, aunque tome más tiempo.'],
        ['👂', 'Sin audífonos ni celular al cruzar: mira a ambos lados, también las motos.'],
        ['🦺', `De noche usa algo claro o reflectivo: la madrugada es ${U.n1(mad.rr)}× más letal.`]],
    };
    U.$('#d-tips').replaceChildren(...T[st.medio].map(([i, t]) => U.el(`<li><span>${i}</span><span>${t}</span></li>`)));
  }

  // ------------------------------------------------------------------ interacción
  function revelar() {
    const els = document.querySelectorAll('#v-diagnostico .reveal');
    if (U.reducir() || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .15 });
    els.forEach((e) => io.observe(e));
  }

  function personal() { grave(); comuna(); tips(); }

  let listo = false;
  window.Diagnostico = {
    init() {
      if (listo) { mapa && mapa.invalidateSize(); return; }
      listo = true;
      const sel = U.$('#p-comuna');
      const cs = D().comunas.filter((c) => !String(c.comuna).startsWith('Zona')).map((c) => c.comuna).sort((a, b) => a.localeCompare(b, 'es'));
      sel.innerHTML = '<option value="">Toda la ciudad</option>' + cs.map((c) => `<option ${c === st.comuna ? 'selected' : ''}>${U.esc(c)}</option>`).join('');
      sel.addEventListener('change', () => { st.comuna = sel.value; U.set('rsm:comuna', st.comuna); comuna(); });
      U.$('#p-medio').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === st.medio));
      U.$('#p-medio').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        st.medio = b.dataset.m; U.set('rsm:medio', st.medio);
        U.$('#p-medio').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        grave(); tips();
      });
      mapa = U.mapa('map-diag');
      capaPuntos = L.layerGroup().addTo(mapa);
      for (const c of RSM.camaras.filter((c) => c.tipo === 'CCTV')) {
        L.circleMarker([c.lat, c.lon], { radius: 3.5, color: '#F0F0F0', weight: 1, fillColor: '#5A5D66', fillOpacity: 1 }).bindTooltip(`CCTV · ${U.esc(c.nombre)}`).addTo(mapa);
      }
      tendencia(); reloj(); dias(); lluvia(); personal();
      revelar();
    },
  };
})();
