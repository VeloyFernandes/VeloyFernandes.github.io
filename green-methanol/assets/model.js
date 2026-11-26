/* Calculation core for the Green Methanol Power-to-X web UI.
 * Pure functions, no DOM. Works in the browser (window.Model) and in Node (require).
 * Mirrors the logic of Wind_Solar_v24.ipynb (energy balance: Chunk 5, LCOM: last cell).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Model = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- stoichiometry: CO2 + 3 H2 -> CH3OH + H2O ; 2 H2O -> 2 H2 + O2
  var M = { H2: 2.016, CO2: 44.009, MeOH: 32.042, H2O: 18.015, O2: 31.998 };
  var STOICH = {
    h2PerMeOH: 3 * M.H2 / M.MeOH,        // t H2 per t MeOH
    co2PerMeOH: M.CO2 / M.MeOH,          // t CO2 per t MeOH
    waterOutPerMeOH: M.H2O / M.MeOH,     // t H2O formed per t MeOH
    waterInPerH2: M.H2O / M.H2,          // t H2O electrolysed per t H2
    o2PerH2: M.O2 / (2 * M.H2)           // t O2 per t H2
  };

  var DEFAULTS = {
    solarBasis: 'clear',       // 'clear' (notebook baseline) | 'allsky' (NASA POWER 2023 irradiance)
    solarDcMw: 304,
    turbines: 20,
    electrolyzerMw: 53,
    methanolMw: 2,
    uptime: 0.92,
    h2KwhPerKg: 50.9           // electrolyser specific consumption (web-UI assumption)
  };

  var LCOM_DEFAULTS = {
    years: 30, discountRate: 0.05, degradation: 0.003,
    productionT: 44439, capex: 444210537.76, opexFixed: 15254147.04,
    generationMwh: 792230.58, exportMwh: 183638, importMwh: 140813,
    lcoe: 45.12, dayPrice: 31.12, nightPrice: 109.39, exportFactor: 0.85,
    dayExportShare: 0.8, dayImportShare: 0.3,
    mcRuns: 5000, mcSeed: 42,
    mcLcoeShift: -0.2, mcPriceShift: 0.2, mcSd: 0.02,
    tornadoLcoeLow: 20, tornadoLcoeHigh: 60, tornadoSwing: 0.2
  };

  // ---- time helpers -------------------------------------------------------
  // Returns "wall clock" timestamps: UTC ms shifted by the local UTC offset, so
  // Date#getUTC* yields Europe/Copenhagen local calendar fields.
  function wallClock(meta) {
    var n = meta.n, out = new Float64Array(n), segs = meta.utcOffsets, s = 0;
    for (var i = 0; i < n; i++) {
      while (s + 1 < segs.length && segs[s + 1][0] <= i) s++;
      out[i] = meta.t0 + i * 3600000 + segs[s][1] * 3600000;
    }
    return out;
  }

  // Group key per hour for a resolution: 'hour' | 'day' | 'week' | 'month'
  function groupStarts(wall, level) {
    var starts = [0], prev = keyOf(wall[0], level);
    for (var i = 1; i < wall.length; i++) {
      var k = keyOf(wall[i], level);
      if (k !== prev) { starts.push(i); prev = k; }
    }
    return starts;
  }
  function keyOf(t, level) {
    var d = new Date(t);
    if (level === 'month') return d.getUTCFullYear() * 12 + d.getUTCMonth();
    var day = Math.floor(t / 86400000);
    if (level === 'day') return day;
    if (level === 'week') return Math.floor((day + 3) / 7); // weeks start Monday (1970-01-01 was a Thursday)
    return t;
  }
  function aggregate(arr, starts, how) {
    var out = new Array(starts.length);
    for (var g = 0; g < starts.length; g++) {
      var a = starts[g], b = g + 1 < starts.length ? starts[g + 1] : arr.length;
      var s = 0, mn = Infinity, mx = -Infinity;
      for (var i = a; i < b; i++) { var v = arr[i]; s += v; if (v < mn) mn = v; if (v > mx) mx = v; }
      out[g] = how === 'mean' ? s / (b - a) : how === 'min' ? mn : how === 'max' ? mx : s;
    }
    return out;
  }

  // ---- scenario / energy balance ------------------------------------------
  function runScenario(data, p) {
    p = assign({}, DEFAULTS, p || {});
    var H = data.hourly, n = data.meta.n;
    var base = p.solarBasis === 'allsky' ? H.solarAllsky : H.solarClear;
    var ks = p.solarDcMw / data.solar.targetDcMw;
    var kw = p.turbines / data.wind.numTurbines;
    var elH = p.electrolyzerMw * p.uptime, meH = p.methanolMw * p.uptime, cons = elH + meH;
    var solar = new Float64Array(n), wind = new Float64Array(n), gen = new Float64Array(n), net = new Float64Array(n);
    var sS = 0, sW = 0, exp = 0, imp = 0, surplusH = 0, direct = 0, peak = 0;
    for (var i = 0; i < n; i++) {
      var s = base[i] * ks, w = H.wind[i] * kw, g = s + w, d = g - cons;
      solar[i] = s; wind[i] = w; gen[i] = g; net[i] = d;
      sS += s; sW += w;
      if (d > 0) { exp += d; surplusH++; } else imp -= d;
      direct += Math.min(g, cons);
      if (g > peak) peak = g;
    }
    var consTotal = cons * n, elTotal = elH * n;
    var h2T = p.h2KwhPerKg > 0 ? elTotal / p.h2KwhPerKg : 0; // MWh / (kWh/kg) = t
    var meohT = h2T / STOICH.h2PerMeOH;
    return {
      params: p, n: n,
      solar: solar, wind: wind, gen: gen, net: net,
      consHourly: cons, electrolyzerHourly: elH, methanolHourly: meH,
      totals: {
        solar: sS, wind: sW, generation: sS + sW,
        electrolyzer: elTotal, methanolPlant: meH * n, consumption: consTotal,
        net: sS + sW - consTotal, exportMwh: exp, importMwh: imp,
        surplusHours: surplusH, surplusShare: surplusH / n,
        directUse: direct, selfSufficiency: consTotal > 0 ? direct / consTotal : 0,
        selfConsumption: sS + sW > 0 ? direct / (sS + sW) : 0,
        peakGeneration: peak,
        solarCf: p.solarDcMw > 0 ? sS / (p.solarDcMw * n) : 0,
        windCf: p.turbines > 0 ? sW / (p.turbines * data.wind.ratedMw * n) : 0
      },
      process: {
        h2T: h2T, meohT: meohT,
        co2T: meohT * STOICH.co2PerMeOH,
        waterInT: h2T * STOICH.waterInPerH2,
        o2T: h2T * STOICH.o2PerH2,
        waterOutT: meohT * STOICH.waterOutPerMeOH
      }
    };
  }

  function monthlyTable(sc, wall) {
    var st = groupStarts(wall, 'month');
    var s = aggregate(sc.solar, st), w = aggregate(sc.wind, st), rows = [];
    for (var m = 0; m < st.length; m++) {
      var hrs = (m + 1 < st.length ? st[m + 1] : sc.n) - st[m];
      var el = sc.electrolyzerHourly * hrs, me = sc.methanolHourly * hrs, g = s[m] + w[m];
      rows.push({ month: m, hours: hrs, solar: s[m], wind: w[m], generation: g,
        electrolyzer: el, methanol: me, consumption: el + me, net: g - el - me });
    }
    return rows;
  }

  function durationCurve(arr, points) {
    var a = Array.prototype.slice.call(arr).sort(function (x, y) { return y - x; });
    var out = [], n = a.length, step = Math.max(1, Math.floor(n / (points || 400)));
    for (var i = 0; i < n; i += step) out.push([i / n * 100, a[i]]);
    out.push([100, a[n - 1]]);
    return out;
  }

  // ---- wind statistics ----------------------------------------------------
  function weibullPdf(x, k, A) {
    if (x <= 0) return 0;
    return (k / A) * Math.pow(x / A, k - 1) * Math.exp(-Math.pow(x / A, k));
  }
  function histogram(arr, bins, lo, hi, density) {
    var c = new Array(bins).fill(0), w = (hi - lo) / bins, n = 0;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i]; if (v < lo || v > hi) continue;
      var b = Math.min(bins - 1, Math.floor((v - lo) / w)); c[b]++; n++;
    }
    return c.map(function (cnt, b) {
      return { x0: lo + b * w, x1: lo + (b + 1) * w, count: cnt, value: density ? cnt / (n * w) : cnt };
    });
  }
  // 16-sector wind rose, share of time (%) per sector and speed bin
  function windRose(speed, dir, edges, sectors) {
    sectors = sectors || 16;
    var nb = edges.length, m = [], n = speed.length, sw = 360 / sectors;
    for (var b = 0; b < nb; b++) m.push(new Array(sectors).fill(0));
    for (var i = 0; i < n; i++) {
      var s = Math.floor(((dir[i] + sw / 2) % 360) / sw) % sectors, b2 = nb - 1;
      for (var j = 0; j < nb - 1; j++) if (speed[i] < edges[j + 1]) { b2 = j; break; }
      m[b2][s]++;
    }
    return m.map(function (row) { return row.map(function (c) { return c / n * 100; }); });
  }
  // share of hours per month in equal-width power bins (notebook "monthly distribution")
  function monthlyDistribution(arr, monthStarts, bins) {
    var mx = 0; for (var i = 0; i < arr.length; i++) if (arr[i] > mx) mx = arr[i];
    var top = mx * 1.01, w = top / bins, out = [];
    for (var m = 0; m < monthStarts.length; m++) {
      var a = monthStarts[m], b = m + 1 < monthStarts.length ? monthStarts[m + 1] : arr.length;
      var c = new Array(bins).fill(0);
      for (var k = a; k < b; k++) c[Math.min(bins - 1, Math.floor(arr[k] / w))]++;
      out.push(c.map(function (x) { return x / (b - a) * 100; }));
    }
    return { edges: Array.from({ length: bins + 1 }, function (_, i2) { return i2 * w; }), shares: out };
  }

  // ---- levelised cost of methanol -----------------------------------------
  function priceBases(p) {
    return {
      exportPrice: p.exportFactor * (p.dayPrice * p.dayExportShare + p.nightPrice * (1 - p.dayExportShare)),
      importPrice: p.dayPrice * p.dayImportShare + p.nightPrice * (1 - p.dayImportShare)
    };
  }
  function discountSums(p) {
    var c = 0, q = 0;
    for (var t = 1; t <= p.years; t++) {
      var df = 1 / Math.pow(1 + p.discountRate, t);
      c += df; q += Math.exp(-p.degradation * (t - 1)) * df;
    }
    return { cost: c, prod: q };
  }
  function lcomCore(p, capex, opex, lcoe, production, generation, exportPrice, importPrice, sums) {
    var energyCost = generation * lcoe + p.importMwh * importPrice - p.exportMwh * exportPrice;
    return (capex + (opex + energyCost) * sums.cost) / (production * sums.prod);
  }
  function lcom(p) {
    p = assign({}, LCOM_DEFAULTS, p || {});
    var pb = priceBases(p), sums = discountSums(p);
    var energyCost = p.generationMwh * p.lcoe + p.importMwh * pb.importPrice - p.exportMwh * pb.exportPrice;
    var denom = p.productionT * sums.prod;
    return {
      lcom: (p.capex + (p.opexFixed + energyCost) * sums.cost) / denom,
      exportPrice: pb.exportPrice, importPrice: pb.importPrice, annualEnergyCost: energyCost,
      breakdown: {
        capex: p.capex / denom,
        opex: p.opexFixed * sums.cost / denom,
        generation: p.generationMwh * p.lcoe * sums.cost / denom,
        gridImport: p.importMwh * pb.importPrice * sums.cost / denom,
        gridExport: -p.exportMwh * pb.exportPrice * sums.cost / denom
      }
    };
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function normalSampler(seed) {
    var u = mulberry32(seed), spare = null;
    return function (mean, sd) {
      if (spare !== null) { var s = spare; spare = null; return mean + sd * s; }
      var a, b, r;
      do { a = 2 * u() - 1; b = 2 * u() - 1; r = a * a + b * b; } while (r >= 1 || r === 0);
      var f = Math.sqrt(-2 * Math.log(r) / r);
      spare = b * f; return mean + sd * a * f;
    };
  }
  function percentile(sorted, q) {
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function monteCarlo(p) {
    p = assign({}, LCOM_DEFAULTS, p || {});
    var pb = priceBases(p), sums = discountSums(p), rnd = normalSampler(p.mcSeed), v = new Float64Array(p.mcRuns), sum = 0;
    for (var i = 0; i < p.mcRuns; i++) {
      var lcoe = p.lcoe * (1 + rnd(p.mcLcoeShift, p.mcSd));
      var ex = pb.exportPrice * (1 + rnd(p.mcPriceShift, p.mcSd));
      var im = pb.importPrice * (1 + rnd(p.mcPriceShift, p.mcSd));
      v[i] = lcomCore(p, p.capex, p.opexFixed, lcoe, p.productionT, p.generationMwh, ex, im, sums);
      sum += v[i];
    }
    var sorted = Array.prototype.slice.call(v).sort(function (a, b) { return a - b; });
    return { values: sorted, mean: sum / p.mcRuns, p5: percentile(sorted, 0.05), p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
  }
  function tornado(p) {
    p = assign({}, LCOM_DEFAULTS, p || {});
    var pb = priceBases(p), sums = discountSums(p), s = p.tornadoSwing;
    function f(capex, opex, lcoe, prod, gen) { return lcomCore(p, capex, opex, lcoe, prod, gen, pb.exportPrice, pb.importPrice, sums); }
    var base = f(p.capex, p.opexFixed, p.lcoe, p.productionT, p.generationMwh);
    var pct = Math.round(s * 100);
    var rows = [
      { name: 'LCOE', range: p.tornadoLcoeLow + '–' + p.tornadoLcoeHigh + ' EUR/MWh',
        low: f(p.capex, p.opexFixed, p.tornadoLcoeLow, p.productionT, p.generationMwh),
        high: f(p.capex, p.opexFixed, p.tornadoLcoeHigh, p.productionT, p.generationMwh) },
      { name: 'Production', range: '±' + pct + '% (generation scales with it)',
        low: f(p.capex, p.opexFixed, p.lcoe, p.productionT * (1 - s), p.generationMwh * (1 - s)),
        high: f(p.capex, p.opexFixed, p.lcoe, p.productionT * (1 + s), p.generationMwh * (1 + s)) },
      { name: 'CAPEX', range: '±' + pct + '%',
        low: f(p.capex * (1 - s), p.opexFixed, p.lcoe, p.productionT, p.generationMwh),
        high: f(p.capex * (1 + s), p.opexFixed, p.lcoe, p.productionT, p.generationMwh) },
      { name: 'OPEX', range: '±' + pct + '%',
        low: f(p.capex, p.opexFixed * (1 - s), p.lcoe, p.productionT, p.generationMwh),
        high: f(p.capex, p.opexFixed * (1 + s), p.lcoe, p.productionT, p.generationMwh) }
    ];
    rows.sort(function (a, b) { return Math.abs(b.high - b.low) - Math.abs(a.high - a.low); });
    return { base: base, rows: rows };
  }

  function assign(t) {
    for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; }
    return t;
  }

  return {
    M: M, STOICH: STOICH, DEFAULTS: DEFAULTS, LCOM_DEFAULTS: LCOM_DEFAULTS,
    wallClock: wallClock, groupStarts: groupStarts, aggregate: aggregate,
    runScenario: runScenario, monthlyTable: monthlyTable, durationCurve: durationCurve,
    weibullPdf: weibullPdf, histogram: histogram, windRose: windRose, monthlyDistribution: monthlyDistribution,
    lcom: lcom, monteCarlo: monteCarlo, tornado: tornado, priceBases: priceBases
  };
});
