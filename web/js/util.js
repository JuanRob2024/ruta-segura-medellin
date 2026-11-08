/* Utilidades comunes: formato es-CO, colores, mapas base y almacenamiento seguro */
(function () {
  const nf0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const css = () => getComputedStyle(document.documentElement);

  const U = {
    n0: (x) => (x == null || isNaN(x) ? '—' : nf0.format(x)),
    n1: (x) => (x == null || isNaN(x) ? '—' : nf1.format(x)),
    n2: (x) => (x == null || isNaN(x) ? '—' : nf2.format(x)),
    pct: (x, d = 1) => (x == null || isNaN(x) ? '—' : (d === 0 ? nf0 : d === 2 ? nf2 : nf1).format(x * 100) + ' %'),
    veces: (x) => (x == null || isNaN(x) ? '—' : nf2.format(x) + '×'),
    fecha: (s) => (s ? String(s).slice(0, 10) : '—'),
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    color: (name) => css().getPropertyValue(name).trim(),
    dark: () => document.documentElement.dataset.theme === 'dark' ||
      (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches),
    el: (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; },
    $: (s) => document.querySelector(s),

    /* almacenamiento: puede fallar en modo privado → nunca rompe la página */
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },

    /* mapa base: OpenStreetMap estándar (gratis, sin llave; política de uso: atribución visible y tráfico liviano).
       En tema oscuro se oscurece con un filtro CSS (clase .mapa-oscuro en app.css). */
    mapa(id, opts = {}) {
      const m = L.map(id, { zoomControl: true, scrollWheelZoom: opts.scroll ?? false, ...opts }).setView([6.2476, -75.5658], opts.zoom || 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>',
      }).addTo(m);
      m.getContainer().classList.toggle('mapa-oscuro', U.dark());
      return m;
    },

    /* Chart.js con los colores del tema */
    chartDefaults() {
      if (!window.Chart) return;
      Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
      Chart.defaults.color = U.color('--muted');
      Chart.defaults.borderColor = U.color('--line');
      Chart.defaults.plugins.legend.labels.boxWidth = 12;
      Chart.defaults.maintainAspectRatio = false;
    },
    paleta: ['#0f6cbd', '#e0671b', '#2e8b57', '#8a5bb5', '#c0392b', '#2b8c99', '#b58a1f', '#6b7280'],
  };
  window.U = U;
})();
