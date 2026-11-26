/* Buckling of flat, trapezoidal and round corrugated panels.
   x runs across the corrugations, y along them, z is out of plane.
   All loads are line loads in N per metre of loaded edge. */
(function (root) {
  'use strict';
  var PI = Math.PI;

  /* ---------- Cross-sections: one period of width 2c, developed length 2l ---------- */
  function subdivide(corners, n) {
    var out = [corners[0]];
    for (var i = 0; i < corners.length - 1; i++) {
      var p = corners[i], q = corners[i + 1];
      for (var k = 1; k <= n; k++) out.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]);
    }
    return out;
  }
  function flat(width, n) {
    width = width || 0.1016;
    var c = width / 2;
    return { kind: 'flat', c: c, l: c, I1: 2 * c, I2: 0, depth: 0, points: subdivide([[0, 0], [width, 0]], n || 8) };
  }
  function trapezoidal(f, c, theta, n) {
    var run = 2 * f / Math.tan(theta), fw = Math.max(c - run, 0);
    var l = 2 * f / Math.sin(theta) + fw;
    var I1 = 2 * fw + 4 * f * Math.pow(Math.cos(theta), 2) / Math.sin(theta);
    var I2 = 4 * f * f * f / (3 * Math.sin(theta)) + 2 * f * f * fw;
    var cs = [[0, 0], [run / 2, f]];
    if (fw > 1e-9) cs.push([run / 2 + fw, f]);
    cs.push([run / 2 + fw + run, -f]);
    if (fw > 1e-9) cs.push([run / 2 + 2 * fw + run, -f]);
    cs.push([2 * c, 0]);
    return { kind: 'trapezoidal', c: c, l: l, I1: I1, I2: I2, depth: 2 * f, points: subdivide(cs, n || 4) };
  }
  function round(R, L, nArc, nStr) {
    nArc = nArc || 10; nStr = nStr || 3;
    var pts = [[0, 0]], i, a;
    if (L > 1e-9) for (i = 1; i <= nStr; i++) pts.push([0, L * i / nStr]);
    for (i = 1; i <= nArc; i++) { a = PI * i / nArc; pts.push([R - R * Math.cos(a), L + R * Math.sin(a)]); }
    if (L > 1e-9) for (i = 1; i <= 2 * nStr; i++) pts.push([2 * R, L - L * i / nStr]);
    for (i = 1; i <= nArc; i++) { a = PI * i / nArc; pts.push([3 * R - R * Math.cos(a), -L - R * Math.sin(a)]); }
    if (L > 1e-9) for (i = 1; i <= nStr; i++) pts.push([4 * R, -L + L * i / nStr]);
    return { kind: 'round', c: 2 * R, l: PI * R + 2 * L, I1: PI * R,
      I2: 4 * L * L * L / 3 + 2 * PI * L * L * R + 8 * L * R * R + PI * R * R * R, depth: 2 * (R + L), points: pts };
  }
  function polyline(p, span) { // whole number of periods fitted to the span
    var periods = Math.max(1, Math.round(span / (2 * p.c))), pts = [], k, i;
    for (k = 0; k < periods; k++) for (i = k ? 1 : 0; i < p.points.length; i++) pts.push([p.points[i][0] + 2 * p.c * k, p.points[i][1]]);
    var s = span / pts[pts.length - 1][0];
    for (i = 0; i < pts.length; i++) pts[i][0] *= s;
    return pts;
  }

  /* ---------- Sheet and equivalent orthotropic plate (Xia, Friswell, Saavedra Flores 2012) ---------- */
  function sheet(E, nu, t, fy, rho) {
    var G = E / (2 * (1 + nu)), A11 = E * t / (1 - nu * nu), D11 = E * t * t * t / (12 * (1 - nu * nu));
    return { E: E, nu: nu, t: t, fy: fy, rho: rho, G: G, A11: A11, A12: nu * A11, A66: G * t, D11: D11, D12: nu * D11, D66: G * t * t * t / 12 };
  }
  function equivalentPlate(s, p) {
    var c = p.c, l = p.l;
    var A11 = 2 * c / (p.I1 / s.A11 + p.I2 / s.D11), A12 = s.nu * A11;
    var D11 = c / l * s.D11;
    return { A11: A11, A12: A12, A22: s.nu * A12 + (l / c) * (s.A11 * s.A11 - s.A12 * s.A12) / s.A11, A66: c / l * s.A66,
      D11: D11, D12: s.nu * D11, D22: (p.I2 * s.A11 + p.I1 * s.D11) / (2 * c), D66: l / c * s.D66 };
  }

  /* ---------- Closed-form loads ---------- */
  var END_K = { 'pinned': 1, 'fixed': 0.5, 'pinned-fixed': 0.699156, 'fixed-free': 2 };
  function wideStrut(D, L, ends) { var Le = END_K[ends || 'pinned'] * L; return PI * PI * D / (Le * Le); }
  function squashLoad(s, p, dir) {
    if (dir === 'y') return s.fy * s.t * p.l / p.c;
    return s.fy / (1 / s.t + 6 * (p.depth / 2) / (s.t * s.t));
  }
  function designResistance(Ncr, Ny, alpha) {
    alpha = alpha == null ? 0.49 : alpha;
    var lam = Math.sqrt(Ny / Ncr), phi = 0.5 * (1 + alpha * (lam - 0.2) + lam * lam);
    return Math.min(1, 1 / (phi + Math.sqrt(Math.max(phi * phi - lam * lam, 0)))) * Ny;
  }
  function massPerArea(s, p) { return s.rho * s.t * p.l / p.c; }

  /* ---------- Banded symmetric matrices and the buckling eigenproblem ---------- */
  function Band(n, hb) { this.n = n; this.hb = hb; this.w = hb + 1; this.a = new Float64Array(n * (hb + 1)); }
  Band.prototype.add = function (i, j, v) { if (j > i) { var t = i; i = j; j = t; } this.a[i * this.w + i - j] += v; };
  Band.prototype.get = function (i, j) { if (j > i) { var t = i; i = j; j = t; } return i - j > this.hb ? 0 : this.a[i * this.w + i - j]; };
  Band.prototype.constrain = function (i, diag) {
    var w = this.w, d;
    for (d = 1; d <= this.hb; d++) { if (i - d >= 0) this.a[i * w + d] = 0; if (i + d < this.n) this.a[(i + d) * w + d] = 0; }
    this.a[i * w] = diag;
  };
  Band.prototype.mul = function (x, y) {
    var n = this.n, w = this.w, hb = this.hb, a = this.a, i, d, s;
    for (i = 0; i < n; i++) y[i] = a[i * w] * x[i];
    for (i = 0; i < n; i++) {
      s = 0;
      for (d = 1; d <= hb && i - d >= 0; d++) { var v = a[i * w + d]; s += v * x[i - d]; y[i - d] += v * x[i]; }
      y[i] += s;
    }
  };
  Band.prototype.cholesky = function () { // in place, lower factor
    var n = this.n, w = this.w, hb = this.hb, a = this.a, i, j, k, s;
    for (i = 0; i < n; i++) {
      for (j = Math.max(0, i - hb); j <= i; j++) {
        s = a[i * w + i - j];
        for (k = Math.max(0, i - hb, j - hb); k < j; k++) s -= a[i * w + i - k] * a[j * w + j - k];
        if (i === j) { if (s <= 0) throw new Error('matrix not positive definite'); a[i * w] = Math.sqrt(s); }
        else a[i * w + i - j] = s / a[j * w];
      }
    }
  };
  Band.prototype.solve = function (b) { // with the factor in place; overwrites b
    var n = this.n, w = this.w, hb = this.hb, a = this.a, i, k, s;
    for (i = 0; i < n; i++) { s = b[i]; for (k = Math.max(0, i - hb); k < i; k++) s -= a[i * w + i - k] * b[k]; b[i] = s / a[i * w]; }
    for (i = n - 1; i >= 0; i--) { s = b[i]; for (k = i + 1; k <= Math.min(n - 1, i + hb); k++) s -= a[k * w + k - i] * b[k]; b[i] = s / a[i * w]; }
  };
  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  // Smallest positive lambda of K phi = lambda Kg phi, by inverse iteration with Rayleigh quotients
  function lowestBuckling(K, Kg, fixed) {
    var n = K.n, i, it;
    for (i = 0; i < fixed.length; i++) { K.constrain(fixed[i], 1); Kg.constrain(fixed[i], 0); }
    var F = new Band(n, K.hb); F.a.set(K.a); F.cholesky();
    var x = new Float64Array(n), y = new Float64Array(n), kx = new Float64Array(n), seed = 12345, mu = 0, prev = -1;
    for (i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) % 2147483648; x[i] = seed / 2147483648 - 0.5; }
    for (it = 0; it < 300; it++) {
      Kg.mul(x, y); F.solve(y);                       // y = K^-1 Kg x
      Kg.mul(y, x); K.mul(y, kx);
      mu = dot(y, x) / dot(y, kx);
      var nrm = Math.sqrt(dot(y, y)); for (i = 0; i < n; i++) x[i] = y[i] / nrm;
      if (Math.abs(mu - prev) < 1e-9 * Math.abs(mu)) break;
      prev = mu;
    }
    return { lambda: 1 / mu, vec: x, iterations: it };
  }

  /* ---------- Across the corrugations: plane-strain frame elements ---------- */
  function frameBuckle(s, p, length, ends) {
    ends = ends || 'pinned';
    var xz = polyline(p, length), n = xz.length, K = new Band(3 * n, 5), Kg = new Band(3 * n, 5), e, i, j, r, q;
    for (e = 0; e < n - 1; e++) {
      var dx = xz[e + 1][0] - xz[e][0], dz = xz[e + 1][1] - xz[e][1], L = Math.sqrt(dx * dx + dz * dz), cs = dx / L, sn = dz / L;
      var a = s.A11 / L, b = s.D11 / (L * L * L), N = cs / (30 * L);
      var kl = [[a, 0, 0, -a, 0, 0], [0, 12 * b, 6 * L * b, 0, -12 * b, 6 * L * b], [0, 6 * L * b, 4 * L * L * b, 0, -6 * L * b, 2 * L * L * b],
        [-a, 0, 0, a, 0, 0], [0, -12 * b, -6 * L * b, 0, 12 * b, -6 * L * b], [0, 6 * L * b, 2 * L * L * b, 0, -6 * L * b, 4 * L * L * b]];
      var gl = [[0, 0, 0, 0, 0, 0], [0, 36 * N, 3 * L * N, 0, -36 * N, 3 * L * N], [0, 3 * L * N, 4 * L * L * N, 0, -3 * L * N, -L * L * N],
        [0, 0, 0, 0, 0, 0], [0, -36 * N, -3 * L * N, 0, 36 * N, -3 * L * N], [0, 3 * L * N, -L * L * N, 0, -3 * L * N, 4 * L * L * N]];
      var T = [[cs, sn, 0, 0, 0, 0], [-sn, cs, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0], [0, 0, 0, cs, sn, 0], [0, 0, 0, -sn, cs, 0], [0, 0, 0, 0, 0, 1]];
      for (i = 0; i < 6; i++) for (j = 0; j <= i; j++) {
        var sk = 0, sg = 0;
        for (r = 0; r < 6; r++) for (q = 0; q < 6; q++) { var tt = T[r][i] * T[q][j]; if (tt) { sk += tt * kl[r][q]; sg += tt * gl[r][q]; } }
        K.add(3 * e + i, 3 * e + j, sk); Kg.add(3 * e + i, 3 * e + j, sg);
      }
    }
    var last = 3 * (n - 1);
    var fixed = { 'pinned': [0, 1, last + 1], 'fixed': [0, 1, 2, last + 1, last + 2], 'pinned-fixed': [0, 1, last + 1, last + 2], 'fixed-free': [0, 1, 2] }[ends];
    var res = lowestBuckling(K, Kg, fixed), mode = [], mx = 0;
    for (i = 0; i < n; i++) { mode.push([res.vec[3 * i], 0, res.vec[3 * i + 1]]); mx = Math.max(mx, Math.abs(res.vec[3 * i]), Math.abs(res.vec[3 * i + 1])); }
    var sign = 1, big = 0; for (i = 0; i < n; i++) if (Math.abs(mode[i][2]) > Math.abs(big)) big = mode[i][2]; if (big < 0) sign = -1;
    for (i = 0; i < n; i++) { mode[i][0] *= sign / mx; mode[i][2] *= sign / mx; }
    return { N: res.lambda, nodes: xz, mode: mode, dof: 3 * n, elements: n - 1 };
  }

  /* ---------- Along the corrugations: semi-analytical finite strips ---------- */
  var GP = [-0.8611363116, -0.3399810436, 0.3399810436, 0.8611363116], GW = [0.3478548451, 0.6521451549, 0.6521451549, 0.3478548451];
  function stripMatrices(s, b, k, hw) { // local DOF [u1 v1 w1 th1 u2 v2 w2 th2], unit compressive stress
    var E1 = s.E / (1 - s.nu * s.nu), t = s.t, nu = s.nu, D = s.D11, Ke = [], Kg = [], i, j, g;
    for (i = 0; i < 8; i++) { Ke.push([0, 0, 0, 0, 0, 0, 0, 0]); Kg.push([0, 0, 0, 0, 0, 0, 0, 0]); }
    for (g = 0; g < 4; g++) {
      var x = (GP[g] + 1) / 2, wt = GW[g] * b / 2 * hw / 2;
      var N = [1 - x, x], dN = [-1 / b, 1 / b];
      var H = [1 - 3 * x * x + 2 * x * x * x, b * (x - 2 * x * x + x * x * x), 3 * x * x - 2 * x * x * x, b * (x * x * x - x * x)];
      var dH = [(-6 * x + 6 * x * x) / b, 1 - 4 * x + 3 * x * x, (6 * x - 6 * x * x) / b, 3 * x * x - 2 * x];
      var ddH = [(-6 + 12 * x) / (b * b), (-4 + 6 * x) / b, (6 - 12 * x) / (b * b), (6 * x - 2) / b];
      // rows: eps_x, eps_y, gamma_xy, kappa_x, kappa_y, kappa_xy, then the three displacement interpolations
      var B = [[dN[0], 0, 0, 0, dN[1], 0, 0, 0], [0, -k * N[0], 0, 0, 0, -k * N[1], 0, 0], [k * N[0], dN[0], 0, 0, k * N[1], dN[1], 0, 0],
        [0, 0, -ddH[0], -ddH[1], 0, 0, -ddH[2], -ddH[3]], [0, 0, k * k * H[0], k * k * H[1], 0, 0, k * k * H[2], k * k * H[3]],
        [0, 0, 2 * k * dH[0], 2 * k * dH[1], 0, 0, 2 * k * dH[2], 2 * k * dH[3]]];
      var G = [[N[0], 0, 0, 0, N[1], 0, 0, 0], [0, N[0], 0, 0, 0, N[1], 0, 0], [0, 0, H[0], H[1], 0, 0, H[2], H[3]]];
      for (i = 0; i < 8; i++) for (j = 0; j < 8; j++) {
        Ke[i][j] += wt * (t * (E1 * (B[0][i] * B[0][j] + B[1][i] * B[1][j]) + nu * E1 * (B[0][i] * B[1][j] + B[1][i] * B[0][j]) + s.G * B[2][i] * B[2][j])
          + D * (B[3][i] * B[3][j] + B[4][i] * B[4][j] + nu * (B[3][i] * B[4][j] + B[4][i] * B[3][j]) + (1 - nu) / 2 * B[5][i] * B[5][j]));
        Kg[i][j] += wt * t * k * k * (G[0][i] * G[0][j] + G[1][i] * G[1][j] + G[2][i] * G[2][j]);
      }
    }
    return [Ke, Kg];
  }
  function stripBuckle(s, p, width, halfWave, edges) {
    var xz = polyline(p, width), n = xz.length, K = new Band(4 * n, 7), Kg = new Band(4 * n, 7), k = PI / halfWave, e, i, j, r, q, cache = {};
    for (e = 0; e < n - 1; e++) {
      var dx = xz[e + 1][0] - xz[e][0], dz = xz[e + 1][1] - xz[e][1], b = Math.sqrt(dx * dx + dz * dz), cs = dx / b, sn = dz / b;
      var key = b.toFixed(10), m = cache[key] || (cache[key] = stripMatrices(s, b, k, halfWave)), R = [];
      for (i = 0; i < 8; i++) { R.push([0, 0, 0, 0, 0, 0, 0, 0]); R[i][i] = 1; }
      for (i = 0; i < 8; i += 4) { R[i][i] = cs; R[i][i + 2] = sn; R[i + 2][i] = -sn; R[i + 2][i + 2] = cs; }
      for (i = 0; i < 8; i++) for (j = 0; j <= i; j++) {
        var sk = 0, sg = 0;
        for (r = 0; r < 8; r++) { var ri = R[r][i]; if (!ri) continue; for (q = 0; q < 8; q++) { var rq = R[q][j]; if (rq) { sk += ri * rq * m[0][r][q]; sg += ri * rq * m[1][r][q]; } } }
        K.add(4 * e + i, 4 * e + j, sk); Kg.add(4 * e + i, 4 * e + j, sg);
      }
    }
    var res = lowestBuckling(K, Kg, edges === 'free' ? [] : [2, 4 * (n - 1) + 2]), mode = [], mx = 0;
    for (i = 0; i < n; i++) { mode.push([res.vec[4 * i], res.vec[4 * i + 1], res.vec[4 * i + 2]]); mx = Math.max(mx, Math.abs(res.vec[4 * i]), Math.abs(res.vec[4 * i + 2])); }
    var sign = 1, big = 0; for (i = 0; i < n; i++) if (Math.abs(mode[i][2]) > Math.abs(big)) big = mode[i][2]; if (big < 0) sign = -1;
    for (i = 0; i < n; i++) for (j = 0; j < 3; j++) mode[i][j] *= sign / mx;
    return { N: res.lambda * s.t * p.l / p.c, nodes: xz, mode: mode, dof: 4 * n, elements: n - 1 };
  }
  function stripPanel(s, p, width, length, ends, edges) { // lowest load over the admissible half-waves
    var eff = length * END_K[ends || 'pinned'], best = null, m;
    for (m = 1; m <= 40; m++) {
      var r = stripBuckle(s, p, width, eff / m, edges);
      if (!best || r.N < best.N) { best = r; best.m = m; best.halfWave = eff / m; }
      else if (m > best.m + 5) break;
    }
    return best;
  }

  /* ---------- The 2023 dissertation case ---------- */
  var CASE = { E: 2.1e11, nu: 0.3, t: 0.00635, a: 1.016, b: 1.016, f: 0.0127, c: 0.0508, theta: PI / 4, R: 0.0254, L: 0.0254 };
  var ANSYS = { flat: { x: [47075, 188250], y: [47075, 188250] }, trapezoidal: { x: [38843, 155760], y: [154670, 154670] }, round: { x: [19642, 78398], y: [567070, 567070] } };
  var REPORTED = { flat: { x: [47079.3, 188317.3], y: [47079.3, 188317.3] }, trapezoidal: { x: [39001.8, 156007.1], y: [1702730, 6810920] }, round: { x: [18313.1, 73252.5], y: [105188.4, 420753.6] } };

  var api = { flat: flat, trapezoidal: trapezoidal, round: round, polyline: polyline, sheet: sheet, equivalentPlate: equivalentPlate,
    wideStrut: wideStrut, squashLoad: squashLoad, designResistance: designResistance, massPerArea: massPerArea, END_K: END_K,
    frameBuckle: frameBuckle, stripBuckle: stripBuckle, stripPanel: stripPanel, CASE: CASE, ANSYS: ANSYS, REPORTED: REPORTED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Buckling = api;
})(this);
