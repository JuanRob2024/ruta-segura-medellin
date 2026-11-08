/* Enrutador por hash y portada */
(function () {
  const VISTAS = { inicio: null, diagnostico: 'Diagnostico', ruta: 'Ruta', intervenir: 'Intervencion', datos: 'Datos' };

  function portada() {
    const k = RSM.diagnostico.kpis;
    const pico = RSM.diagnostico.factores.find((f) => f.id === 'hora_pico')?.items.find((i) => !i.ref);
    const peat = RSM.diagnostico.factores.find((f) => f.id === 'actor')?.items.find((i) => i.k === 'Peatón');
    U.$('#hallazgos-inicio').replaceChildren(
      U.el('<h3>Lo que muestran los datos</h3>'),
      U.el(`<div class="find"><b>${U.pct(k.pct_lejos_cctv, 0)}</b><span>de las víctimas viales cayó a más de 300 m de una cámara de circuito cerrado.</span></div>`),
      U.el(`<div class="find"><b>${U.n1(pico?.rr)}×</b><span>siniestros con heridos por hora en hora pico frente al resto del día hábil.</span></div>`),
      U.el(`<div class="find"><b>${U.n0(peat?.v)}</b><span>muertos por cada 1.000 peatones víctimas: ${U.n1(peat?.rr)} veces más que en carro.</span></div>`),
      U.el(`<p class="note">Serie ${U.fecha(k.desde).slice(0, 4)}-${U.fecha(k.hasta).slice(0, 4)}: ${U.n0(k.siniestros_heridos)} siniestros con heridos o muertos.</p>`),
    );
  }

  function ir() {
    let v = (location.hash || '#inicio').slice(1);
    if (!(v in VISTAS)) v = 'inicio';
    document.querySelectorAll('section.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
    document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + v));
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
