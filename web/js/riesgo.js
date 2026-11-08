/* Motor de riesgo de una ruta (sin dependencias: funciona en el navegador y en Node para pruebas).
 *
 * Entrada: la geometría de la ruta (lista de [lon, lat]) y la grilla de siniestros que genera el ETL
 *          (RSM.grilla: celdas de ~55 m con siniestros con heridos o muertos 2014-2025).
 * Salida:  corredor (celdas a ≤ 40 m del recorrido), siniestros históricos por año, nivel de riesgo,
 *          probabilidad de un siniestro con heridos en el corredor durante el viaje, y composición de víctimas.
 *
 * Modelo (ver DOCUMENTACION.md §6):
 *   λ_año   = Σ siniestros del corredor / años observados
 *   λ_hora  = λ_año / 365 × (7 · p_día[d]) × p_hora[h] × f_lluvia
 *   λ_viaje = λ_hora × duración (h)          P = 1 − e^(−λ_viaje)    (proceso de Poisson)
 */
(function (root) {
  const R_TIERRA = 6371008.8;
  const rad = (g) => (g * Math.PI) / 180;

  function distM(lat1, lon1, lat2, lon2) {
    const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_TIERRA * Math.asin(Math.sqrt(a));
  }

  /* puntos cada `paso` metros a lo largo de la línea [[lon,lat],...] */
  function muestrear(coords, paso = 15) {
    const out = [];
    let largo = 0;
    for (let k = 0; k < coords.length - 1; k++) {
      const [lo1, la1] = coords[k], [lo2, la2] = coords[k + 1];
      const d = distM(la1, lo1, la2, lo2);
      const n = Math.max(1, Math.ceil(d / paso));
      for (let s = 0; s < n; s++) {
        const t = s / n;
        out.push({ lat: la1 + (la2 - la1) * t, lon: lo1 + (lo2 - lo1) * t, m: largo + d * t });
      }
      largo += d;
    }
    if (coords.length) { const [lo, la] = coords[coords.length - 1]; out.push({ lat: la, lon: lo, m: largo }); }
    return { puntos: out, largo };
  }

  /* índice "i,j" → fila de la grilla */
  function indexar(grilla) {
    if (grilla._idx) return grilla._idx;
    const idx = new Map();
    for (const c of grilla.celdas) idx.set(c[0] + ',' + c[1], c);
    grilla._idx = idx;
    return idx;
  }

  function corredor(coords, grilla, radio = 40) {
    const { puntos, largo } = muestrear(coords);
    const g = grilla.deg, idx = indexar(grilla);
    const celdas = new Map();
    for (const p of puntos) {
      const i0 = Math.floor((p.lat - grilla.lat0) / g), j0 = Math.floor((p.lon - grilla.lon0) / g);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const i = i0 + a, j = j0 + b, k = i + ',' + j;
        if (celdas.has(k)) continue;
        const cLat = grilla.lat0 + (i + 0.5) * g, cLon = grilla.lon0 + (j + 0.5) * g;
        if (distM(p.lat, p.lon, cLat, cLon) <= radio) celdas.set(k, idx.get(k) || null);
      }
    }
    return { celdas, largo, puntos };
  }

  function nivel(media, u) {
    if (media >= u.p90) return 'Muy alto';
    if (media >= u.p75) return 'Alto';
    if (media >= u.p50) return 'Medio';
    return 'Bajo';
  }

  /**
   * @param coords   [[lon,lat],...] de la ruta
   * @param grilla   RSM.grilla
   * @param opts     {fecha: Date, duracionMin: number, lluvia: bool}
   */
  function evaluar(coords, grilla, opts) {
    const { celdas, largo } = corredor(coords, grilla);
    let sin = 0, mue = 0, moto = 0, peat = 0, bici = 0, veh = 0;
    for (const c of celdas.values()) {
      if (!c) continue;
      sin += c[2]; mue += c[3]; moto += c[4]; peat += c[5]; bici += c[6]; veh += c[7];
    }
    const nCel = celdas.size || 1;
    const anual = sin / grilla.anios;
    const media = anual / nCel; // siniestros/año por celda del corredor (incluye celdas sin registros)
    const f = opts.fecha || new Date();
    const dia = (f.getDay() + 6) % 7; // lunes = 0
    const hora = f.getHours();
    let fLluvia = 1;
    if (opts.lluvia && grilla.rr_lluvia && grilla.p_horas_lluvia != null) {
      const p = grilla.p_horas_lluvia, rr = grilla.rr_lluvia;
      fLluvia = rr / (p * rr + (1 - p)); // pasa de la tasa promedio a la tasa en horas con lluvia
    }
    const lambdaHora = (anual / 365) * (7 * grilla.perfil_dia[dia]) * grilla.perfil_hora[hora] * fLluvia;
    const durH = (opts.duracionMin || 0) / 60;
    const lambdaViaje = lambdaHora * durH;
    const vict = moto + peat + bici + veh;
    return {
      km: largo / 1000, celdas: celdas.size, siniestros: sin, muertes: mue, anual,
      porKm: anual / Math.max(largo / 1000, 0.1), media, nivel: nivel(media, grilla.umbrales),
      veces: media / grilla.media_ref,
      lambdaHora, lambdaViaje, pViaje: 1 - Math.exp(-lambdaViaje), pHora: 1 - Math.exp(-lambdaHora),
      fLluvia, dia, hora,
      victimas: vict ? { moto: moto / vict, peaton: peat / vict, bici: bici / vict, vehiculo: veh / vict, n: vict } : null,
    };
  }

  /* distancia mínima de un punto a la ruta muestreada (m) y posición a lo largo (m) */
  function cercania(lat, lon, puntos) {
    let best = Infinity, m = 0;
    for (const p of puntos) {
      const d = distM(lat, lon, p.lat, p.lon);
      if (d < best) { best = d; m = p.m; }
    }
    return { d: best, m };
  }

  const API = { distM, muestrear, corredor, evaluar, nivel, cercania };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Riesgo = API;
})(typeof window !== 'undefined' ? window : globalThis);
