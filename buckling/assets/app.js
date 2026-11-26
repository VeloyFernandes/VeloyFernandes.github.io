/* Interface for the corrugated panel buckling simulator. The mechanics live in model.js. */
(function () {
  'use strict';
  var B = window.Buckling, PI = Math.PI;
  function $(id) { return document.getElementById(id); }
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var MATERIALS = {
    steel: { E: 2.1e11, nu: 0.3, fy: 250e6, rho: 7850 },
    s355: { E: 2.1e11, nu: 0.3, fy: 355e6, rho: 7850 },
    al: { E: 68.9e9, nu: 0.33, fy: 276e6, rho: 2700 },
    ti: { E: 113.8e9, nu: 0.342, fy: 880e6, rho: 4430 }
  };
  var DEFAULTS = { kind: 'trapezoidal', dir: 'x', ends: 'pinned', edges: 'supported', material: 'steel',
    t: 6.35, len: 1.016, wid: 1.016, depth: 25.4, c: 50.8, theta: 45, R: 25.4, straight: 50.8 };
  var state = JSON.parse(JSON.stringify(DEFAULTS));

  var SLIDERS = {
    t: { label: 'Sheet thickness', min: 0.3, max: 12, step: 0.05, unit: 'mm', dp: 2 },
    len: { label: 'Length in the load direction', min: 0.2, max: 3, step: 0.004, unit: 'm', dp: 3 },
    wid: { label: 'Width', min: 0.2, max: 3, step: 0.004, unit: 'm', dp: 3 },
    depth: { label: 'Corrugation depth', min: 2, max: 80, step: 0.2, unit: 'mm', dp: 1 },
    c: { label: 'Half period (crest to trough)', min: 10, max: 150, step: 0.2, unit: 'mm', dp: 1 },
    theta: { label: 'Web angle', min: 15, max: 90, step: 1, unit: '°', dp: 0 },
    R: { label: 'Crest radius', min: 5, max: 80, step: 0.2, unit: 'mm', dp: 1 },
    straight: { label: 'Straight between crests', min: 0, max: 120, step: 0.2, unit: 'mm', dp: 1 }
  };
  var KIND_SLIDERS = { flat: ['t', 'len', 'wid'], trapezoidal: ['t', 'len', 'wid', 'depth', 'c', 'theta'], round: ['t', 'len', 'wid', 'R', 'straight'] };

  function fmt(N) { // line load in kN/m
    var v = N / 1e3;
    if (!isFinite(v)) return 'n/a';
    if (v >= 100) return Math.round(v).toLocaleString('en-GB');
    return v.toFixed(v >= 10 ? 1 : 2);
  }
  function sig3(v) { return v >= 100 ? Math.round(v).toLocaleString('en-GB') : v >= 10 ? v.toFixed(1) : v.toFixed(2); }

  /* ---------- Model set-up ---------- */
  function makeSheet(st) { var m = MATERIALS[st.material]; return B.sheet(m.E, m.nu, st.t / 1e3, m.fy, m.rho); }
  function span(st) { return st.dir === 'x' ? st.len : st.wid; }       // panel dimension across the corrugations
  function makeProfile(st, fit) {
    var sp = span(st), n, note = '';
    if (st.kind === 'flat') return { p: B.flat(fit ? sp / 10 : 0.1016), note: '' };
    if (st.kind === 'trapezoidal') {
      var c = st.c / 1e3, f = st.depth / 2e3, th = st.theta * PI / 180;
      if (fit) { n = Math.max(1, Math.round(sp / (2 * c))); c = sp / (2 * n); note = n + (n === 1 ? ' corrugation' : ' corrugations') + ' of ' + (2e3 * c).toFixed(1) + ' mm fit the panel.'; }
      var fmax = th < PI / 2 - 1e-6 ? c * Math.tan(th) / 2 : Infinity;
      if (f > fmax) { f = fmax; note += ' Depth limited to ' + (2e3 * f).toFixed(1) + ' mm: at this angle the webs meet.'; }
      return { p: B.trapezoidal(f, c, th), note: note };
    }
    var R = st.R / 1e3;
    if (fit) { n = Math.max(1, Math.round(sp / (4 * R))); R = sp / (4 * n); note = n + (n === 1 ? ' corrugation' : ' corrugations') + ' fit the panel, crest radius ' + (1e3 * R).toFixed(1) + ' mm.'; }
    return { p: B.round(R, st.straight / 2e3), note: note };
  }
  function endsFor(dir, ends) { return dir === 'y' && ends !== 'fixed' ? 'pinned' : ends; }

  function solve(st) {
    var s = makeSheet(st), pr = makeProfile(st, true), p = pr.p, eq = B.equivalentPlate(s, p), flatP = B.flat(span(st) / 10);
    var ends = endsFor(st.dir, st.ends), num, flat;
    if (st.dir === 'x') { num = B.frameBuckle(s, p, st.len, ends); flat = B.wideStrut(s.D11, st.len, ends); }
    else { num = B.stripPanel(s, p, st.wid, st.len, ends, st.edges); flat = st.kind === 'flat' ? num.N : B.stripPanel(s, flatP, st.wid, st.len, ends, st.edges).N; }
    var Ny = B.squashLoad(s, p, st.dir);
    return { s: s, p: p, eq: eq, note: pr.note, num: num, Ncr: num.N, flat: flat, Ny: Ny, design: B.designResistance(num.N, Ny),
      closed: B.wideStrut(st.dir === 'x' ? eq.D11 : eq.D22, st.len, ends), mass: B.massPerArea(s, p), ends: ends };
  }

  /* ---------- Controls ---------- */
  function buildSliders() {
    var box = $('sliders'); box.innerHTML = '';
    KIND_SLIDERS[state.kind].forEach(function (k) {
      var d = SLIDERS[k], div = document.createElement('div'); div.className = 'slider';
      div.innerHTML = '<div class="row"><label for="s_' + k + '">' + d.label + '</label><output id="o_' + k + '" for="s_' + k + '"></output></div>' +
        '<input type="range" id="s_' + k + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + state[k] + '">';
      box.appendChild(div);
      div.querySelector('input').addEventListener('input', function () { state[k] = +this.value; showValue(k); schedule(); });
      showValue(k);
    });
    var sw = $('sweep'), keep = sw.value; sw.innerHTML = '';
    KIND_SLIDERS[state.kind].filter(function (k) { return k !== 'len' && k !== 'wid'; }).forEach(function (k) {
      var o = document.createElement('option'); o.value = k; o.textContent = SLIDERS[k].label.toLowerCase(); sw.appendChild(o);
    });
    if ([].some.call(sw.options, function (o) { return o.value === keep; })) sw.value = keep;
  }
  function showValue(k) { var d = SLIDERS[k]; $('o_' + k).textContent = state[k].toFixed(d.dp) + (d.unit === '°' ? '°' : ' ' + d.unit); }
  function syncControls() {
    document.querySelectorAll('input[name=kind]').forEach(function (r) { r.checked = r.value === state.kind; });
    document.querySelectorAll('input[name=dir]').forEach(function (r) { r.checked = r.value === state.dir; });
    var along = state.dir === 'y';
    [].forEach.call($('ends').options, function (o) { if (o.hasAttribute('data-x')) { o.disabled = along; o.hidden = along; } });
    if (along && state.ends !== 'fixed') state.ends = 'pinned';
    $('ends').value = state.ends; $('edges').value = state.edges; $('material').value = state.material;
    $('edgesBox').hidden = !along;
    var m = MATERIALS[state.material];
    $('matnote').textContent = 'E = ' + (m.E / 1e9).toFixed(m.E % 1e9 ? 1 : 0) + ' GPa, ν = ' + m.nu + ', yield ' + m.fy / 1e6 + ' MPa, ' + m.rho + ' kg/m³';
    document.querySelectorAll('.seg label').forEach(function (l) { if (l.querySelector('[name=dir]')) l.firstChild.nextSibling.textContent = state.kind === 'flat' ? (l.querySelector('input').value === 'x' ? 'Along x' : 'Along y') : (l.querySelector('input').value === 'x' ? 'Across corrugations' : 'Along corrugations'); });
  }
  document.querySelectorAll('input[name=kind]').forEach(function (r) { r.addEventListener('change', function () { state.kind = this.value; buildSliders(); syncControls(); schedule(); }); });
  document.querySelectorAll('input[name=dir]').forEach(function (r) { r.addEventListener('change', function () { state.dir = this.value; syncControls(); schedule(); }); });
  ['ends', 'edges', 'material'].forEach(function (id) { $(id).addEventListener('change', function () { state[id] = this.value; syncControls(); schedule(); }); });
  $('sweep').addEventListener('change', function () { drawSweep(); });
  $('reset').addEventListener('click', function () { state = JSON.parse(JSON.stringify(DEFAULTS)); buildSliders(); syncControls(); schedule(); });

  /* ---------- Results ---------- */
  var current = null, timer = 0;
  function schedule() { $('busy').textContent = 'Solving…'; clearTimeout(timer); timer = setTimeout(update, 70); }
  function update() {
    var r;
    try { r = solve(state); } catch (e) { $('busy').textContent = 'This geometry could not be solved.'; return; }
    current = r;
    $('geonote').textContent = r.note;
    var ratio = r.Ncr / r.flat, along = state.dir === 'y', yields = r.Ny < r.Ncr;
    $('tNcr').innerHTML = fmt(r.Ncr) + ' <small>kN/m</small>';
    $('tNcrS').textContent = (along ? 'Finite strip, ' : 'Frame elements, ') + r.num.dof.toLocaleString('en-GB') + ' unknowns. Plate theory: ' + fmt(r.closed) + ' kN/m.';
    $('tFlat').innerHTML = state.kind === 'flat' ? '1.00 <small>×</small>' : (ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(2)) + ' <small>×</small>';
    $('tFlatS').textContent = 'A flat plate of the same sheet buckles at ' + fmt(r.flat) + ' kN/m.';
    $('tGov').textContent = yields ? 'Yield' : 'Buckling';
    $('tGovS').textContent = (along ? 'Section yields at ' : 'First yield in bending at ') + fmt(r.Ny) + ' kN/m. Indicative design load ' + fmt(r.design) + ' kN/m.';
    $('tMass').innerHTML = r.mass.toFixed(1) + ' <small>kg/m²</small>';
    $('tMassS').textContent = (Math.min(r.Ncr, r.Ny) / 1e3 / r.mass).toFixed(Math.min(r.Ncr, r.Ny) / 1e3 / r.mass >= 10 ? 0 : 2) + ' kN/m carried per kg/m², ' + (state.kind === 'flat' ? 'no extra sheet.' : ((r.p.l / r.p.c - 1) * 100).toFixed(0) + '% more sheet than a flat plate.');
    $('verdict').innerHTML = verdict(r, ratio, yields);
    var cap = (along ? (state.kind === 'flat' ? 'Compressed along y' : 'Compressed along the corrugations') : (state.kind === 'flat' ? 'Compressed along x' : 'Compressed across the corrugations')) + ', ' + { 'pinned': 'pinned ends', 'fixed': 'fixed ends', 'pinned-fixed': 'one end pinned, one fixed', 'fixed-free': 'one end fixed, one free' }[r.ends] + '. Displacement exaggerated.';
    $('viewcap').textContent = cap;
    $('view').setAttribute('aria-label', cap + ' First buckling mode at ' + fmt(r.Ncr) + ' kilonewtons per metre.');
    buildMesh(r);
    $('busy').textContent = '';
    drawSweep(); startCurve();
  }
  function verdict(r, ratio, yields) {
    var along = state.dir === 'y', txt;
    if (state.kind === 'flat') txt = 'A flat plate buckles at <strong>' + fmt(r.Ncr) + ' kN/m</strong>. It is the reference the corrugated panels are measured against.';
    else if (!along) txt = 'Pushed across the corrugations, this panel buckles at <strong>' + fmt(r.Ncr) + ' kN/m</strong>, ' + (ratio < 1 ? Math.round((1 - ratio) * 100) + '% below' : Math.round((ratio - 1) * 100) + '% above') + ' a flat plate of the same sheet. The folds add ' + ((r.p.l / r.p.c - 1) * 100).toFixed(0) + '% more sheet to bend and no stiffness in this direction.';
    else txt = 'Pushed along the corrugations, elastic buckling needs <strong>' + fmt(r.Ncr) + ' kN/m</strong>, ' + (ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)) + ' times a flat plate of the same sheet.';
    if (along) txt += r.num.m > 1 ? ' The mode is local: ' + r.num.m + ' half-waves of ' + (r.num.halfWave * 1e3).toFixed(0) + ' mm along the folds.' : ' The mode is one half-wave over the whole length.';
    if (yields) txt += ' The sheet yields first, at ' + fmt(r.Ny) + ' kN/m, so strength and not stability sets the limit.';
    return txt + ' Allowing for imperfections, an indicative design load is ' + fmt(r.design) + ' kN/m.';
  }

  /* ---------- 3D view ---------- */
  var cv = $('view'), ctx = cv.getContext('2d'), mesh = null, cam = { yaw: -0.62, pitch: 0.5 }, order = null, vis = true, W = 0, H = 0;
  var STOPS = [[42, 111, 176], [143, 179, 207], [217, 210, 200], [222, 154, 126], [196, 71, 45]];
  function ramp(t, sh) {
    t = Math.max(0, Math.min(1, t)) * 4; var i = Math.min(3, Math.floor(t)), f = t - i, a = STOPS[i], b = STOPS[i + 1];
    return 'rgb(' + Math.round((a[0] + (b[0] - a[0]) * f) * sh) + ',' + Math.round((a[1] + (b[1] - a[1]) * f) * sh) + ',' + Math.round((a[2] + (b[2] - a[2]) * f) * sh) + ')';
  }
  function buildMesh(r) {
    var along = state.dir === 'y', nodes = r.num.nodes, mode = r.num.mode, nx = nodes.length, Ly = along ? state.len : state.wid, Lx = along ? state.wid : state.len;
    var m = along ? r.num.m : 1, ny = along ? Math.max(20, Math.min(44, 10 * m)) + 1 : 7, i, j;
    if (nx * ny > 14000) ny = Math.max(13, Math.floor(14000 / nx));
    var P = new Float32Array(nx * ny * 3), Dm = new Float32Array(nx * ny * 3), mag = new Float32Array(nx * ny), mx = 0;
    for (j = 0; j < ny; j++) {
      var y = Ly * j / (ny - 1), S = 1;
      if (along) S = r.ends === 'fixed' ? (1 - Math.cos(2 * PI * m * y / Ly)) / 2 : Math.sin(m * PI * y / Ly);
      for (i = 0; i < nx; i++) {
        var q = (j * nx + i) * 3;
        P[q] = nodes[i][0] - Lx / 2; P[q + 1] = y - Ly / 2; P[q + 2] = nodes[i][1];
        Dm[q] = mode[i][0] * S; Dm[q + 1] = 0; Dm[q + 2] = mode[i][2] * S;
        mag[j * nx + i] = Math.sqrt(Dm[q] * Dm[q] + Dm[q + 2] * Dm[q + 2]); mx = Math.max(mx, mag[j * nx + i]);
      }
    }
    for (i = 0; i < mag.length; i++) mag[i] /= mx || 1;
    var nrm = new Float32Array((nx - 1) * 2);
    for (i = 0; i < nx - 1; i++) { var dx = nodes[i + 1][0] - nodes[i][0], dz = nodes[i + 1][1] - nodes[i][1], L = Math.sqrt(dx * dx + dz * dz); nrm[2 * i] = -dz / L; nrm[2 * i + 1] = dx / L; }
    mesh = { nx: nx, ny: ny, P: P, D: Dm, mag: mag, nrm: nrm, Lx: Lx, Ly: Ly, depth: r.p.depth, amp: 0.06 * Math.max(Lx, Ly), along: along, S: new Float32Array(nx * ny * 2) };
    order = null; if (reduce || !vis) draw(1);
  }
  function resize() {
    var r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (mesh) draw(reduce ? 1 : Math.sin(phase));
  }
  function project(x, y, z, out, o) {
    var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var xr = x * cy - y * sy, yr = x * sy + y * cy;
    out[o] = xr; out[o + 1] = -(yr * sp + z * cp);
    return -yr * cp + z * sp;
  }
  function draw(a) {
    if (!mesh || !W) return;
    var nx = mesh.nx, ny = mesh.ny, P = mesh.P, D = mesh.D, S = mesh.S, amp = mesh.amp * a, i, j, q, k;
    var ext = Math.sqrt(mesh.Lx * mesh.Lx + mesh.Ly * mesh.Ly) + mesh.depth + mesh.amp, sc = Math.min(W, H * 1.55) / ext * 0.86, ox = W / 2, oy = H / 2 + 6;
    var nq = (nx - 1) * (ny - 1);
    if (!order) {
      var dep = new Float32Array(nq), tmp = [0, 0]; order = new Uint32Array(nq);
      for (j = 0; j < ny - 1; j++) for (i = 0; i < nx - 1; i++) { q = (j * nx + i) * 3; k = j * (nx - 1) + i; order[k] = k; dep[k] = project((P[q] + P[q + 3]) / 2, P[q + 1] + mesh.Ly / (ny - 1) / 2, P[q + 2], tmp, 0); }
      Array.prototype.sort.call(order, function (u, v) { return dep[u] - dep[v]; });
    }
    for (k = 0; k < nx * ny; k++) { q = k * 3; project(P[q] + amp * D[q], P[q + 1], P[q + 2] + amp * D[q + 2], S, 2 * k); S[2 * k] = ox + sc * S[2 * k]; S[2 * k + 1] = oy + sc * S[2 * k + 1]; }
    ctx.clearRect(0, 0, W, H);
    var cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    ctx.lineWidth = 0.6; ctx.lineJoin = 'round';
    for (var n = 0; n < nq; n++) {
      k = order[n]; j = Math.floor(k / (nx - 1)); i = k - j * (nx - 1);
      var a0 = j * nx + i, a1 = a0 + 1, a2 = a1 + nx, a3 = a0 + nx;
      var nxw = mesh.nrm[2 * i], nzw = mesh.nrm[2 * i + 1], vx = nxw * cyw, vy = nxw * syw;
      var lit = Math.abs(vx * 0.35 + (-(vy * sp + nzw * cp)) * -0.55 + (-vy * cp + nzw * sp) * 0.75);
      var col = ramp((mesh.mag[a0] + mesh.mag[a1] + mesh.mag[a2] + mesh.mag[a3]) / 4, 0.62 + 0.38 * Math.min(1, lit));
      ctx.fillStyle = col; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(S[2 * a0], S[2 * a0 + 1]); ctx.lineTo(S[2 * a1], S[2 * a1 + 1]); ctx.lineTo(S[2 * a2], S[2 * a2 + 1]); ctx.lineTo(S[2 * a3], S[2 * a3 + 1]); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // load arrows on the two loaded edges
    var ink = getComputedStyle(document.documentElement).getPropertyValue('--hot').trim() || '#C4472D', t2 = [0, 0, 0, 0];
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 2; ctx.lineCap = 'round';
    var al = 0.11 * Math.max(mesh.Lx, mesh.Ly), gap = 0.03 * Math.max(mesh.Lx, mesh.Ly);
    for (var side = -1; side <= 1; side += 2) for (i = 0; i < 5; i++) {
      var u = (i + 0.5) / 5 - 0.5, x0, y0, x1, y1;
      if (mesh.along) { x0 = x1 = u * mesh.Lx; y1 = side * (mesh.Ly / 2 + gap); y0 = y1 + side * al; } else { y0 = y1 = u * mesh.Ly; x1 = side * (mesh.Lx / 2 + gap); x0 = x1 + side * al; }
      project(x0, y0, 0, t2, 0); project(x1, y1, 0, t2, 2);
      var ax = ox + sc * t2[0], ay = oy + sc * t2[1], bx = ox + sc * t2[2], by = oy + sc * t2[3], ang = Math.atan2(by - ay, bx - ax);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - 9 * Math.cos(ang - 0.42), by - 9 * Math.sin(ang - 0.42)); ctx.lineTo(bx - 9 * Math.cos(ang + 0.42), by - 9 * Math.sin(ang + 0.42)); ctx.closePath(); ctx.fill();
    }
  }
  var phase = 0, lastT = 0;
  function tick(t) {
    requestAnimationFrame(tick);
    if (!vis || reduce || document.hidden || t - lastT < 30) return;
    phase += Math.min(0.1, (t - lastT) / 1000) * 2.4; lastT = t;
    draw(Math.sin(phase));
  }
  var drag = null;
  cv.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', function (e) {
    if (!drag) return;
    cam.yaw = drag.yaw - (e.clientX - drag.x) * 0.008; cam.pitch = Math.max(0.08, Math.min(1.45, drag.pitch + (e.clientY - drag.y) * 0.006)); order = null;
    if (reduce) draw(1);
  });
  cv.addEventListener('pointerup', function () { drag = null; });
  cv.addEventListener('pointercancel', function () { drag = null; });
  cv.setAttribute('tabindex', '0');
  cv.addEventListener('keydown', function (e) {
    var k = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, 0.07], ArrowDown: [0, -0.07] }[e.key]; if (!k) return;
    cam.yaw += k[0]; cam.pitch = Math.max(0.08, Math.min(1.45, cam.pitch + k[1])); order = null; e.preventDefault(); if (reduce) draw(1);
  });
  if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { vis = en[0].isIntersecting; }).observe(cv);
  window.addEventListener('resize', resize);

  /* ---------- Charts ---------- */
  function niceStep(span, n) { var raw = span / n, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }
  function chart(el, o) {
    var Wd = 520, Hd = 330, m = { l: 58, r: 14, t: 12, b: 44 }, pw = Wd - m.l - m.r, ph = Hd - m.t - m.b, i, s = '';
    var lx = o.xlog ? function (v) { return Math.log(v) / Math.LN10; } : function (v) { return v; };
    var ly = function (v) { return Math.log(v) / Math.LN10; };
    var x0 = lx(o.xmin), x1 = lx(o.xmax), ymin = Infinity, ymax = -Infinity;
    o.series.forEach(function (se) { se.pts.forEach(function (p) { if (p[1] > 0 && isFinite(p[1])) { ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); } }); });
    (o.hlines || []).forEach(function (h) { if (h.y > 0) { ymin = Math.min(ymin, h.y); ymax = Math.max(ymax, h.y); } });
    var y0 = Math.floor(ly(ymin) - 0.05), y1 = Math.ceil(ly(ymax) + 0.05); if (y1 - y0 < 1) y1 = y0 + 1;
    function X(v) { return m.l + pw * (lx(v) - x0) / (x1 - x0); }
    function Y(v) { return m.t + ph * (1 - (ly(v) - y0) / (y1 - y0)); }
    s += '<svg viewBox="0 0 ' + Wd + ' ' + Hd + '" role="img" aria-label="' + o.aria + '"><g font-size="11.500" style="fill:var(--ink-soft)">';
    for (i = y0; i <= y1; i++) {
      var yy = Y(Math.pow(10, i)), lab = i >= 0 ? Math.pow(10, i).toLocaleString('en-GB') : Math.pow(10, i).toFixed(-i);
      s += '<path d="M' + m.l + ' ' + yy.toFixed(1) + 'h' + pw + '" style="stroke:var(--line)" stroke-width="1"/><text x="' + (m.l - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end">' + lab + '</text>';
    }
    var ticks = [];
    if (o.xlog) [0.1, 0.2, 0.5, 1, 2, 5].forEach(function (v) { if (v >= o.xmin * 0.999 && v <= o.xmax * 1.001) ticks.push(v); });
    else { var st = niceStep(o.xmax - o.xmin, 5); for (var v = Math.ceil(o.xmin / st) * st; v <= o.xmax + 1e-9; v += st) ticks.push(v); }
    ticks.forEach(function (v) { s += '<path d="M' + X(v).toFixed(1) + ' ' + (m.t + ph) + 'v5" style="stroke:var(--ink-soft)"/><text x="' + X(v).toFixed(1) + '" y="' + (m.t + ph + 19) + '" text-anchor="middle">' + (+v.toPrecision(6)) + '</text>'; });
    s += '<text x="' + (m.l + pw / 2) + '" y="' + (Hd - 4) + '" text-anchor="middle">' + o.xlabel + '</text>';
    s += '<text transform="translate(13 ' + (m.t + ph / 2) + ') rotate(-90)" text-anchor="middle">critical load [kN/m]</text></g>';
    s += '<path d="M' + m.l + ' ' + m.t + 'v' + ph + 'h' + pw + '" fill="none" style="stroke:var(--ink-soft)" stroke-width="1.200"/>';
    if (o.vline != null) s += '<path d="M' + X(o.vline).toFixed(1) + ' ' + m.t + 'v' + ph + '" style="stroke:var(--ink)" stroke-width="1" stroke-dasharray="2 4"/>';
    (o.hlines || []).forEach(function (h) { s += '<path d="M' + m.l + ' ' + Y(h.y).toFixed(1) + 'h' + pw + '" style="stroke:' + h.color + '" stroke-width="1.500" stroke-dasharray="7 5"/>'; });
    o.series.forEach(function (se) {
      var d = '', pen = false;
      se.pts.forEach(function (p) { if (!(p[1] > 0) || !isFinite(p[1])) { pen = false; return; } d += (pen ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); pen = true; });
      s += '<path d="' + d + '" fill="none" style="stroke:' + se.color + '" stroke-width="' + (se.width || 2.4) + '"' + (se.dash ? ' stroke-dasharray="' + se.dash + '"' : '') + ' stroke-linejoin="round"/>';
    });
    (o.dots || []).forEach(function (p) { if (p.y > 0) s += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="4.500" style="fill:' + p.color + ';stroke:var(--surface)" stroke-width="1.500"/>'; });
    el.innerHTML = s + '</svg>';
  }
  function legend(el, items) { el.innerHTML = items.map(function (it) { return '<span style="--c:' + it[1] + '"' + (it[2] ? ' class="dash"' : '') + '>' + it[0] + '</span>'; }).join(''); }
  var names = function () { return state.kind === 'flat' ? ['load along x', 'load along y'] : ['across the corrugations', 'along the corrugations']; };

  // Buckling load against panel length; the along-corrugation curve comes from the finite strip signature curve
  var curveJob = 0, curveCache = {};
  function startCurve() {
    var r = current, key = JSON.stringify([state.kind, state.material, state.t, span(state), state.depth, state.c, state.theta, state.R, state.straight, state.edges]);
    var job = ++curveJob;
    if (curveCache.key === key) { drawLength(curveCache.hw, curveCache.N); return; }
    var hw = [], N = [], n = 30, i = 0;
    for (var k = 0; k < n; k++) hw.push(0.02 * Math.pow(5 / 0.02, k / (n - 1)));
    drawLength(null, null);
    (function step() {
      if (job !== curveJob) return;
      var stop = Math.min(n, i + 3);
      for (; i < stop; i++) N.push(B.stripBuckle(r.s, r.p, span(state), hw[i], state.edges).N);
      if (i < n) { $('busy').textContent = 'Computing the length curve…'; setTimeout(step, 0); }
      else { $('busy').textContent = ''; curveCache = { key: key, hw: hw, N: N }; drawLength(hw, N); }
    })();
  }
  function interp(hw, N, x) { // log-log interpolation of the signature curve
    if (x < hw[0]) return Infinity; if (x >= hw[hw.length - 1]) return N[N.length - 1] * Math.pow(hw[hw.length - 1] / x, 2);
    var lo = 0, hi = hw.length - 1; while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (hw[mid] <= x) lo = mid; else hi = mid; }
    var f = Math.log(x / hw[lo]) / Math.log(hw[hi] / hw[lo]); return Math.exp(Math.log(N[lo]) + f * (Math.log(N[hi]) - Math.log(N[lo])));
  }
  function drawLength(hw, N) {
    var r = current, Ls = [], across = [], along = [], flatc = [], i, ky = B.END_K[endsFor('y', state.ends)], kx = state.dir === 'x' ? B.END_K[state.ends] : ky;
    for (i = 0; i <= 60; i++) {
      var L = 0.1 * Math.pow(50, i / 60); Ls.push(L);
      across.push([L, PI * PI * r.eq.D11 / Math.pow(kx * L, 2) / 1e3]);
      flatc.push([L, PI * PI * r.s.D11 / Math.pow(kx * L, 2) / 1e3]);
      if (hw) { var best = Infinity; for (var m = 1; m <= 80; m++) best = Math.min(best, interp(hw, N, ky * L / m)); along.push([L, best / 1e3]); }
    }
    var nm = names(), series = [{ pts: flatc, color: 'var(--ink-soft)', dash: '2 4', width: 1.6 }, { pts: across, color: 'var(--cold)' }];
    if (hw) series.push({ pts: along, color: 'var(--hot)' });
    var h = [{ y: B.squashLoad(r.s, r.p, 'y') / 1e3, color: 'var(--hot)' }];
    if (state.kind !== 'flat') h.push({ y: B.squashLoad(r.s, r.p, 'x') / 1e3, color: 'var(--cold)' });
    chart($('chartLen'), { xlog: true, xmin: 0.1, xmax: 5, series: series, hlines: h, vline: state.len, xlabel: 'panel length in the load direction [m]',
      dots: [{ x: state.len, y: r.Ncr / 1e3, color: state.dir === 'x' ? 'var(--cold)' : 'var(--hot)' }],
      aria: 'Critical buckling load against panel length for load ' + nm[0] + ' and ' + nm[1] });
    legend($('legLen'), [[nm[0], 'var(--cold)'], [nm[1] + (hw ? '' : ' (computing)'), 'var(--hot)'], ['flat plate strut', 'var(--ink-soft)', 1], ['yield limits', 'var(--hot)', 1]]);
  }
  function drawSweep() {
    if (!current) return;
    var k = $('sweep').value, d = SLIDERS[k], st = JSON.parse(JSON.stringify(state)), a = [], b = [], fl = [], i, n = 70, ends = endsFor('y', state.ends), ex = state.dir === 'x' ? current.ends : ends;
    for (i = 0; i <= n; i++) {
      var v = d.min + (d.max - d.min) * i / n; st[k] = v;
      var s = makeSheet(st), p = makeProfile(st, false).p, eq = B.equivalentPlate(s, p);
      a.push([v, B.wideStrut(eq.D11, state.len, ex) / 1e3]); b.push([v, B.wideStrut(eq.D22, state.len, ends) / 1e3]); fl.push([v, B.wideStrut(s.D11, state.len, ex) / 1e3]);
    }
    var nm = names();
    chart($('chartSweep'), { xmin: d.min, xmax: d.max, series: [{ pts: fl, color: 'var(--ink-soft)', dash: '2 4', width: 1.6 }, { pts: a, color: 'var(--cold)' }, { pts: b, color: 'var(--hot)' }],
      vline: state[k], xlabel: d.label.toLowerCase() + ' [' + d.unit + ']', aria: 'Critical buckling load against ' + d.label.toLowerCase() });
    legend($('legSweep'), [[nm[0], 'var(--cold)'], [nm[1], 'var(--hot)'], ['flat plate', 'var(--ink-soft)', 1]]);
  }

  /* ---------- Dissertation check table, computed on load ---------- */
  function buildTable() {
    var C = B.CASE, s = B.sheet(C.E, C.nu, C.t, 250e6, 7850), profs = { flat: B.flat(), trapezoidal: B.trapezoidal(C.f, C.c, C.theta), round: B.round(C.R, C.L) };
    var jobs = [], rows = [];
    ['flat', 'trapezoidal', 'round'].forEach(function (kind) { ['x', 'y'].forEach(function (dir) { ['pinned', 'fixed'].forEach(function (ends, e) { jobs.push([kind, dir, ends, e]); }); }); });
    var NOTES = {
      'flat-x': 'Confirmed.', 'flat-y': 'Same plate turned 90°. With truly free side edges it is about 4% softer than the strut formula.',
      'trapezoidal-x': 'Confirmed to 0.4%.', 'trapezoidal-y': 'Theory confirmed by finite strips. The Ansys value is the same for both end conditions and about ten times too low.',
      'round-x': 'Theory confirmed. Ansys is 7% high.', 'round-y': 'Script error in the dissertation formula. The section yields at 4,081 kN/m, long before it buckles.' };
    (function next() {
      if (!jobs.length) { $('checkTable').tBodies[0].innerHTML = rows.join(''); return; }
      var j = jobs.shift(), kind = j[0], dir = j[1], ends = j[2], p = profs[kind], eq = B.equivalentPlate(s, p);
      var corr = B.wideStrut(dir === 'x' ? eq.D11 : eq.D22, C.a, ends), num = dir === 'x' ? B.frameBuckle(s, p, C.a, ends).N : B.stripPanel(s, p, C.b, C.a, ends, 'free').N;
      var rep = B.REPORTED[kind][dir][j[3]], ans = B.ANSYS[kind][dir][j[3]];
      var repBad = Math.abs(rep / corr - 1) > 0.02, ansBad = kind !== 'flat' && dir === 'y';
      rows.push('<tr><td>' + kind[0].toUpperCase() + kind.slice(1) + ', ' + (dir === 'x' ? 'across' : 'along') + ', ' + ends + '</td><td' + (repBad ? ' class="bad"' : '') + '>' + fmt(rep) + '</td><td>' + fmt(corr) + '</td><td class="good">' + fmt(num) + '</td><td' + (ansBad ? ' class="bad"' : '') + '>' + fmt(ans) + '</td><td class="note">' + (ends === 'pinned' ? NOTES[kind + '-' + dir] : '') + '</td></tr>');
      setTimeout(next, 0);
    })();
  }

  buildSliders(); syncControls(); resize(); update();
  requestAnimationFrame(tick);
  setTimeout(buildTable, 400);
  var mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', function () { draw(reduce ? 1 : Math.sin(phase)); });
})();
