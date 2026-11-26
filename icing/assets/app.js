/* Interface for the rime icing simulator. The physics lives in model.js. */
(function () {
  'use strict';
  var I = window.Icing, PI = Math.PI, R = I.REPORT;
  function $(id) { return document.getElementById(id); }
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  var DEFAULTS = { alpha: 0, speed: 20, chord: 9, mvd: 20, lwc: 1, temp: -25, time: 420 };
  var state = JSON.parse(JSON.stringify(DEFAULTS)), LAYERS = 6, NP = 160;
  var SL = {
    alpha: { label: 'Angle of attack', min: -4, max: 10, step: 0.5, unit: '°', dp: 1 },
    speed: { label: 'Air speed', min: 10, max: 60, step: 1, unit: 'm/s', dp: 0 },
    chord: { label: 'Chord', min: 5, max: 100, step: 1, unit: 'cm', dp: 0 },
    mvd: { label: 'Droplet diameter', min: 10, max: 50, step: 1, unit: 'µm', dp: 0 },
    lwc: { label: 'Liquid water content', min: 0.1, max: 2, step: 0.05, unit: 'g/m³', dp: 2 },
    temp: { label: 'Air temperature', min: -30, max: -5, step: 1, unit: '°C', dp: 0 },
    time: { label: 'Time in the cloud', min: 60, max: 1800, step: 30, unit: 's', dp: 0 }
  };
  function show(k) { var d = SL[k]; $('o_' + k).textContent = state[k].toFixed(d.dp) + (d.unit === '°' ? '°' : ' ' + d.unit) + (k === 'time' ? ' (' + (state.time / 60).toFixed(1) + ' min)' : ''); }
  function buildSliders() {
    var box = $('sliders'); box.innerHTML = '';
    Object.keys(SL).forEach(function (k) {
      var d = SL[k], div = document.createElement('div'); div.className = 'slider';
      div.innerHTML = '<div class="row"><label for="s_' + k + '">' + d.label + '</label><output id="o_' + k + '" for="s_' + k + '"></output></div><input type="range" id="s_' + k + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + state[k] + '">';
      box.appendChild(div); div.querySelector('input').addEventListener('input', function () { state[k] = +this.value; show(k); schedule(); }); show(k);
    });
  }
  $('reset').addEventListener('click', function () { state = JSON.parse(JSON.stringify(DEFAULTS)); buildSliders(); schedule(); });

  /* ---------- Simulation, one layer per tick ---------- */
  var job = 0, timer = 0, sim = null, defaultRun = null;
  function schedule() { clearTimeout(timer); $('busy').textContent = 'Solving…'; timer = setTimeout(run, 160); }
  function run() {
    var my = ++job, st = JSON.parse(JSON.stringify(state));
    var cl = I.cloud({ speed: st.speed, chord: st.chord / 100, mvd: st.mvd * 1e-6, lwc: st.lwc * 1e-3, temperature: st.temp + 273.15 });
    var hmax = 0.85 * cl.lwc * cl.speed / I.RIME_DENSITY, tcap = 0.11 * cl.chord / hmax, time = Math.min(st.time, tcap), notes = [];
    if (time < st.time) notes.push('Time limited to ' + Math.round(time) + ' s: beyond that the ice is thicker than a tenth of the chord and the simple growth rule stops being valid.');
    if (st.temp > -10) notes.push('Above about −10 °C part of the water runs back before freezing and forms glaze. The rime rule used here then overstates how closely the ice follows the nose.');
    $('note').textContent = notes.join(' ');
    var clean = I.naca4('2412', NP, st.alpha * PI / 180), fr = I.arcFractions(clean), body = clean, dt = time / LAYERS, layer = 0;
    var s = { st: st, cl: cl, clean: clean, body: clean, layers: [], caught: 0, time: time, done: false, cols: [], flowClean: null };
    (function step() {
      if (my !== job) return;
      var flow = new I.PanelFlow(body), col = I.collection(flow, cl, 60, true);
      if (layer === 0) { s.flowClean = flow; s.colClean = col; }
      s.cols.push(col); s.paths = col.paths; s.lastFlow = flow; s.lastCol = col;
      s.caught += cl.lwc * cl.speed * dt * col.total * col.height * cl.chord;
      body = I.growLayer(body, flow, col, cl, dt, fr); s.layers.push(body); s.body = body; layer++;
      sim = s; preparePaths(s); if (reduce) draw(0);
      if (layer < LAYERS) { $('busy').textContent = 'Growing ice: layer ' + (layer + 1) + ' of ' + LAYERS + '…'; setTimeout(step, 0); }
      else finish(s);
    })();
  }
  function finish(s) {
    var cl = s.cl, flowIce = new I.PanelFlow(s.body);
    s.flowIce = flowIce; s.done = true;
    s.mass = I.RIME_DENSITY * (I.polygonArea(s.body) - I.polygonArea(s.clean)) * cl.chord * cl.chord;   // kg per metre of span
    s.thick = I.maxThickness(s.body, s.clean) * cl.chord;
    var fineClean = new I.PanelFlow(I.naca4('2412', 200, s.st.alpha * PI / 180));
    s.blClean = I.boundaryLayer(fineClean, cl.Re); s.blIce = I.boundaryLayer(flowIce, cl.Re, s.lastCol.limits);
    $('busy').textContent = '';
    var E = s.colClean.total, m = s.mass * 1e3;
    $('tMass').innerHTML = (m >= 100 ? m.toFixed(0) : m.toFixed(1)) + ' <small>g/m of span</small>';
    $('tMassS').textContent = (s.mass * 250).toFixed(2) + ' g on a 25 cm model after ' + Math.round(s.time) + ' s.';
    $('tE').innerHTML = (E * 100).toFixed(0) + ' <small>%</small>';
    $('tES').textContent = 'of the water in the section\'s path. Peak local value ' + s.colClean.betaMax.toFixed(2) + ', inertia parameter K = ' + cl.K.toFixed(2) + '.';
    $('tTh').innerHTML = (s.thick * 1e3).toFixed(1) + ' <small>mm</small>';
    $('tThS').textContent = (s.thick / cl.chord * 100).toFixed(1) + '% of the chord, at the nose.';
    if (s.blClean && s.blIce) {
      var ch = (s.blIce.cd / s.blClean.cd - 1) * 100;
      $('tCd').innerHTML = (ch >= 0 ? '+' : '−') + Math.abs(ch).toFixed(0) + ' <small>%</small>';
      $('tCdS').textContent = 'Cd ' + s.blClean.cd.toFixed(4) + ' clean, ' + s.blIce.cd.toFixed(4) + ' with the flow tripped by ice. A lower bound: no roughness or separation.';
    } else { $('tCd').textContent = 'n/a'; $('tCdS').textContent = 'The boundary-layer model found no attached solution here.'; }
    var lim = s.colClean.limits, sLE = s.flowClean.sNodes[NP / 2];
    $('verdict').innerHTML = 'After ' + (s.time / 60).toFixed(1) + ' minutes the section carries <strong>' + (m >= 100 ? m.toFixed(0) : m.toFixed(1)) + ' g of ice per metre of span</strong>, up to ' + (s.thick * 1e3).toFixed(1) + ' mm thick. It catches ' + (E * 100).toFixed(0) + '% of the water in its path: droplets land from ' + ((sLE - lim[0]) * 100).toFixed(0) + '% of the chord back on the lower side to ' + ((lim[1] - sLE) * 100).toFixed(0) + '% on the upper side.' + (cl.K < 0.08 ? ' Most droplets follow the air around the nose at this size and speed.' : cl.K > 1 ? ' Droplets this heavy barely deviate from straight lines.' : '');
    var cap = 'NACA 2412 at ' + s.st.alpha.toFixed(1) + '°, ' + s.st.speed + ' m/s, ' + s.st.mvd + ' µm droplets, ' + s.st.temp + ' °C.';
    $('viewcap').textContent = cap; $('view').setAttribute('aria-label', cap + ' Ice ' + (s.thick * 1e3).toFixed(1) + ' millimetres thick on the leading edge.');
    drawBeta(s); drawCp(s);
    if (JSON.stringify(s.st) === JSON.stringify(DEFAULTS) && !defaultRun) { defaultRun = s; buildTable(); }
    if (reduce) draw(0);
  }

  /* ---------- View ---------- */
  var cv = $('view'), ctx = cv.getContext('2d'), W = 0, H = 0, zoom = 'nose', vis = true, paths = [];
  function preparePaths(s) {
    paths = s.paths.map(function (p) {
      var a = p.p, n = a.length / 2, len = new Float32Array(n);
      for (var i = 1; i < n; i++) len[i] = len[i - 1] + Math.hypot(a[2 * i] - a[2 * i - 2], a[2 * i + 1] - a[2 * i - 1]);
      return { hit: p.hit, p: a, len: len, total: len[n - 1], n: n };
    });
  }
  function resize() { var r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(tNow); }
  var tNow = 0;
  function draw(t) {
    if (!sim || !W) return;
    var x0 = zoom === 'nose' ? -0.2 : -0.45, x1 = zoom === 'nose' ? 0.42 : 1.15, sc = W / (x1 - x0), yc = zoom === 'nose' ? 0 : -0.5 * Math.sin(sim.st.alpha * PI / 180);
    function X(x) { return (x - x0) * sc; } function Y(y) { return H / 2 - (y - yc) * sc; }
    ctx.clearRect(0, 0, W, H);
    var cold = css('--cold'), line = css('--line'), ink = css('--ink'), i, k;
    ctx.lineWidth = 1; ctx.lineJoin = 'round';
    paths.forEach(function (p) {
      ctx.strokeStyle = p.hit ? cold : line; ctx.globalAlpha = p.hit ? 0.55 : 0.9; ctx.beginPath();
      for (i = 0; i < p.n; i++) { if (i) ctx.lineTo(X(p.p[2 * i]), Y(p.p[2 * i + 1])); else ctx.moveTo(X(p.p[0]), Y(p.p[1])); }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    function poly(nodes) { ctx.beginPath(); for (i = 0; i < nodes.length; i++) { if (i) ctx.lineTo(X(nodes[i][0]), Y(nodes[i][1])); else ctx.moveTo(X(nodes[0][0]), Y(nodes[0][1])); } ctx.closePath(); }
    poly(sim.body); ctx.fillStyle = '#C7E0F4'; ctx.fill(); ctx.strokeStyle = '#5FA3DD'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(42,111,176,0.5)';
    for (k = 0; k < sim.layers.length - 1; k++) { poly(sim.layers[k]); ctx.stroke(); }
    poly(sim.clean); ctx.fillStyle = ink; ctx.fill();
    if (!reduce) { // droplets moving along their paths
      paths.forEach(function (p, j) {
        ctx.fillStyle = p.hit ? cold : css('--ink-soft');
        for (var d = (t * 0.55 + j * 0.37) % 0.45; d < p.total; d += 0.45) {
          var lo = 0, hi = p.n - 1; while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (p.len[mid] <= d) lo = mid; else hi = mid; }
          var f = (d - p.len[lo]) / (p.len[hi] - p.len[lo] || 1), px = p.p[2 * lo] + f * (p.p[2 * hi] - p.p[2 * lo]), py = p.p[2 * lo + 1] + f * (p.p[2 * hi + 1] - p.p[2 * lo + 1]);
          if (px < x0 || px > x1) continue;
          ctx.beginPath(); ctx.arc(X(px), Y(py), p.hit ? 2.4 : 1.8, 0, 2 * PI); ctx.fill();
        }
      });
    }
  }
  var last = 0;
  function tick(ts) { requestAnimationFrame(tick); if (!vis || reduce || document.hidden || ts - last < 33) return; tNow += Math.min(0.1, (ts - last) / 1000); last = ts; draw(tNow); }
  function setZoom(z) { zoom = z; $('zNose').setAttribute('aria-pressed', z === 'nose'); $('zAll').setAttribute('aria-pressed', z === 'all'); draw(tNow); }
  $('zNose').addEventListener('click', function () { setZoom('nose'); }); $('zAll').addEventListener('click', function () { setZoom('all'); });
  if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { vis = en[0].isIntersecting; }).observe(cv);
  window.addEventListener('resize', resize);

  /* ---------- Charts ---------- */
  function niceStep(span, n) { var raw = span / n, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }
  function chart(el, o) {
    var Wd = 520, Hd = 320, m = { l: 54, r: 14, t: 12, b: 44 }, pw = Wd - m.l - m.r, ph = Hd - m.t - m.b, s = '';
    var xmin = Infinity, xmax = -Infinity, ymin = o.ymin != null ? o.ymin : Infinity, ymax = -Infinity;
    o.series.forEach(function (se) { se.pts.forEach(function (p) { xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]); if (o.ymin == null) ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }); });
    if (o.xmin != null) xmin = o.xmin; if (o.xmax != null) xmax = o.xmax; if (o.ymax != null) ymax = o.ymax;
    var ys = niceStep(ymax - ymin || 1, 5), xs = niceStep(xmax - xmin || 1, 6);
    ymin = Math.floor(ymin / ys + 1e-9) * ys; ymax = Math.ceil(ymax / ys - 1e-9) * ys;
    function X(v) { return m.l + pw * (v - xmin) / (xmax - xmin); } function Y(v) { return m.t + ph * (1 - (v - ymin) / (ymax - ymin)); }
    function lab(v, st) { var d = Math.max(0, -Math.floor(Math.log(st) / Math.LN10 + 1e-9)); return v.toFixed(d); }
    s += '<svg viewBox="0 0 ' + Wd + ' ' + Hd + '" role="img" aria-label="' + o.aria + '"><g font-size="11.500" style="fill:var(--ink-soft)">';
    for (var v = ymin; v <= ymax + ys / 2; v += ys) s += '<path d="M' + m.l + ' ' + Y(v).toFixed(1) + 'h' + pw + '" style="stroke:var(--line)"/><text x="' + (m.l - 8) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + lab(v, ys) + '</text>';
    for (v = Math.ceil(xmin / xs - 1e-9) * xs; v <= xmax + xs / 1e3; v += xs) s += '<path d="M' + X(v).toFixed(1) + ' ' + (m.t + ph) + 'v5" style="stroke:var(--ink-soft)"/><text x="' + X(v).toFixed(1) + '" y="' + (m.t + ph + 19) + '" text-anchor="middle">' + lab(v, xs) + '</text>';
    s += '<text x="' + (m.l + pw / 2) + '" y="' + (Hd - 4) + '" text-anchor="middle">' + o.xlabel + '</text><text transform="translate(13 ' + (m.t + ph / 2) + ') rotate(-90)" text-anchor="middle">' + o.ylabel + '</text></g>';
    s += '<path d="M' + m.l + ' ' + m.t + 'v' + ph + 'h' + pw + '" fill="none" style="stroke:var(--ink-soft)" stroke-width="1.200"/>';
    if (o.zero && xmin < 0 && xmax > 0) s += '<path d="M' + X(0).toFixed(1) + ' ' + m.t + 'v' + ph + '" style="stroke:var(--ink-soft)" stroke-dasharray="2 4"/>';
    o.series.forEach(function (se) {
      if (se.points) { se.pts.forEach(function (p) { s += '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="4" style="fill:' + se.color + ';stroke:var(--surface)" stroke-width="1.200"/>'; }); return; }
      var d = ''; se.pts.forEach(function (p, i) { d += (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(Math.max(ymin, Math.min(ymax, p[1]))).toFixed(1); });
      s += '<path d="' + d + '" fill="none" style="stroke:' + se.color + '" stroke-width="' + (se.width || 2.4) + '"' + (se.dash ? ' stroke-dasharray="' + se.dash + '"' : '') + ' stroke-linejoin="round"/>';
    });
    el.innerHTML = s + '</svg>';
  }
  function legend(el, items) { el.innerHTML = items.map(function (it) { return '<span style="--c:' + it[1] + '"' + (it[2] ? ' class="' + it[2] + '"' : '') + '>' + it[0] + '</span>'; }).join(''); }
  function zip(a, b) { return a.map(function (v, i) { return [v, b[i]]; }); }

  function drawBeta(s) {
    function curve(col, flow) { var s0 = flow.sNodes[NP / 2]; return col.s.map(function (v, i) { return [(v - s0) * 100, col.beta[i]]; }); }
    chart($('chartBeta'), { series: [{ pts: curve(s.colClean, s.flowClean), color: 'var(--cold)' }, { pts: curve(s.lastCol, s.lastFlow), color: 'var(--hot)' }], ymin: 0, zero: true,
      xlabel: 'distance from the nose along the surface [% of chord]', ylabel: 'collection efficiency β', aria: 'Local collection efficiency along the surface, on the clean section and on the last ice layer' });
    legend($('legBeta'), [['clean section', 'var(--cold)'], ['on the ice, last layer', 'var(--hot)']]);
  }
  function drawCp(s) {
    function curve(f) { var out = []; for (var i = 2; i < f.N - 2; i++) out.push([(f.mx[i] - s.flowClean.xmin) / (s.flowClean.xmax - s.flowClean.xmin), Math.min(f.vt[i] * f.vt[i] - 1, 4)]); return out; }
    chart($('chartCp'), { series: [{ pts: curve(s.flowClean), color: 'var(--cold)' }, { pts: curve(s.flowIce), color: 'var(--hot)' }], xmax: 1, xlabel: 'position along the chord, x/c', ylabel: 'suction, −Cp',
      aria: 'Surface pressure coefficient on the clean and iced section' });
    legend($('legCp'), [['clean section', 'var(--cold)'], ['with ice', 'var(--hot)']]);
  }

  /* ---------- Report data and checks ---------- */
  var A = [0, 1, 2, 3, 4, 5, 6, 7, 8], ReT = 1.2 * 20 * 0.09 / 1.81e-5, modelCd = [];
  function reportCharts() {
    A.forEach(function (a) { var b = I.boundaryLayer(new I.PanelFlow(I.naca4('2412', 200, a * PI / 180)), ReT); modelCd.push(b ? b.cd : NaN); });
    $('cd0').textContent = modelCd[0].toFixed(4);
    chart($('chartCl'), { series: [{ pts: zip(A, R.cfdCleanCl), color: 'var(--cold)' }, { pts: zip(A, R.cfdIcedCl), color: 'var(--hot)' }, { pts: zip(A, R.expCleanCl), color: 'var(--cold)', points: 1 }, { pts: zip(R.expIcedAlpha, R.expIcedCl), color: 'var(--hot)', points: 1 }],
      ymin: 0, xlabel: 'angle of attack [°]', ylabel: 'lift coefficient', aria: 'Lift coefficient against angle of attack, simulation and wind tunnel, clean and iced' });
    var items = [['simulation, clean', 'var(--cold)'], ['simulation, iced', 'var(--hot)'], ['tunnel, clean', 'var(--cold)', 'dot'], ['tunnel, iced', 'var(--hot)', 'dot']];
    legend($('legCl'), items);
    chart($('chartCdA'), { series: [{ pts: zip(A, R.cfdCleanCd), color: 'var(--cold)' }, { pts: zip(A, R.cfdIcedCd), color: 'var(--hot)' }, { pts: zip(A, modelCd), color: 'var(--ink)', dash: '6 4', width: 1.8 }, { pts: zip(A, R.expCleanCd), color: 'var(--cold)', points: 1 }, { pts: zip(R.expIcedAlpha, R.expIcedCd), color: 'var(--hot)', points: 1 }],
      ymin: 0, xlabel: 'angle of attack [°]', ylabel: 'drag coefficient', aria: 'Drag coefficient against angle of attack, simulation, wind tunnel and boundary-layer model' });
    legend($('legCd'), items.concat([['boundary-layer model, clean section without tips', 'var(--ink)', 'dash']]));
  }
  function buildTable() {
    var s = defaultRun, cl = s.cl, single = cl.lwc * cl.speed * 420 * s.colClean.total * s.colClean.height * R.chord * R.span * 1e3, multi = s.mass * R.span * 1e3;
    var g = I.gridConvergence(R.meshCl[0], R.meshCl[1], R.meshCl[2], Math.SQRT2), q = 0.5 * 1.225 * 400;
    var eps = s.flowClean.height === undefined ? 0 : 0, f8 = new I.PanelFlow(I.naca4('2412', 80, 8 * PI / 180)), e8 = (f8.ymax - f8.ymin) * R.chord * R.span / (4 * R.section);
    var rows = [
      ['Ice mass at 0°, 7 min, 25 cm span', '10.24 g (FENSAP-ICE)', single.toFixed(2) + ' g in one step, ' + multi.toFixed(2) + ' g in six layers', 'Confirmed. Growing the ice in layers catches a little less, because the blunter ice nose deflects more droplets.'],
      ['Lift coefficient at 0° in Table 4.5', '0.00371', (0.91017 / (q * R.chord * R.span)).toFixed(3), 'The table divided the force by a reference area of 1 m² in place of chord × span, 0.0225 m². The later tables use the right value.'],
      ['Extrapolated lift coefficient, Eq. 5.3', '0.175', g.extrapolated.toFixed(3) + ', order ' + g.order.toFixed(1), 'The value is right, the printed formula is not: as written it gives ' + ((R.meshCl[1] * 2 - R.meshCl[2]) / 1).toFixed(3) + '. The fine and medium terms are swapped.'],
      ['Grid convergence index, lift', '3.57%', (g.gci * 100).toFixed(2) + '%', 'Confirmed within rounding of the inputs.'],
      ['Blockage correction at 8°', 'drag × 1.40', 'coefficients ÷ ' + Math.pow(1 + e8, 2).toFixed(3), 'The report applied the correction to forces in newtons and in the wrong direction. The model fills ' + (e8 * 400).toFixed(1) + '% of the section, so blockage lowers the coefficients by about 2%.'],
      ['Clean drag coefficient at 0°', '0.0214 simulated, 0.0139 measured', modelCd[0].toFixed(4), 'A fully turbulent boundary layer overstates drag at this Reynolds number.'],
      ['Flow regime', 'described as laminar', 'Re = ' + Math.round(ReT / 1000) + ',000', 'The simulations used the SST k-ω turbulence model. The real flow is transitional: laminar over the front, turbulent behind.']
    ];
    $('checkTable').tBodies[0].innerHTML = rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td class="good">' + r[2] + '</td><td class="note">' + r[3] + '</td></tr>'; }).join('');
  }

  buildSliders(); resize(); reportCharts(); run(); requestAnimationFrame(tick);
  var mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', function () { draw(tNow); });
})();
