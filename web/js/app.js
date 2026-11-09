/* Enrutador por hash y portada */
(function () {
  const VISTAS = { inicio: null, diagnostico: 'Diagnostico', ruta: 'Ruta', intervenir: 'Intervencion', datos: 'Datos' };

  function contar(el, meta) {
    if (U.reducir()) { el.textContent = U.n0(meta); return; }
    const t0 = performance.now(), dur = 1600;
    (function paso(t) {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = U.n0(meta * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(paso);
    })(t0);
  }

  /* Un punto = una muerte registrada por el SISC (datos reales de la serie anual). */
  function vidas() {
    const serie = RSM.diagnostico.serie.filter((r) => r.muertes_sisc);
    const box = U.$('#hero-dots');
    const frag = document.createDocumentFragment();
    serie.forEach((r) => {
      for (let i = 0; i < r.muertes_sisc; i++) {
        const d = document.createElement('i');
        d.title = r.anio;
        d.style.setProperty('--o', (0.35 + 0.65 * (r.anio - 2014) / 9).toFixed(2));
        frag.append(d);
      }
    });
    box.append(frag);
    U.$('#hero-dots-leg').textContent = `Cada punto es una persona fallecida en las vías de Medellín (SISC ${serie[0].anio}-${serie[serie.length - 1].anio}). Los más recientes, más claros.`;
  }

  function portada() {
    const k = RSM.diagnostico.kpis;
    const pico = RSM.diagnostico.factores.find((f) => f.id === 'hora_pico')?.items.find((i) => !i.ref);
    const peat = RSM.diagnostico.factores.find((f) => f.id === 'actor')?.items.find((i) => i.k === 'Peatón');
    contar(U.$('#hero-n'), k.muertes_sisc);
    U.$('#hero-d').textContent = `${k.sisc_desde}-${k.sisc_hasta}`;
    U.$('#hero-s').textContent = `${U.n0(k.siniestros_heridos)} siniestros con heridos o muertos entre ${U.fecha(k.desde).slice(0, 4)} y ${U.fecha(k.hasta).slice(0, 4)}.`;
    vidas();
    U.$('#hallazgos-inicio').replaceChildren(
      U.el(`<div class="find"><b>${U.pct(k.pct_lejos_cctv, 0)}</b><span>de las víctimas cayó a más de 300 m de una cámara de circuito cerrado.</span></div>`),
      U.el(`<div class="find"><b>${U.n1(pico?.rr)}×</b><span>más siniestros con heridos por hora en hora pico que en el resto del día hábil.</span></div>`),
      U.el(`<div class="find"><b>${U.n0(peat?.v)}</b><span>muertos por cada 1.000 peatones víctimas: ${U.n1(peat?.rr)} veces más que en carro.</span></div>`),
    );
  }

  function ir() {
    let v = (location.hash || '#inicio').slice(1);
    if (!(v in VISTAS)) v = 'inicio';
    document.querySelectorAll('section.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
    document.querySelectorAll('.tabs a').forEach((a) => {
      const on = a.getAttribute('href') === '#' + v;
      a.classList.toggle('on', on);
      on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
    });
    const mod = VISTAS[v];
    if (mod && window[mod]) {
      try { window[mod].init(); } catch (e) { console.error(e); }
    }
    window.scrollTo(0, 0);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!window.RSM || !RSM.diagnostico) {
      document.querySelector('main').innerHTML = '<div class="card"><h3>Faltan los datos de la página</h3><p>Ejecute <code>python -m etl run</code> para generar <code>web/data</code>.</p></div>';
      return;
    }
    U.chartDefaults();
    U.$('#meta-gen').textContent = `Datos actualizados: ${RSM.meta.generado}`;
    portada();
    window.addEventListener('hashchange', ir);
    ir();
  });
})();
