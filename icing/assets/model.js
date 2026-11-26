/* Rime ice accretion on an airfoil: panel-method flow, droplet trajectories,
   ice growth and an integral boundary layer. Lengths are in chords and
   velocities in units of the free stream, which runs along +x. */
(function (root) {
  'use strict';
  var PI = Math.PI;

  /* ---------- Geometry ---------- */
  function naca4(code, n, alpha) {
    var m = +code[0] / 100, p = +code[1] / 10, t = +code.slice(2) / 100, pts = [], ca = Math.cos(alpha || 0), sa = Math.sin(alpha || 0);
    for (var i = 0; i <= n; i++) {
      var x = 0.5 * (1 + Math.cos(2 * PI * i / n)), lower = i < n / 2;
      var yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x), yc = 0, dy = 0;
      if (m > 0) { yc = x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) * (1 - p)) * (1 - 2 * p + 2 * p * x - x * x); dy = x < p ? 2 * m / (p * p) * (p - x) : 2 * m / ((1 - p) * (1 - p)) * (p - x); }
      var th = Math.atan(dy), px = lower ? x + yt * Math.sin(th) : x - yt * Math.sin(th), py = lower ? yc - yt * Math.cos(th) : yc + yt * Math.cos(th);
      pts.push([px * ca + py * sa, -px * sa + py * ca]);
    }
    pts[n] = [pts[0][0], pts[0][1]];
    return pts;
  }
  function polygonArea(nodes) { var a = 0; for (var i = 0; i < nodes.length - 1; i++) a += nodes[i][0] * nodes[i + 1][1] - nodes[i + 1][0] * nodes[i][1]; return Math.abs(a) / 2; }

  /* ---------- Hess-Smith panel method ---------- */
  function PanelFlow(nodes) {
    var N = nodes.length - 1, i, j, k;
    this.nodes = nodes; this.N = N;
    var X = this.X = new Float64Array(N + 1), Y = this.Y = new Float64Array(N + 1), L = this.L = new Float64Array(N), C = this.C = new Float64Array(N), S = this.S = new Float64Array(N);
    var mx = this.mx = new Float64Array(N), my = this.my = new Float64Array(N), sn = this.sNodes = new Float64Array(N + 1), sm = this.sMid = new Float64Array(N);
    for (i = 0; i <= N; i++) { X[i] = nodes[i][0]; Y[i] = nodes[i][1]; }
    for (i = 0; i < N; i++) {
      var dx = X[i + 1] - X[i], dy = Y[i + 1] - Y[i]; L[i] = Math.sqrt(dx * dx + dy * dy); C[i] = dx / L[i]; S[i] = dy / L[i];
      mx[i] = (X[i] + X[i + 1]) / 2; my[i] = (Y[i] + Y[i + 1]) / 2; sn[i + 1] = sn[i] + L[i]; sm[i] = sn[i] + L[i] / 2;
    }
    var n = N + 1, A = [], An = [], At = [], o = [0, 0];
    for (i = 0; i < n; i++) A.push(new Float64Array(n + 1));
    for (i = 0; i < N; i++) {
      An.push(new Float64Array(N)); At.push(new Float64Array(N));
      for (j = 0; j < N; j++) {
        if (i === j) { o[0] = -0.5 * S[i]; o[1] = 0.5 * C[i]; } else this.source(j, mx[i], my[i], o);
        An[i][j] = -o[0] * S[i] + o[1] * C[i]; At[i][j] = o[0] * C[i] + o[1] * S[i];
        A[i][j] = An[i][j]; A[i][N] += At[i][j];
      }
      A[i][n] = S[i];
    }
    [0, N - 1].forEach(function (r) { var san = 0; for (j = 0; j < N; j++) { A[N][j] += At[r][j]; san += An[r][j]; } A[N][N] -= san; A[N][n] -= C[r]; });
    for (i = 0; i < n; i++) {
      var p = i; for (k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
      var tmp = A[i]; A[i] = A[p]; A[p] = tmp;
      for (k = i + 1; k < n; k++) { var f = A[k][i] / A[i][i]; if (f) for (j = i; j <= n; j++) A[k][j] -= f * A[i][j]; }
    }
    var sol = new Float64Array(n);
    for (i = n - 1; i >= 0; i--) { var s = A[i][n]; for (j = i + 1; j < n; j++) s -= A[i][j] * sol[j]; sol[i] = s / A[i][i]; }
    this.q = sol.subarray(0, N); this.gamma = sol[N];
    var vt = this.vt = new Float64Array(N), per = 0;
    for (i = 0; i < N; i++) { var a = C[i], san2 = 0; for (j = 0; j < N; j++) { a += At[i][j] * sol[j]; san2 += An[i][j]; } vt[i] = a - this.gamma * san2; per += L[i]; }
    this.cl = -2 * this.gamma * per;
    var ymin = Infinity, ymax = -Infinity, xmax = -Infinity, xmin = Infinity;
    for (i = 0; i <= N; i++) { ymin = Math.min(ymin, Y[i]); ymax = Math.max(ymax, Y[i]); xmax = Math.max(xmax, X[i]); xmin = Math.min(xmin, X[i]); }
    this.ymin = ymin; this.ymax = ymax; this.xmax = xmax; this.xmin = xmin;
  }
  PanelFlow.prototype.source = function (j, x, y, out) {
    var dx = x - this.X[j], dy = y - this.Y[j], c = this.C[j], s = this.S[j], L = this.L[j];
    var xl = dx * c + dy * s, yl = -dx * s + dy * c;
    var ul = Math.log((xl * xl + yl * yl) / ((xl - L) * (xl - L) + yl * yl)) / (4 * PI);
    var vl = Math.atan2(yl * L, xl * (xl - L) + yl * yl) / (2 * PI);
    out[0] = ul * c - vl * s; out[1] = ul * s + vl * c;
  };
  PanelFlow.prototype.velocity = function (x, y, out) {
    var u = 1, v = 0, X = this.X, Y = this.Y, C = this.C, S = this.S, L = this.L, q = this.q, g = this.gamma, N = this.N;
    for (var j = 0; j < N; j++) {
      var dx = x - X[j], dy = y - Y[j], c = C[j], s = S[j], l = L[j], xl = dx * c + dy * s, yl = -dx * s + dy * c, r2 = xl * xl + yl * yl;
      var ul = Math.log(r2 / ((xl - l) * (xl - l) + yl * yl)) * 0.07957747154594767, vl = Math.atan2(yl * l, r2 - xl * l) * 0.15915494309189535;
      var us = ul * c - vl * s, vs = ul * s + vl * c;
      u += q[j] * us - g * vs; v += q[j] * vs + g * us;
    }
    out[0] = u; out[1] = v;
  };
  PanelFlow.prototype.inside = function (x, y) {
    if (x < this.xmin || x > this.xmax || y < this.ymin || y > this.ymax) return false;
    var X = this.X, Y = this.Y, c = false;
    for (var i = 0, N = this.N; i < N; i++) if ((Y[i] > y) !== (Y[i + 1] > y) && x < (X[i + 1] - X[i]) * (y - Y[i]) / (Y[i + 1] - Y[i]) + X[i]) c = !c;
    return c;
  };
  PanelFlow.prototype.distance = function (x, y) { var d = Infinity, mx = this.mx, my = this.my; for (var i = 0; i < this.N; i++) { var a = x - mx[i], b = y - my[i], r = a * a + b * b; if (r < d) d = r; } return Math.sqrt(d); };

  /* ---------- Cloud ---------- */
  function cloud(o) {
    var c = { speed: o.speed, chord: o.chord, mvd: o.mvd, lwc: o.lwc, temperature: o.temperature, pressure: o.pressure || 101325 };
    c.rho = c.pressure / (287.05 * c.temperature);
    c.mu = 1.716e-5 * Math.pow(c.temperature / 273.15, 1.5) * (273.15 + 110.4) / (c.temperature + 110.4);
    c.K = 1000 * c.mvd * c.mvd * c.speed / (18 * c.mu * c.chord);
    c.Red = c.rho * c.speed * c.mvd / c.mu;
    c.Re = c.rho * c.speed * c.chord / c.mu;
    return c;
  }

  /* ---------- Droplet trajectories ---------- */
  var va = [0, 0];
  function accel(flow, cl, x, y, u, v, out) {
    flow.velocity(x, y, va);
    var ru = va[0] - u, rv = va[1] - v, f = (1 + 0.15 * Math.pow(cl.Red * Math.sqrt(ru * ru + rv * rv), 0.687)) / cl.K;
    out[0] = f * ru; out[1] = f * rv;
  }
  function impact(flow, ax, ay, bx, by) {
    var X = flow.X, Y = flow.Y, dx = bx - ax, dy = by - ay, best = 2, bk = -1, bt = 0;
    for (var k = 0; k < flow.N; k++) {
      var rx = X[k + 1] - X[k], ry = Y[k + 1] - Y[k], den = rx * dy - ry * dx; if (!den) continue;
      var t = ((ax - X[k]) * dy - (ay - Y[k]) * dx) / den, w = ((ax - X[k]) * ry - (ay - Y[k]) * rx) / den;
      if (t >= 0 && t <= 1 && w >= 0 && w <= 1 && w < best) { best = w; bk = k; bt = t; }
    }
    if (bk < 0) { var d = Infinity; for (k = 0; k < flow.N; k++) { var r = (flow.mx[k] - bx) * (flow.mx[k] - bx) + (flow.my[k] - by) * (flow.my[k] - by); if (r < d) { d = r; bk = k; } } bt = 0.5; }
    return { s: flow.sNodes[bk] + bt * flow.L[bk], x: X[bk] + bt * (X[bk + 1] - X[bk]), y: Y[bk] + bt * (Y[bk + 1] - Y[bk]) };
  }
  function track(flow, cl, y0, keep) { // one droplet released at (-4, y0)
    var x = -4, y = y0, k1 = [0, 0], k2 = [0, 0], k3 = [0, 0], k4 = [0, 0], path = keep ? [x, y] : null;
    flow.velocity(x, y, va); var u = va[0], v = va[1];
    for (var it = 0; it < 4000; it++) {
      var dt = Math.min(0.08, Math.max(0.0015, 0.12 * flow.distance(x, y))), h = dt / 2;
      accel(flow, cl, x, y, u, v, k1);
      var u2 = u + h * k1[0], v2 = v + h * k1[1]; accel(flow, cl, x + h * u, y + h * v, u2, v2, k2);
      var u3 = u + h * k2[0], v3 = v + h * k2[1]; accel(flow, cl, x + h * u2, y + h * v2, u3, v3, k3);
      var u4 = u + dt * k3[0], v4 = v + dt * k3[1]; accel(flow, cl, x + dt * u3, y + dt * v3, u4, v4, k4);
      var xn = x + dt / 6 * (u + 2 * u2 + 2 * u3 + u4), yn = y + dt / 6 * (v + 2 * v2 + 2 * v3 + v4);
      u += dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]); v += dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      if (flow.inside(xn, yn)) { var hit = impact(flow, x, y, xn, yn); if (keep) path.push(hit.x, hit.y); return { s: hit.s, path: path }; }
      x = xn; y = yn; if (keep) path.push(x, y);
      if (x > flow.xmax) break;
    }
    return { s: NaN, path: path };
  }
  function collection(flow, cl, n, keep) {
    n = n || 60;
    var height = flow.ymax - flow.ymin, i, lo0 = flow.ymin - 0.25 - 0.45 * flow.cl, hi0 = flow.ymax + 0.15, nc = 40, first = -1, last = -1, paths = [];
    var empty = { s: [0, 1], beta: [0, 0], limits: [0, 0], total: 0, height: height, paths: paths, betaMax: 0 };
    for (i = 0; i < nc; i++) { var yy = lo0 + (hi0 - lo0) * i / (nc - 1), r = track(flow, cl, yy, keep && i % 2 === 0); if (!isNaN(r.s)) { if (first < 0) first = i; last = i; } else if (r.path) paths.push({ hit: false, p: r.path }); }
    if (first < 0) return empty;
    var lo = lo0 + (hi0 - lo0) * Math.max(first - 1, 0) / (nc - 1), hi = lo0 + (hi0 - lo0) * Math.min(last + 1, nc - 1) / (nc - 1), hits = [];
    for (i = 0; i < n; i++) { var y0 = lo + (hi - lo) * i / (n - 1), t = track(flow, cl, y0, keep && i % 3 === 0); if (!isNaN(t.s)) { hits.push([t.s, y0]); if (t.path) paths.push({ hit: true, p: t.path }); } else if (t.path) paths.push({ hit: false, p: t.path }); }
    if (hits.length < 3) return empty;
    hits.sort(function (a, b) { return a[0] - b[0]; });
    var sh = [hits[0][0]], yh = [hits[0][1]];
    for (i = 1; i < hits.length; i++) if (hits[i][0] - sh[sh.length - 1] > 1e-7) { sh.push(hits[i][0]); yh.push(hits[i][1]); }
    var m = sh.length, beta = [], sm = [], ylo = Infinity, yhi = -Infinity;
    for (i = 0; i < m; i++) { // same second-order differences as numpy.gradient
      var b;
      if (i === 0) b = (yh[1] - yh[0]) / (sh[1] - sh[0]); else if (i === m - 1) b = (yh[m - 1] - yh[m - 2]) / (sh[m - 1] - sh[m - 2]);
      else { var hd = sh[i + 1] - sh[i], hs = sh[i] - sh[i - 1]; b = (hs * hs * yh[i + 1] + (hd * hd - hs * hs) * yh[i] - hd * hd * yh[i - 1]) / (hs * hd * (hd + hs)); }
      beta.push(Math.abs(b)); ylo = Math.min(ylo, yh[i]); yhi = Math.max(yhi, yh[i]);
    }
    for (i = 0; i < m; i++) { var a = 0; for (var k = -2; k <= 2; k++) a += beta[Math.min(m - 1, Math.max(0, i + k))]; sm.push(a / 5); }
    var dy = (hi - lo) / (n - 1), bmax = 0; for (i = 0; i < m; i++) bmax = Math.max(bmax, sm[i]);
    var s = [sh[0] - dy / Math.max(sm[0], 0.05)].concat(sh, [sh[m - 1] + dy / Math.max(sm[m - 1], 0.05)]);
    return { s: s, beta: [0].concat(sm, [0]), limits: [s[0], s[s.length - 1]], total: (yhi - ylo + dy) / height, height: height, paths: paths, betaMax: bmax };
  }
  function interp(xs, ys, x) {
    if (x <= xs[0] || x >= xs[xs.length - 1]) return 0;
    var lo = 0, hi = xs.length - 1; while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / (xs[hi] - xs[lo]);
  }

  /* ---------- Rime growth, one layer at a time ---------- */
  var RIME_DENSITY = 917;
  function arcFractions(nodes) { var s = [0], i; for (i = 1; i < nodes.length; i++) s.push(s[i - 1] + Math.hypot(nodes[i][0] - nodes[i - 1][0], nodes[i][1] - nodes[i - 1][1])); return s.map(function (v) { return v / s[s.length - 1]; }); }
  function resample(nodes, fr) {
    var s = [0], i, out = [], k = 0; for (i = 1; i < nodes.length; i++) s.push(s[i - 1] + Math.hypot(nodes[i][0] - nodes[i - 1][0], nodes[i][1] - nodes[i - 1][1]));
    for (i = 0; i < fr.length; i++) { var t = fr[i] * s[s.length - 1]; while (k < s.length - 2 && s[k + 1] < t) k++; var f = (t - s[k]) / (s[k + 1] - s[k] || 1); out.push([nodes[k][0] + f * (nodes[k + 1][0] - nodes[k][0]), nodes[k][1] + f * (nodes[k + 1][1] - nodes[k][1])]); }
    out[0] = nodes[0].slice(); out[out.length - 1] = nodes[nodes.length - 1].slice();
    return out;
  }
  function growLayer(body, flow, col, cl, dt, fr) { // returns the body after dt seconds of rime growth
    var n = body.length, i, h0 = [], p, nx = [], ny = [], kap = [], h = [];
    for (i = 0; i < n; i++) h0.push(interp(col.s, col.beta, flow.sNodes[i]) * cl.lwc * cl.speed * dt / RIME_DENSITY / cl.chord);
    for (p = 0; p < 4; p++) { var prev = h0.slice(); for (i = 1; i < n - 1; i++) h0[i] = 0.25 * prev[i - 1] + 0.5 * prev[i] + 0.25 * prev[i + 1]; }
    var N = n - 1, C = flow.C, S = flow.S, L = flow.L;
    for (i = 0; i < n; i++) {
      var a = i === 0 || i === N ? N - 1 : i - 1, b = i === 0 || i === N ? 0 : i, vx = -S[a] - S[b], vy = C[a] + C[b], len = Math.hypot(vx, vy);
      nx.push(vx / len); ny.push(vy / len);
      kap.push(i > 0 && i < N ? Math.max(0, -(C[i - 1] * S[i] - S[i - 1] * C[i]) / (0.5 * (L[i - 1] + L[i]))) : 0);
      h.push(kap[i] > 1e-9 ? (Math.sqrt(1 + 2 * kap[i] * h0[i]) - 1) / kap[i] : h0[i]);
    }
    var target = col.total * col.height * cl.lwc * cl.speed * dt / RIME_DENSITY / cl.chord, base = polygonArea(body), scale = 1;
    function grow(k) {
      var mv = [], out = []; for (i = 0; i < n; i++) mv.push([body[i][0] + k * h[i] * nx[i], body[i][1] + k * h[i] * ny[i]]);
      for (i = 0; i < n; i++) out.push(h[i] > 0 && i > 0 && i < N ? [0.25 * mv[i - 1][0] + 0.5 * mv[i][0] + 0.25 * mv[i + 1][0], 0.25 * mv[i - 1][1] + 0.5 * mv[i][1] + 0.25 * mv[i + 1][1]] : mv[i]);
      return resample(out, fr);
    }
    for (p = 0; p < 4; p++) { var added = polygonArea(grow(scale)) - base; if (added <= 0 || target <= 0) break; scale *= target / added; }
    return grow(scale);
  }
  function maxThickness(body, clean) {
    var mx = 0; for (var i = 0; i < body.length; i++) { var d = Infinity; for (var j = 0; j < clean.length; j++) { var r = Math.hypot(body[i][0] - clean[j][0], body[i][1] - clean[j][1]); if (r < d) d = r; } if (d > mx) mx = d; }
    return mx;
  }

  /* ---------- Integral boundary layer: Thwaites, Michel, Head, Squire-Young ---------- */
  function H1of(H) { return H <= 1.6 ? 3.3 + 0.8234 * Math.pow(H - 1.1, -1.287) : 3.3 + 1.5501 * Math.pow(H - 0.6778, -3.064); }
  function Hof(H1) { if (H1 <= 3.32) return 3; return H1 >= 5.3 ? 1.1 + Math.pow(0.8234 / (H1 - 3.3), 1 / 1.287) : 0.6778 + Math.pow(1.5501 / (H1 - 3.3), 1 / 3.064); }
  function march(s, x, ue, Re, sTrip) {
    var n = s.length, th = new Float64Array(n), H = new Float64Array(n), due = new Float64Array(n), i, integral = 0, turb = false, forced = false, xtr = x[n - 1], xsep = null, H1 = 0;
    for (i = 0; i < n; i++) {
      if (i === 0) due[i] = (ue[1] - ue[0]) / (s[1] - s[0]); else if (i === n - 1) due[i] = (ue[i] - ue[i - 1]) / (s[i] - s[i - 1]);
      else { var hd = s[i + 1] - s[i], hs = s[i] - s[i - 1]; due[i] = (hs * hs * ue[i + 1] + (hd * hd - hs * hs) * ue[i] - hd * hd * ue[i - 1]) / (hs * hd * (hd + hs)); }
    }
    function rhs(t, h1, u, du) {
      var h = Hof(h1), c = 0.246 * Math.pow(10, -0.678 * h) * Math.pow(Re * u * t, -0.268), dth = c / 2 - (h + 2) * t / u * du;
      return [dth, h1 > 3 ? (0.0306 * Math.pow(h1 - 3, -0.6169) - h1 * dth - h1 * t / u * du) / t : 0];
    }
    for (i = 0; i < n; i++) {
      if (!turb) {
        if (i === 0) th[i] = Math.sqrt(0.075 / (Re * Math.max(due[i], 1e-6)));
        else { integral += 0.5 * (Math.pow(ue[i], 5) + Math.pow(ue[i - 1], 5)) * (s[i] - s[i - 1]); th[i] = Math.sqrt(0.45 * integral / (Re * Math.pow(Math.max(ue[i], 1e-6), 6))); }
        var lam = Math.max(-0.1, Math.min(0.1, th[i] * th[i] * Re * due[i]));
        H[i] = lam >= 0 ? 2.61 - 3.75 * lam + 5.24 * lam * lam : 2.088 + 0.0731 / (lam + 0.14);
        var rex = Re * ue[i] * s[i], ret = Re * ue[i] * th[i], michel = rex > 1e3 && ret > 1.174 * (1 + 22400 / rex) * Math.pow(rex, 0.46), trip = sTrip != null && s[i] >= sTrip;
        if (lam <= -0.09 || michel || trip) { turb = true; forced = trip && !(lam <= -0.09 || michel); xtr = x[i]; H[i] = 1.4; H1 = H1of(1.4); }
        continue;
      }
      var ds = s[i] - s[i - 1], a = rhs(th[i - 1], H1, ue[i - 1], due[i - 1]), tp = Math.max(th[i - 1] + ds * a[0], 1e-9), hp = Math.max(H1 + ds * a[1], 3.05), b = rhs(tp, hp, ue[i], due[i]);
      th[i] = Math.max(th[i - 1] + ds * 0.5 * (a[0] + b[0]), 1e-9); H1 = Math.max(H1 + ds * 0.5 * (a[1] + b[1]), 3.05); H[i] = Hof(H1);
      if (H[i] > 2.4 && xsep === null) xsep = x[i];
    }
    return { theta: th[n - 1], H: H[n - 1], ue: ue[n - 1], xTransition: xtr, forced: forced, xSeparation: xsep };
  }
  function boundaryLayer(flow, Re, trip) {
    var N = flow.N, vt = new Float64Array(N), i, k = -1, best = Infinity;
    vt[0] = flow.vt[0]; vt[N - 1] = flow.vt[N - 1];
    for (i = 1; i < N - 1; i++) vt[i] = 0.25 * flow.vt[i - 1] + 0.5 * flow.vt[i] + 0.25 * flow.vt[i + 1];
    for (i = 0; i < N - 1; i++) if (vt[i] < 0 && vt[i + 1] >= 0 && Math.abs(i - N / 2) < best) { best = Math.abs(i - N / 2); k = i; }
    if (k < 0) return null;
    var s0 = flow.sMid[k] - vt[k] * (flow.sMid[k + 1] - flow.sMid[k]) / (vt[k + 1] - vt[k]), cut = 3, chord = flow.xmax - flow.xmin;
    function side(from, to, step, sign, st) {
      var s = [], x = [], ue = [];
      for (var j = from; j !== to; j += step) { s.push(Math.abs(flow.sMid[j] - s0)); x.push((flow.mx[j] - flow.xmin) / chord); ue.push(Math.max(sign * vt[j], 1e-4)); }
      return march(s, x, ue, Re, st == null ? null : Math.abs(st - s0));
    }
    var up = side(k + 1, N - cut, 1, 1, trip ? trip[1] : null), lo = side(k, cut - 1, -1, -1, trip ? trip[0] : null);
    return { cd: 2 * up.theta * Math.pow(up.ue, (up.H + 5) / 2) + 2 * lo.theta * Math.pow(lo.ue, (lo.H + 5) / 2), upper: up, lower: lo, sStag: s0 };
  }

  /* ---------- Checks on the report data ---------- */
  function gridConvergence(c, m, f, r) {
    var e32 = c - m, e21 = m - f, ratio = e21 / e32;
    if (!(ratio > 0 && ratio < 1)) return { ratio: ratio, order: NaN, extrapolated: NaN, gci: NaN };
    var p = Math.log(1 / ratio) / Math.log(r);
    return { ratio: ratio, order: p, extrapolated: f + (f - m) / (Math.pow(r, p) - 1), gci: 1.25 * Math.abs((f - m) / f) / (Math.pow(r, p) - 1) };
  }
  var REPORT = { chord: 0.09, span: 0.25, speed: 20, section: 0.305 * 0.305, fensapMass: 0.01024,
    cfdCleanCl: [0.16509, 0.26441, 0.36273, 0.45913, 0.55127, 0.63949, 0.72179, 0.79613, 0.85597],
    cfdCleanCd: [0.0214, 0.021664, 0.022263, 0.023252, 0.024602, 0.026513, 0.029024, 0.032373, 0.037139],
    cfdIcedCl: [0.15077, 0.23394, 0.3175, 0.40108, 0.47954, 0.54645, 0.60781, 0.65241, 0.44777],
    cfdIcedCd: [0.034029, 0.036219, 0.036033, 0.042627, 0.037259, 0.042137, 0.046239, 0.053703, 0.088099],
    expCleanCl: [0.16326, 0.23596, 0.30951, 0.36589, 0.4313, 0.50022, 0.58332, 0.66229, 0.7314],
    expCleanCd: [0.013865, 0.018875, 0.024983, 0.024674, 0.02984, 0.035778, 0.039552, 0.045402, 0.054882],
    expIcedAlpha: [0, 4, 8], expIcedCl: [0.10599, 0.4143, 0.71267], expIcedCd: [0.015442, 0.038398, 0.073688],
    meshCl: [0.155, 0.165, 0.170], meshCd: [0.023, 0.021, 0.021] };

  var api = { naca4: naca4, polygonArea: polygonArea, PanelFlow: PanelFlow, cloud: cloud, track: track, collection: collection, interp: interp,
    arcFractions: arcFractions, growLayer: growLayer, maxThickness: maxThickness, boundaryLayer: boundaryLayer, gridConvergence: gridConvergence,
    RIME_DENSITY: RIME_DENSITY, REPORT: REPORT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Icing = api;
})(this);
