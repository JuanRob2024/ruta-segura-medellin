/* Módulo 2 · Consulta tu ruta
 *
 * Servicios gratuitos y sin llave (uso respetuoso de sus límites):
 *   - Photon (komoot, OpenStreetMap) para buscar direcciones: máximo 1 consulta cada 1,2 s, solo con ≥ 4 letras,
 *     limitada al Valle de Aburrá y con caché local.
 *   - OSRM (router.project-osrm.org) para la ruta: 1 consulta por clic en "Calcular", mínimo 3 s entre consultas,
 *     y caché local por par origen-destino (la misma ruta no se vuelve a pedir).
 *   - SIATA (pluviómetros en vivo): 1 consulta cada 5 minutos como máximo.
 */
(function () {
  const BBOX = '-75.72,6.10,-75.45,6.40'; // lon_min,lat_min,lon_max,lat_max (Valle de Aburrá)
  const COLORES = { 'Bajo': '#2e8b57', 'Medio': '#d4a017', 'Alto': '#e0671b', 'Muy alto': '#c0392b' };
  const VEL = { bici: 15, pie: 4.5 }; // km/h cuando no se usa la duración del carro
  const st = { o: null, d: null, medio: 'carro', pick: null, alts: [], sel: 0, capas: [], ultimaRuta: 0, siata: null };
  let mapa;

  // ------------------------------------------------------------------ búsqueda de direcciones (Photon)
  let ultimaBusqueda = 0, timer = null;
  async function geocodificar(q) {
    const key = 'rsm:geo:' + q.toLowerCase();
    const c = U.get(key);
    if (c) return c;
    const espera = 1200 - (Date.now() - ultimaBusqueda);
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimaBusqueda = Date.now();
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q + ' Medellín')}&limit=5&bbox=${BBOX}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('búsqueda no disponible');
    const j = await r.json();
    const out = j.features.map((f) => {
      const p = f.properties;
      const linea = [p.street && (p.street + (p.housenumber ? ' ' + p.housenumber : '')), p.district, p.city].filter(Boolean).join(', ');
      return { nombre: p.name || p.street || 'Lugar', det: linea, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
    });
    U.set(key, out);
    return out;
  }

  function autocompletar(campo, lista, cual) {
    campo.addEventListener('input', () => {
      clearTimeout(timer);
      st[cual] = null;
      const q = campo.value.trim();
      if (q.length < 4) { lista.hidden = true; return; }
      timer = setTimeout(async () => {
        try {
          const res = await geocodificar(q);
          lista.replaceChildren(...res.map((x) => {
            const d = U.el(`<div><b>${U.esc(x.nombre)}</b><small>${U.esc(x.det)}</small></div>`);
            d.onclick = () => { fijar(cual, x.lat, x.lon, x.nombre); lista.hidden = true; };
            return d;
          }));
          lista.hidden = !res.length;
        } catch (e) { estado('No se pudo buscar la dirección. Puedes marcar el punto en el mapa.', true); }
      }, 700);
    });
    campo.addEventListener('blur', () => setTimeout(() => (lista.hidden = true), 200));
  }

  const marcas = {};
  function fijar(cual, lat, lon, nombre) {
    st[cual] = { lat, lon, nombre };
    U.$(cual === 'o' ? '#f-origen' : '#f-destino').value = nombre;
    if (marcas[cual]) marcas[cual].remove();
    marcas[cual] = L.marker([lat, lon], { title: cual === 'o' ? 'Origen' : 'Destino' })
      .bindTooltip(cual === 'o' ? 'Origen' : 'Destino', { permanent: true, direction: 'top', offset: [-15, -12] }).addTo(mapa);
  }

  // ------------------------------------------------------------------ ruta (OSRM)
  async function pedirRuta(o, d) {
    const key = `rsm:osrm:${o.lat.toFixed(4)},${o.lon.toFixed(4)};${d.lat.toFixed(4)},${d.lon.toFixed(4)}`;
    const c = U.get(key);
    if (c) return c;
    const espera = 3000 - (Date.now() - st.ultimaRuta);
    if (espera > 0) throw new Error(`Espera ${Math.ceil(espera / 1000)} s antes de pedir otra ruta (límite del servicio gratuito).`);
    st.ultimaRuta = Date.now();
    const url = `https://router.project-osrm.org/route/v1/driving/${o.lon},${o.lat};${d.lon},${d.lat}` +
      '?alternatives=true&overview=full&geometries=geojson';
    const r = await fetch(url);
    if (!r.ok) throw new Error('El servicio de rutas no respondió. Intenta de nuevo en un momento.');
    const j = await r.json();
    if (j.code !== 'Ok' || !j.routes?.length) throw new Error('No se encontró una ruta entre esos puntos.');
    const out = j.routes.slice(0, 3).map((x) => ({ coords: x.geometry.coordinates, dist: x.distance, dur: x.duration }));
    U.set(key, out);
    return out;
  }

  // ------------------------------------------------------------------ SIATA en vivo
  async function siata() {
    if (st.siata && Date.now() - st.siata.t < 5 * 60 * 1000) return st.siata;
    try {
      const r = await fetch(RSM.clima.siata_url, { cache: 'no-store' });
      const j = await r.json();
      st.siata = { t: Date.now(), ok: true, est: j.estaciones.filter((e) => e.valor !== -999 && e.latitud) };
    } catch (e) {
      st.siata = { t: Date.now(), ok: false, est: [] };
    }
    return st.siata;
  }

  // ------------------------------------------------------------------ cálculo
  function duracionMin(alt) {
    if (st.medio === 'bici' || st.medio === 'pie') return (alt.dist / 1000 / VEL[st.medio]) * 60;
    return alt.dur / 60;
  }

  async function calcular() {
    const b = U.$('#b-calc');
    if (!st.o || !st.d) { estado('Elige el origen y el destino (de la lista de sugerencias o marcándolos en el mapa).', true); return; }
    b.disabled = true;
    estado('Calculando rutas…');
    try {
      const [rutas, sia] = await Promise.all([pedirRuta(st.o, st.d), siata()]);
      const fecha = new Date(U.$('#f-hora').value || Date.now());
      const pronto = Math.abs(fecha - Date.now()) < 2 * 3600 * 1000;
      st.alts = rutas.map((alt) => {
        const dur = duracionMin(alt);
        const cerca = sia.ok ? estacionesCerca(alt.coords, sia.est) : [];
        const llueveAhora = pronto && cerca.some((e) => e.valor > 0);
        const ev = Riesgo.evaluar(alt.coords, RSM.grilla, { fecha, duracionMin: dur, lluvia: llueveAhora });
        return { ...alt, durMin: dur, ev, cerca, llueveAhora, fecha };
      });
      const mejor = st.alts.reduce((a, x, i) => (x.ev.lambdaViaje < st.alts[a].ev.lambdaViaje ? i : a), 0);
      st.alts.forEach((a, i) => (a.segura = i === mejor && st.alts.length > 1));
      seleccionar(mejor);
      estado(`${st.alts.length} ruta(s) calculada(s). ${st.alts.length > 1 ? 'Marcamos la de menor riesgo por viaje.' : ''}`);
    } catch (e) {
      estado(e.message, true);
    } finally {
      b.disabled = false;
    }
  }

  function estacionesCerca(coords, est) {
    const { puntos } = Riesgo.muestrear(coords, 250);
    return est.map((e) => ({ ...e, d: Riesgo.cercania(e.latitud, e.longitud, puntos).d }))
      .filter((e) => e.d <= 2000).sort((a, b) => a.d - b.d);
  }

  // ------------------------------------------------------------------ dibujo
  function seleccionar(i) {
    st.sel = i;
    st.capas.forEach((c) => c.remove());
    st.capas = [];
    st.alts.forEach((a, k) => {
      if (k === i) return;
      st.capas.push(L.polyline(a.coords.map(([lo, la]) => [la, lo]), { color: '#8a94a3', weight: 5, opacity: .6 })
        .on('click', () => seleccionar(k)).addTo(mapa));
    });
    const a = st.alts[i];
    const linea = L.polyline(a.coords.map(([lo, la]) => [la, lo]), { color: COLORES[a.ev.nivel], weight: 7, opacity: .95 }).addTo(mapa);
    st.capas.push(linea);
    mapa.fitBounds(linea.getBounds(), { padding: [30, 30] });
    listaAlternativas();
    resultado(a);
  }

  function listaAlternativas() {
    const box = U.$('#r-alts');
    box.replaceChildren(...st.alts.map((a, k) => {
      const el = U.el(`<div class="alt ${k === st.sel ? 'on' : ''}"><i style="background:${COLORES[a.ev.nivel]}"></i>
        <span><b>Ruta ${k + 1}</b>${a.segura ? ' · <b style="color:var(--ok)">más segura</b>' : ''}<br>
        <span class="muted small">${U.n1(a.ev.km)} km · ${U.n0(a.durMin)} min · riesgo ${a.ev.nivel.toLowerCase()}</span></span>
        <span class="num"><b>${U.pct(a.ev.pViaje, 2)}</b></span><span>›</span></div>`);
      el.onclick = () => seleccionar(k);
      return el;
    }));
  }

  function resultado(a) {
    const ev = a.ev;
    U.$('#r-result').hidden = false;
    const badge = U.$('#r-nivel');
    badge.textContent = 'Riesgo ' + ev.nivel.toLowerCase();
    badge.className = 'badge lvl-' + ev.nivel.split(' ')[0];
    U.$('#r-veces').textContent = `${U.veces(ev.veces)} la siniestralidad típica de las vías con registros`;
    U.$('#r-prob').textContent = U.pct(ev.pViaje, 2);
    U.$('#r-dur').textContent = `${U.n0(a.durMin)} min`;
    U.$('#r-sal').textContent = a.fecha.toLocaleString('es-CO', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
    const nums = [
      [U.n0(ev.anual), 'siniestros con heridos por año en el corredor'],
      [U.n1(ev.porKm), 'siniestros por km al año'],
      [U.n0(ev.muertes), `muertes registradas en el corredor (2014-2023)`],
      [U.pct(ev.pHora, 1), `probabilidad en 1 hora a esa misma hora`],
    ];
    U.$('#r-nums').replaceChildren(...nums.map(([v, l]) => U.el(`<div class="box"><b>${v}</b><span class="small muted">${l}</span></div>`)));
    U.$('#r-metodo').innerHTML = `El corredor son las ${U.n0(ev.celdas)} celdas de ~55 m a menos de 40 m de la ruta. Allí ocurrieron
      ${U.n0(ev.siniestros)} siniestros con heridos o muertos en ${U.n1(RSM.grilla.anios)} años (MEData + GeoMedellín), es decir
      ${U.n1(ev.anual)} por año. Se reparten según la hora (${ev.hora}:00 concentra el ${U.pct(RSM.grilla.perfil_hora[ev.hora])} de los
      siniestros) y el día de la semana; ${a.llueveAhora ? `como SIATA reporta lluvia cerca de la ruta, se multiplica por ${U.n2(ev.fLluvia)}; ` : ''}
      luego se calcula la probabilidad de al menos un siniestro durante los ${U.n0(a.durMin)} minutos del viaje (Poisson).
      <b>No es la probabilidad de que tú tengas un accidente</b>: mide qué tan frecuentes son los siniestros en las vías que vas a recorrer.
      El nivel compara la siniestralidad media por celda con todas las vías con registros de la ciudad.`;
    tramos(a);
    camaras(a);
    clima(a);
  }

  function clima(a) {
    const mes = a.fecha.getMonth(), h = a.fecha.getHours();
    const p = RSM.clima.p_lluvia?.[mes]?.[h];
    const lloviendo = a.cerca.filter((e) => e.valor > 0);
    const boxes = [];
    if (st.siata?.ok) {
      boxes.push(lloviendo.length
        ? [`🌧️ Lloviendo`, `${lloviendo.length} de ${a.cerca.length} pluviómetros SIATA cerca de la ruta reportan lluvia (máx. ${U.n1(Math.max(...lloviendo.map((e) => e.valor)))} mm)`]
        : [a.cerca.length ? '☁️ Sin lluvia' : 'Sin estaciones', a.cerca.length ? `${a.cerca.length} pluviómetros SIATA a menos de 2 km no reportan lluvia ahora` : 'No hay pluviómetros SIATA a menos de 2 km']);
    } else {
      boxes.push(['SIATA no disponible', 'No se pudo consultar la lluvia en vivo; usamos solo la probabilidad histórica']);
    }
    boxes.push([p == null ? '—' : U.pct(p, 0), `de las horas llueve en ${a.fecha.toLocaleString('es-CO', { month: 'long' })} a las ${h}:00 (IDEAM ${String(RSM.clima.desde).slice(0, 4)}-${String(RSM.clima.hasta).slice(0, 4)})`]);
    U.$('#r-clima').replaceChildren(...boxes.map(([v, l]) => U.el(`<div class="box"><b>${v}</b><span class="small muted">${U.esc(l)}</span></div>`)));
    U.$('#r-recs').replaceChildren(...recomendaciones(a, p, lloviendo.length > 0 && Math.abs(a.fecha - Date.now()) < 2 * 3600 * 1000)
      .map(([i, t]) => U.el(`<li><span>${i}</span><span>${t}</span></li>`)));
  }

  /* cifras de los factores influyentes (las calcula el ETL; no se escriben a mano) */
  function factor(id, prefijo) {
    const f = RSM.diagnostico.factores.find((x) => x.id === id);
    const i = f && f.items.find((x) => String(x.k).startsWith(prefijo));
    return i || {};
  }

  function recomendaciones(a, pLluvia, llueve) {
    const m = st.medio, h = a.fecha.getHours(), r = [];
    const fMad = factor('franja', 'Madrugada'), fNoche = factor('franja', 'Noche'), fPico = factor('hora_pico', 'Hora pico');
    const fPeat = factor('actor', 'Peatón'), fBici = factor('actor', 'Bicicleta');
    const noche = h >= 18 || h < 6, madrugada = h < 6, sol = h >= 9 && h <= 16;
    const lluvia = llueve || (pLluvia != null && pLluvia >= 0.2);
    if (lluvia) {
      r.push(['🌧️', llueve ? '<b>Está lloviendo cerca de tu ruta.</b> Sal con tiempo: el pavimento mojado duplica la distancia de frenado.'
        : `<b>Probabilidad de lluvia alta para esta hora (${U.pct(pLluvia, 0)}).</b> Ten listo el equipo para lluvia.`]);
      if (m === 'moto') r.push(['🏍️', 'Usa impermeable de colores vivos, evita frenar sobre líneas pintadas, tapas y rejillas, y no te refugies bajo puentes en la vía.']);
      if (m === 'carro') r.push(['🚗', 'Enciende las luces, revisa las plumillas y deja el doble de distancia con el vehículo de adelante. Evita los charcos: pueden esconder huecos.']);
      if (m === 'bici') r.push(['🚲', 'Baja la velocidad en curvas y bajadas, usa guardabarros y luces, y frena con anticipación.']);
      if (m === 'pie') r.push(['🚶', 'Cruza solo por la cebra o el semáforo: con lluvia los conductores ven menos. Usa algo claro o reflectivo.']);
    } else if (sol && !noche) {
      r.push(['☀️', '<b>Baja probabilidad de lluvia a esta hora.</b> Protégete del sol: bloqueador, hidratación y gafas.']);
      if (m === 'carro') r.push(['🕶️', 'Lleva gafas de sol o baja la visera: el reflejo en los parabrisas reduce la visibilidad.']);
      if (m === 'moto' || m === 'bici') r.push(['🧴', 'El calor cansa más rápido: haz pausas si el trayecto es largo y no te quites la chaqueta ni el casco.']);
    }
    if (noche) r.push(['🌙', `${madrugada ? `<b>En la madrugada la letalidad es ${U.n1(fMad.rr)} veces la de la tarde.</b> `
      : `De noche la letalidad es ${U.n1(fNoche.rr)} veces la de la tarde. `}Usa prendas reflectivas y luces, y evita el alcohol al conducir.`]);
    const pico = (h >= 6 && h < 9) || (h >= 17 && h < 20);
    const habil = a.fecha.getDay() >= 1 && a.fecha.getDay() <= 5;
    if (pico && habil) r.push(['⏱️', `Sales en <b>hora pico</b>: en días hábiles hay ${U.n1(fPico.rr)} veces más siniestros con heridos por hora. Si puedes, sal 30 minutos antes o después.`]);
    if (m === 'pie') r.push(['⚠️', `En Medellín los peatones tienen la mayor letalidad: <b>${U.n0(fPeat.v)} muertos por cada 1.000 víctimas</b>, ${U.n1(fPeat.rr)} veces la de un ocupante de carro.`]);
    if (m === 'moto') r.push(['🪖', `${U.pct(RSM.diagnostico.kpis.pct_moto, 0)} de las víctimas viales de Medellín iban en moto. Casco abrochado, luces encendidas y nada de zigzag entre carros.`]);
    if (m === 'bici') r.push(['🚲', `Las bicicletas tienen una letalidad ${U.n1(fBici.rr)} veces la de los carros. Prefiere las ciclorrutas y hazte visible.`]);
    const ev = a.ev, v = ev.victimas;
    if (ev.nivel === 'Alto' || ev.nivel === 'Muy alto') r.push(['🚦', `Esta ruta pasa por vías con <b>${U.n1(ev.veces)} veces</b> la siniestralidad típica de la ciudad: baja la velocidad en los cruces y no uses el celular.`]);
    if (v && v.n >= 30) {
      if (v.moto >= 0.6 && m !== 'moto') r.push(['🏍️', `En este corredor el ${U.pct(v.moto, 0)} de las víctimas iba en moto: revisa los espejos y el punto ciego antes de cambiar de carril o girar.`]);
      if (v.peaton >= 0.12 && m !== 'pie') r.push(['🚸', `El ${U.pct(v.peaton, 0)} de las víctimas de este corredor eran peatones: cede el paso en las cebras y cuidado al girar en las esquinas.`]);
      if (m === 'pie' && v.peaton >= 0.12) r.push(['🚶', `Aquí los peatones son el ${U.pct(v.peaton, 0)} de las víctimas: usa puentes y semáforos peatonales aunque te tome más tiempo.`]);
    }
    const t = a.tramos?.[0];
    if (t) r.push(['📍', `Tramo con más siniestros de tu ruta: <b>${U.esc(t.dir || 'sin dirección')}</b> (${U.n0(t.tot)} siniestros con heridos). Atento ahí.`]);
    if (a.segura === false && st.alts.some((x) => x.segura)) r.push(['🔀', 'Hay otra alternativa con menor riesgo por viaje: mírala en la lista de rutas.']);
    return r;
  }

  function tramos(a) {
    const { puntos } = Riesgo.muestrear(a.coords, 20);
    const lat = puntos.map((p) => p.lat), lon = puntos.map((p) => p.lon);
    const caja = [Math.min(...lat) - .001, Math.max(...lat) + .001, Math.min(...lon) - .001, Math.max(...lon) + .001];
    a.tramos = RSM.grilla.puntos
      .filter((p) => p.lat >= caja[0] && p.lat <= caja[1] && p.lon >= caja[2] && p.lon <= caja[3])
      .map((p) => ({ ...p, ...Riesgo.cercania(p.lat, p.lon, puntos) })).filter((p) => p.d <= 60)
      .sort((x, y) => y.tot - x.tot).slice(0, 8);
    U.$('#r-tramos').innerHTML = a.tramos.length
      ? `<thead><tr><th>#</th><th>Dirección</th><th>Comuna</th><th class="n">Siniestros con heridos</th><th class="n">En el km</th></tr></thead><tbody>${
        a.tramos.map((t, k) => `<tr><td>${k + 1}</td><td>${U.esc(t.dir || '—')}</td><td>${U.esc(t.comuna || '')}</td><td class="n">${U.n0(t.tot)}</td><td class="n">${U.n1(t.m / 1000)}</td></tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="empty">Ningún punto crítico a menos de 60 m de esta ruta.</td></tr></tbody>';
    a.tramos.forEach((t, k) => st.capas.push(L.circleMarker([t.lat, t.lon], { radius: 9, color: '#c0392b', weight: 2, fillOpacity: .5 })
      .bindTooltip(`${k + 1}. ${U.esc(t.dir || '')} · ${U.n0(t.tot)} siniestros`).addTo(mapa)));
    const v = a.ev.victimas;
    U.$('#r-comp').innerHTML = v ? `Víctimas registradas en este corredor (MEData 2014-2021, ${U.n0(v.n)}): ${U.pct(v.moto, 0)} iban en moto,
      ${U.pct(v.peaton, 0)} eran peatones, ${U.pct(v.vehiculo, 0)} iban en carro o bus y ${U.pct(v.bici, 0)} en bicicleta.` : '';
  }

  function camaras(a) {
    const { puntos } = Riesgo.muestrear(a.coords, 25);
    const cams = RSM.camaras.map((c) => ({ ...c, ...Riesgo.cercania(c.lat, c.lon, puntos) }))
      .filter((c) => c.d <= 150).sort((x, y) => x.m - y.m);
    const tipo = { CCTV: 'Circuito cerrado', FDT: 'Fotodetección (fotomulta)', ARS: 'Apoyo semafórico' };
    const color = { CCTV: '#0f6cbd', FDT: '#8a5bb5', ARS: '#2b8c99' };
    cams.forEach((c) => st.capas.push(L.circleMarker([c.lat, c.lon], { radius: 6, color: color[c.tipo], weight: 2, fillOpacity: .9 })
      .bindTooltip(`${tipo[c.tipo]} · ${U.esc(c.nombre || c.id)}`).addTo(mapa)));
    const box = U.$('#r-cams');
    if (!cams.length) { box.replaceChildren(U.el('<p class="empty">No hay cámaras de tránsito a menos de 150 m de esta ruta.</p>')); return; }
    box.replaceChildren(...cams.map((c) => {
      const foto = c.tipo === 'CCTV' && c.foto
        ? `<a href="${U.esc(c.foto)}" target="_blank" rel="noopener"><img loading="lazy" src="${U.esc(c.foto)}?t=${Math.floor(Date.now() / 60000)}" alt="Foto en vivo de la cámara ${U.esc(c.nombre)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'empty',style:'padding:10px',textContent:'Foto no disponible: ábrela en el SIMM'}))"></a>` : '';
      const det = c.detecta?.length ? `<span class="muted">Detecta: ${c.detecta.join(', ')}${c.vel ? ` · máx. ${c.vel} km/h` : ''}</span>` : '';
      return U.el(`<div class="cam">${foto}<div class="t"><b>${U.esc(c.nombre || c.id)}</b><span class="muted">${tipo[c.tipo]} · km ${U.n1(c.m / 1000)}</span>
        ${c.sin300 != null ? `<span class="muted">${U.n0(c.sin300)} siniestros a 300 m (2019-2025)</span>` : ''}${det}</div></div>`);
    }));
  }

  function estado(t, err) { const s = U.$('#r-status'); s.textContent = t; s.classList.toggle('err', !!err); }

  // ------------------------------------------------------------------ inicio
  let listo = false;
  window.Ruta = {
    init() {
      if (listo) { mapa.invalidateSize(); return; }
      listo = true;
      mapa = U.mapa('map-ruta', { scroll: true, zoom: 12 });
      const ahora = new Date(); ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
      U.$('#f-hora').value = ahora.toISOString().slice(0, 16);
      autocompletar(U.$('#f-origen'), U.$('#s-origen'), 'o');
      autocompletar(U.$('#f-destino'), U.$('#s-destino'), 'd');
      const pick = (cual, btn) => btn.addEventListener('click', () => {
        st.pick = st.pick === cual ? null : cual;
        U.$('#b-pick-o').classList.toggle('on', st.pick === 'o');
        U.$('#b-pick-d').classList.toggle('on', st.pick === 'd');
        estado(st.pick ? `Haz clic en el mapa para marcar el ${cual === 'o' ? 'origen' : 'destino'}.` : '');
      });
      pick('o', U.$('#b-pick-o'));
      pick('d', U.$('#b-pick-d'));
      mapa.on('click', (e) => {
        if (!st.pick) return;
        fijar(st.pick, e.latlng.lat, e.latlng.lng, `Punto en el mapa (${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)})`);
        st.pick = null;
        U.$('#b-pick-o').classList.remove('on'); U.$('#b-pick-d').classList.remove('on');
        estado('');
      });
      U.$('#b-geo').addEventListener('click', () => {
        if (!navigator.geolocation) return estado('Tu navegador no permite ubicarte.', true);
        navigator.geolocation.getCurrentPosition((p) => fijar('o', p.coords.latitude, p.coords.longitude, 'Mi ubicación'),
          () => estado('No se pudo obtener tu ubicación.', true), { timeout: 8000 });
      });
      U.$('#f-medio').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        st.medio = b.dataset.m;
        U.$('#f-medio').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        if (st.alts.length) { // recalcula duración y riesgo sin volver a pedir la ruta
          st.alts.forEach((a) => { a.durMin = duracionMin(a); a.ev = Riesgo.evaluar(a.coords, RSM.grilla, { fecha: a.fecha, duracionMin: a.durMin, lluvia: a.llueveAhora }); });
          seleccionar(st.sel);
        }
      });
      U.$('#b-calc').addEventListener('click', calcular);
      // ruta de ejemplo para que el jurado vea el módulo funcionando con un clic
      const ej = U.el('<button class="btn" style="justify-content:center">Probar con un ejemplo: Parque Berrío → Universidad Nacional</button>');
      ej.onclick = () => { fijar('o', 6.25004, -75.56814, 'Parque Berrío'); fijar('d', 6.26150, -75.57768, 'Universidad Nacional (sede El Volador)'); calcular(); };
      U.$('#b-calc').after(ej);
    },
  };
})();
