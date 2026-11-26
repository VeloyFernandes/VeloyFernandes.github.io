/* Green Methanol Power-to-X — UI wiring and charts (uses Model, SITE_DATA, DK_MAP, echarts) */
(function () {
  'use strict';
  var D = window.SITE_DATA, M = window.Model;
  var $ = function (id) { return document.getElementById(id); };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON = MONTHS.map(function (m) { return m.slice(0, 3); });
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var HOUR = 3600000, DAY = 86400000;

  // ------------------------------------------------------------------ state
  var wall = M.wallClock(D.meta);
  var starts = { hour: null, day: M.groupStarts(wall, 'day'), week: M.groupStarts(wall, 'week'), month: M.groupStarts(wall, 'month') };
  var state = {
    scenario: Object.assign({}, M.DEFAULTS, {
      solarDcMw: D.solar.targetDcMw, turbines: D.wind.numTurbines,
      electrolyzerMw: D.plant.electrolyzerMw, methanolMw: D.plant.methanolMw, uptime: D.plant.uptime
    }),
    lcom: Object.assign({}, M.LCOM_DEFAULTS),
    balanceRes: 'day', windRes: 'day', geoMode: 'solar'
  };
  var BASE_SCENARIO = Object.assign({}, state.scenario);
  var SC = M.runScenario(D, state.scenario);
  var BASELINE = SC;
  var ECON = null;

  // ------------------------------------------------------------------ formatting
  var nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function n0(v) { return nf0.format(Math.round(v) === 0 ? 0 : v); }
  function n1(v) { return nf1.format(v); }
  function unit(v, u) { return v + '<small>' + u + '</small>'; }
  function gwh(mwh) { return unit(n1(mwh / 1000), 'GWh'); }
  function tonnes(t) { return t >= 10000 ? unit(n1(t / 1000), 'kt') : unit(n0(t), 't'); }
  function pct(x, d) { return (x * 100).toFixed(d == null ? 0 : d) + '%'; }
  function signed(v, f) { return (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v)); }
  function setHtml(id, html) { var el = $(id); if (el) el.innerHTML = html; }
  function setText(id, t) { var el = $(id); if (el) el.textContent = t; }

  function dParts(t) { var d = new Date(t); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), w: d.getUTCDay() }; }
  function label(t, lvl) {
    var p = dParts(t);
    if (lvl === 'month') return MONTHS[p.m] + ' ' + p.y;
    if (lvl === 'week') return 'Week of ' + p.d + ' ' + MON[p.m] + ' ' + p.y;
    if (lvl === 'day') return DOW[p.w] + ' ' + p.d + ' ' + MON[p.m] + ' ' + p.y;
    return DOW[p.w] + ' ' + p.d + ' ' + MON[p.m] + ', ' + String(p.h).padStart(2, '0') + ':00';
  }
  var PER = { hour: 'MWh per hour', day: 'MWh per day', week: 'MWh per week', month: 'MWh per month' };

  // ------------------------------------------------------------------ theme
  var T = {};
  function readTheme() {
    var cs = getComputedStyle(document.documentElement);
    function v(n) { return cs.getPropertyValue(n).trim(); }
    T = {
      text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), surface: v('--surface'), surface2: v('--surface-2'),
      border: v('--border'), grid: v('--grid'), accent: v('--accent'),
      solar: v('--c-solar'), wind: v('--c-wind'), el: v('--c-el'), meoh: v('--c-meoh'),
      surplus: v('--c-surplus'), deficit: v('--c-deficit'), neutral: v('--c-neutral'), aqua: v('--c-aqua'), orange: v('--c-orange'),
      seq: [v('--seq-0'), v('--seq-1'), v('--seq-2'), v('--seq-3'), v('--seq-4')],
      land: v('--map-land'), landDk: v('--map-land-dk'), mapLine: v('--map-line'),
      font: getComputedStyle(document.body).fontFamily
    };
  }
  function hex2rgb(h) { h = h.replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  function ramp(n) { // n ordered colours along the sequential ramp
    var stops = T.seq.map(hex2rgb), out = [];
    for (var i = 0; i < n; i++) {
      var p = n === 1 ? 0.5 : i / (n - 1) * (stops.length - 1), a = Math.floor(p), b = Math.min(stops.length - 1, a + 1), f = p - a;
      out.push('rgb(' + [0, 1, 2].map(function (k) { return Math.round(stops[a][k] + (stops[b][k] - stops[a][k]) * f); }).join(',') + ')');
    }
    return out;
  }

  // ------------------------------------------------------------------ chart helpers
  function axis(o) {
    return Object.assign({
      axisLine: { lineStyle: { color: T.border } }, axisTick: { show: false },
      axisLabel: { color: T.text2, fontSize: 11.5, hideOverlap: true },
      splitLine: { lineStyle: { color: T.grid } },
      nameTextStyle: { color: T.text3, fontSize: 11.5 }
    }, o || {});
  }
  function yAxis(name, o) {
    return axis(Object.assign({ type: 'value', name: name, nameLocation: 'end', nameGap: 12, nameTextStyle: { color: T.text3, fontSize: 11.5, align: 'left', padding: [0, 0, 0, -44] }, axisLine: { show: false } }, o || {}));
  }
  function xName(name, o) { return axis(Object.assign({ name: name, nameLocation: 'middle', nameGap: 28 }, o || {})); }
  function tip(o) {
    return Object.assign({
      trigger: 'axis', confine: true, backgroundColor: T.surface, borderColor: T.border, borderWidth: 1, padding: [8, 10],
      textStyle: { color: T.text, fontSize: 12.5, fontFamily: T.font },
      axisPointer: { type: 'line', lineStyle: { color: T.text3, width: 1 } },
      extraCssText: 'box-shadow:0 6px 20px rgba(0,0,0,.14);border-radius:10px;'
    }, o || {});
  }
  function narrow() { return window.innerWidth < 640; }
  function legend(o) {
    return Object.assign(narrow() ? { type: 'scroll', pageIconSize: 10, pageIconColor: T.text2, pageIconInactiveColor: T.border, pageTextStyle: { color: T.text2, fontSize: 11 } } : {}, { top: 0, left: 0, itemWidth: 11, itemHeight: 11, itemGap: 14, icon: 'roundRect', textStyle: { color: T.text2, fontSize: 12 }, inactiveColor: T.text3 }, o || {});
  }
  function opt(o) {
    return Object.assign({ useUTC: true, backgroundColor: 'transparent', animationDuration: 250, animationDurationUpdate: 200, textStyle: { fontFamily: T.font, color: T.text2 } }, o);
  }
  function zoom(idx, extra) {
    var s = Object.assign({
      type: 'slider', xAxisIndex: idx, height: 22, bottom: 8, borderColor: T.border, backgroundColor: 'transparent',
      fillerColor: 'rgba(128,128,128,.16)', dataBackground: { lineStyle: { color: T.text3, opacity: .5 }, areaStyle: { color: T.text3, opacity: .15 } },
      selectedDataBackground: { lineStyle: { color: T.text2 }, areaStyle: { color: T.text3, opacity: .3 } },
      handleStyle: { color: T.surface, borderColor: T.text3 }, moveHandleStyle: { color: T.text3 }, textStyle: { color: T.text2, fontSize: 11 },
      brushSelect: false, showDetail: false
    }, extra || {});
    return [Object.assign({ type: 'inside', xAxisIndex: idx, zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false }, extra || {}), s];
  }
  function row(color, name, value) {
    return '<div style="display:flex;justify-content:space-between;gap:18px;align-items:center"><span>' +
      (color ? '<i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:' + color + ';margin-right:6px"></i>' : '') +
      name + '</span><b style="font-variant-numeric:tabular-nums">' + value + '</b></div>';
  }
  function head(t) { return '<div style="font-weight:700;margin-bottom:4px">' + t + '</div>'; }
  // histogram / floating bars drawn as rectangles on value axes: data rows [x0, x1, y0, y1]
  function rects(name, data, color, o) {
    return Object.assign({
      type: 'custom', name: name, data: data, encode: { x: [0, 1], y: [2, 3] }, itemStyle: { color: color }, clip: true,
      renderItem: function (params, api) {
        var a = api.coord([api.value(0), api.value(2)]), b = api.coord([api.value(1), api.value(3)]);
        var x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
        var gx = w > 6 ? 1 : 0, gy = (o && o.gapY) || 0;
        return { type: 'rect', shape: { x: x + gx, y: y + gy, width: Math.max(0.5, w - 2 * gx), height: Math.max(0, h - 2 * gy), r: 2 }, style: { fill: color }, emphasis: { style: { opacity: .8 } } };
      }
    }, o || {});
  }

  // ------------------------------------------------------------------ chart registry (lazy render)
  var registry = [];
  function chart(id, deps, build) { registry.push({ id: id, el: $(id), deps: deps, build: build, inst: null, dirty: true, visible: false }); }
  function render(r, resetZoom) {
    if (!r.el) return;
    var option = r.build();
    if (!r.inst) {
      r.inst = echarts.init(r.el, null, { renderer: 'canvas' });
      if (window.ResizeObserver) new ResizeObserver(function () { r.inst.resize(); }).observe(r.el);
    } else if (!resetZoom && option.dataZoom) {
      var old = r.inst.getOption().dataZoom || [];
      option.dataZoom.forEach(function (z, i) { if (old[i]) { z.start = old[i].start; z.end = old[i].end; delete z.startValue; delete z.endValue; } });
    }
    r.inst.setOption(option, { notMerge: true });
    r.dirty = false;
  }
  function invalidate(dep, resetZoom) {
    registry.forEach(function (r) {
      if (dep && r.deps.indexOf(dep) < 0) return;
      r.dirty = true;
      if (r.visible) render(r, resetZoom);
    });
  }
  function observeCharts() {
    if (!window.IntersectionObserver) { registry.forEach(function (r) { r.visible = true; render(r); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var r = registry.filter(function (x) { return x.el === e.target; })[0];
        if (!r) return;
        r.visible = e.isIntersecting;
        if (r.visible && r.dirty) render(r);
      });
    }, { rootMargin: '300px 0px' });
    registry.forEach(function (r) { if (r.el) io.observe(r.el); });
  }

  // ================================================================== BALANCE CHARTS
  chart('ch-balance', ['scenario', 'balanceRes'], function () {
    var lvl = state.balanceRes, st = starts[lvl], n = SC.n, G = st ? st.length : n;
    var solar = st ? M.aggregate(SC.solar, st) : SC.solar, wind = st ? M.aggregate(SC.wind, st) : SC.wind, net = st ? M.aggregate(SC.net, st) : SC.net;
    var bars = lvl === 'week' || lvl === 'month';
    var x = new Array(G), lab = new Array(G), cons = new Array(G);
    for (var g = 0; g < G; g++) {
      var a = st ? st[g] : g, b = st ? (g + 1 < G ? st[g + 1] : n) : g + 1;
      x[g] = bars ? (wall[a] + wall[b - 1] + HOUR) / 2 : wall[a];
      lab[g] = label(wall[a], lvl); cons[g] = SC.consHourly * (b - a);
    }
    function pairs(arr, f) { var o = new Array(G); for (var i = 0; i < G; i++) o[i] = [x[i], f ? f(arr[i]) : arr[i]]; return o; }
    var area = function (color, extra) { return Object.assign({ type: 'line', symbol: 'none', lineStyle: { width: 0 }, areaStyle: { color: color, opacity: .9 }, itemStyle: { color: color }, emphasis: { disabled: true } }, extra); };
    var bar = function (color, extra) { return Object.assign({ type: 'bar', itemStyle: { color: color, borderColor: T.surface, borderWidth: 1 }, barMaxWidth: 46, emphasis: { disabled: true } }, extra); };
    var mk = bars ? bar : area;
    var o = opt({
      legend: legend({ data: ['Solar', 'Wind', 'Demand', 'Surplus → export', 'Deficit → import'] }),
      grid: [{ left: 56, right: 16, top: 52, height: '47%' }, { left: 56, right: 16, top: '70%', bottom: 58 }],
      xAxis: [axis({ type: 'time', gridIndex: 0, axisLabel: { show: false }, splitLine: { show: false } }), axis({ type: 'time', gridIndex: 1, splitLine: { show: false } })],
      yAxis: [yAxis('Generation and demand, ' + PER[lvl], { gridIndex: 0 }), yAxis('Net balance, ' + PER[lvl], { gridIndex: 1, splitNumber: 3 })],
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      tooltip: tip({
        formatter: function (ps) {
          var i = ps[0].dataIndex, g2 = solar[i] + wind[i], d = net[i];
          return head(lab[i]) + row(T.solar, 'Solar', n0(solar[i]) + ' MWh') + row(T.wind, 'Wind', n0(wind[i]) + ' MWh') +
            row('', 'Total generation', n0(g2) + ' MWh') + row(T.text, 'Demand', n0(cons[i]) + ' MWh') +
            '<div style="border-top:1px solid ' + T.border + ';margin:5px 0 4px"></div>' +
            row(d >= 0 ? T.surplus : T.deficit, d >= 0 ? 'Surplus → export' : 'Deficit → import', signed(d, n0) + ' MWh');
        }
      }),
      dataZoom: zoom([0, 1], lvl === 'hour' ? { startValue: wall[D.meta.monthStart[5]], endValue: wall[D.meta.monthStart[5] + 14 * 24] } : {}),
      series: [
        mk(T.solar, { name: 'Solar', stack: 'gen', data: pairs(solar) }),
        mk(T.wind, { name: 'Wind', stack: 'gen', data: pairs(wind) }),
        { name: 'Demand', type: 'line', step: bars ? 'middle' : false, symbol: 'none', data: pairs(cons), lineStyle: { color: T.text, width: 2 }, itemStyle: { color: T.text }, z: 5, emphasis: { disabled: true } },
        mk(T.surplus, { name: 'Surplus → export', xAxisIndex: 1, yAxisIndex: 1, stack: 'net', data: pairs(net, function (v) { return v > 0 ? v : 0; }) }),
        mk(T.deficit, { name: 'Deficit → import', xAxisIndex: 1, yAxisIndex: 1, stack: 'net2', data: pairs(net, function (v) { return v < 0 ? v : 0; }) })
      ]
    });
    if (bars) { o.series[4].stack = 'net'; }
    return o;
  });

  chart('ch-monthly', ['scenario'], function () {
    var rows = M.monthlyTable(SC, wall);
    function s(name, key, stack, color) {
      return { name: name, type: 'bar', stack: stack, data: rows.map(function (r) { return Math.round(r[key]); }), itemStyle: { color: color, borderColor: T.surface, borderWidth: 1 }, barMaxWidth: 26, emphasis: { focus: 'series' } };
    }
    return opt({
      legend: legend(), grid: { left: 56, right: 12, top: 52, bottom: 28 },
      xAxis: axis({ type: 'category', data: MON, splitLine: { show: false } }), yAxis: yAxis('MWh per month'),
      tooltip: tip({
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(128,128,128,.1)' } },
        formatter: function (ps) {
          var r = rows[ps[0].dataIndex];
          return head(MONTHS[r.month] + ' ' + D.meta.year) + row(T.solar, 'Solar', n0(r.solar) + ' MWh') + row(T.wind, 'Wind', n0(r.wind) + ' MWh') +
            row(T.el, 'Electrolyser', n0(r.electrolyzer) + ' MWh') + row(T.meoh, 'Methanol plant', n0(r.methanol) + ' MWh') +
            '<div style="border-top:1px solid ' + T.border + ';margin:5px 0 4px"></div>' + row(r.net >= 0 ? T.surplus : T.deficit, 'Net balance', signed(r.net, n0) + ' MWh');
        }
      }),
      series: [s('Solar', 'solar', 'gen', T.solar), s('Wind', 'wind', 'gen', T.wind), s('Electrolyser', 'electrolyzer', 'con', T.el), s('Methanol plant', 'methanol', 'con', T.meoh)]
    });
  });

  chart('ch-duration', ['scenario'], function () {
    var dc = M.durationCurve(SC.net, 500), share = SC.totals.surplusShare * 100;
    return opt({
      grid: { left: 56, right: 18, top: 34, bottom: 44 },
      xAxis: xName('Share of the year (%)', { type: 'value', min: 0, max: 100, splitLine: { show: false } }),
      yAxis: yAxis('Net power, MW'),
      tooltip: tip({ formatter: function (ps) { var v = ps[0].value; return head(n1(v[0]) + '% of hours are above') + row(v[1] >= 0 ? T.surplus : T.deficit, 'Net power', signed(v[1], n1) + ' MW'); } }),
      series: [
        part(dc.filter(function (p) { return p[1] >= 0; }), T.surplus, {
          markLine: {
            silent: true, symbol: 'none', lineStyle: { color: T.text3, type: 'dashed' },
            label: { color: T.text2, fontSize: 11.5, formatter: 'surplus in ' + share.toFixed(0) + '% of hours', position: share > 60 ? 'insideEndTop' : 'insideEndBottom' },
            data: share > 0.5 && share < 99.5 ? [{ xAxis: share }] : []
          }
        }),
        part(dc.filter(function (p) { return p[1] < 0; }), T.deficit)
      ]
    });
    function part(data, color, extra) {
      return Object.assign({ type: 'line', symbol: 'none', data: data, lineStyle: { width: 2, color: color }, itemStyle: { color: color }, areaStyle: { color: color, opacity: .25 }, emphasis: { disabled: true } }, extra || {});
    }
  });

  chart('ch-heat', ['scenario'], function () {
    var day0 = Math.floor(wall[0] / DAY), nDays = Math.floor(wall[SC.n - 1] / DAY) - day0 + 1, data = new Array(SC.n), mx = 1;
    for (var i = 0; i < SC.n; i++) {
      var v = SC.net[i]; if (Math.abs(v) > mx) mx = Math.abs(v);
      data[i] = [Math.floor(wall[i] / DAY) - day0, new Date(wall[i]).getUTCHours(), Math.round(v * 10) / 10];
    }
    mx = Math.ceil(mx / 10) * 10;
    var days = [], firsts = {};
    for (var d = 0; d < nDays; d++) { var p = dParts((day0 + d) * DAY); days.push(p.d + ' ' + MON[p.m]); if (p.d === 1) firsts[d] = MON[p.m]; }
    return opt({
      animation: false,
      grid: { left: 48, right: 14, top: 10, bottom: 78 },
      xAxis: axis({ type: 'category', data: days, splitLine: { show: false }, axisLabel: { color: T.text2, fontSize: 11.5, interval: function (i2) { return firsts[i2] !== undefined && (!narrow() || MON.indexOf(firsts[i2]) % 2 === 0); }, formatter: function (v2, i2) { return firsts[i2] || ''; } } }),
      yAxis: axis({ type: 'category', inverse: true, data: Array.from({ length: 24 }, function (_, h) { return String(h).padStart(2, '0') + ':00'; }), axisLabel: { color: T.text2, fontSize: 11.5, interval: 5 }, splitLine: { show: false }, axisLine: { show: false } }),
      visualMap: { type: 'continuous', min: -mx, max: mx, dimension: 2, calculable: false, orient: 'horizontal', left: 'center', bottom: 6, itemWidth: 12, itemHeight: narrow() ? 110 : 220,
        inRange: { color: [T.deficit, T.neutral, T.surplus] }, text: ['+' + n0(mx) + ' MW surplus', 'deficit −' + n0(mx) + ' MW'], textStyle: { color: T.text2, fontSize: 11.5 } },
      tooltip: tip({ trigger: 'item', formatter: function (p2) { var v3 = p2.value; return head(days[v3[0]] + ', ' + String(v3[1]).padStart(2, '0') + ':00') + row(v3[2] >= 0 ? T.surplus : T.deficit, v3[2] >= 0 ? 'Surplus' : 'Deficit', signed(v3[2], n1) + ' MW'); } }),
      series: [{ type: 'heatmap', data: data, progressive: 0, emphasis: { itemStyle: { borderColor: T.text, borderWidth: 1 } } }]
    });
  });

  // ================================================================== SOLAR CHARTS
  chart('ch-solar', [], function () {
    var st = starts.day, clear = M.aggregate(D.hourly.solarClear, st), all = M.aggregate(D.hourly.solarAllsky, st);
    var x = st.map(function (i) { return wall[i]; });
    function pairs(a) { return a.map(function (v, i) { return [x[i], Math.round(v)]; }); }
    return opt({
      legend: legend(), grid: { left: 56, right: 16, top: 52, bottom: 58 },
      xAxis: axis({ type: 'time', splitLine: { show: false } }), yAxis: yAxis('MWh per day'),
      tooltip: tip({ formatter: function (ps) { var i = ps[0].dataIndex; return head(label(x[i], 'day')) + row(T.text3, 'Clear-sky model', n0(clear[i]) + ' MWh') + row(T.solar, 'All-sky 2023', n0(all[i]) + ' MWh') + row('', 'Ratio', pct(clear[i] ? all[i] / clear[i] : 0)); } }),
      dataZoom: zoom([0]),
      series: [
        { name: 'All-sky 2023 (NASA POWER irradiance)', type: 'line', symbol: 'none', data: pairs(all), lineStyle: { width: 1.5, color: T.solar }, itemStyle: { color: T.solar }, areaStyle: { color: T.solar, opacity: .3 } },
        { name: 'Clear-sky model (upper bound)', type: 'line', symbol: 'none', data: pairs(clear), lineStyle: { width: 2, color: T.text3, type: 'dashed' }, itemStyle: { color: T.text3 } }
      ]
    });
  });

  chart('ch-irr', [], function () {
    var H = D.hourly, n = D.meta.n;
    function pairs(a) { var o = new Array(n); for (var i = 0; i < n; i++) o[i] = [wall[i], a[i]]; return o; }
    function line(name, a, color) { return { name: name, type: 'line', symbol: 'none', sampling: 'lttb', data: pairs(a), lineStyle: { width: 2, color: color }, itemStyle: { color: color }, emphasis: { disabled: true } }; }
    var s0 = D.meta.monthStart[5] + 9 * 24;
    return opt({
      legend: legend(), grid: { left: 56, right: 16, top: 70, bottom: 58 },
      xAxis: axis({ type: 'time', splitLine: { show: false } }), yAxis: yAxis('W/m²'),
      tooltip: tip({ valueFormatter: function (v) { return n0(v) + ' W/m²'; }, axisPointer: { type: 'line', label: { show: false } },
        formatter: function (ps) { return head(label(ps[0].value[0], 'hour')) + ps.map(function (p) { return row(p.color, p.seriesName, n0(p.value[1]) + ' W/m²'); }).join(''); } }),
      dataZoom: zoom([0], { startValue: wall[s0], endValue: wall[s0 + 10 * 24] }),
      series: [
        { name: 'All-sky GHI (2023)', type: 'line', symbol: 'none', sampling: 'lttb', data: pairs(H.ghiAllsky), lineStyle: { width: 0 }, areaStyle: { color: T.text3, opacity: .35 }, itemStyle: { color: T.text3 }, emphasis: { disabled: true } },
        line('Clear-sky GHI', H.ghiClear, T.wind), line('Clear-sky DNI', H.dniClear, T.orange), line('Clear-sky DHI', H.dhiClear, T.aqua)
      ]
    });
  });

  chart('ch-tilt', [], function () {
    var S = D.tiltSensitivity, data = [], mn = Infinity, mx = -Infinity, best = [0, 0, 0];
    S.energyMwh.forEach(function (rowv, ti) { rowv.forEach(function (v, ai) { var g = v / 1000; data.push([ai, ti, Math.round(g * 10) / 10]); if (g < mn) mn = g; if (g > mx) { mx = g; best = [ai, ti, g]; } }); });
    return opt({
      grid: { left: 50, right: 16, top: 30, bottom: 96 },
      xAxis: xName('Azimuth (90° east · 180° south · 270° west)', { type: 'category', data: S.azimuths.map(function (a) { return a + '°'; }), splitLine: { show: false }, axisLabel: { color: T.text2, fontSize: 11.5, interval: 5 }, nameGap: 26 }),
      yAxis: axis({ type: 'category', name: 'Tilt', data: S.tilts.map(function (t) { return t + '°'; }), splitLine: { show: false }, axisLine: { show: false }, axisLabel: { color: T.text2, fontSize: 11.5, interval: 1 }, nameTextStyle: { color: T.text3, fontSize: 11.5, align: 'right' }, nameGap: 8 }),
      visualMap: { type: 'continuous', min: Math.floor(mn), max: Math.ceil(mx), dimension: 2, seriesIndex: 0, calculable: false, orient: 'horizontal', left: 'center', bottom: 4, itemWidth: 12, itemHeight: narrow() ? 120 : 200,
        inRange: { color: T.seq }, text: [n0(mx) + ' GWh', n0(mn) + ' GWh'], textStyle: { color: T.text2, fontSize: 11.5 } },
      tooltip: tip({ trigger: 'item', formatter: function (p) { var v = p.value; return head('Tilt ' + S.tilts[v[1]] + '° · azimuth ' + S.azimuths[v[0]] + '°') + row('', 'Annual yield', n1(v[2]) + ' GWh') + row('', 'vs optimum', pct(v[2] / best[2], 1)); } }),
      series: [
        { type: 'heatmap', data: data, itemStyle: { borderColor: T.surface, borderWidth: 1 }, emphasis: { itemStyle: { borderColor: T.text, borderWidth: 1.5 } } },
        { type: 'scatter', data: [[best[0], best[1], best[2]]], symbol: 'circle', symbolSize: 13, itemStyle: { color: T.surface, borderColor: T.text, borderWidth: 2.5 }, silent: true, z: 5,
          label: { show: true, position: 'top', distance: 7, formatter: 'Optimum ' + S.tilts[best[1]] + '° / ' + S.azimuths[best[0]] + '°', color: T.text, fontWeight: 700, fontSize: 12, backgroundColor: T.surface, padding: [3, 6], borderRadius: 5 } }
      ]
    });
  });

  // ================================================================== WIND CHARTS
  chart('ch-wind', ['windRes'], function () {
    var lvl = state.windRes, st = starts[lvl], W = D.hourly.wind, n = D.meta.n, G = st ? st.length : n;
    var mean = st ? M.aggregate(W, st, 'mean') : W, mn = st ? M.aggregate(W, st, 'min') : null, mx = st ? M.aggregate(W, st, 'max') : null;
    var x = new Array(G);
    for (var g = 0; g < G; g++) { var a = st ? st[g] : g, b = st ? (g + 1 < G ? st[g + 1] : n) : g + 1; x[g] = st ? (wall[a] + wall[b - 1] + HOUR) / 2 : wall[a]; }
    function pairs(f) { var o = new Array(G); for (var i = 0; i < G; i++) o[i] = [x[i], Math.round(f(i) * 100) / 100]; return o; }
    var series = [];
    if (st) {
      series.push({ name: 'min', type: 'line', stack: 'band', symbol: 'none', lineStyle: { width: 0 }, data: pairs(function (i) { return mn[i]; }), silent: true, emphasis: { disabled: true } });
      series.push({ name: 'Min–max range', type: 'line', stack: 'band', symbol: 'none', lineStyle: { width: 0 }, areaStyle: { color: T.wind, opacity: .22 }, itemStyle: { color: T.wind, opacity: .35 }, data: pairs(function (i) { return mx[i] - mn[i]; }), silent: true, emphasis: { disabled: true } });
    }
    series.push({ name: st ? 'Mean power' : 'Hourly power', type: 'line', symbol: lvl === 'month' ? 'circle' : 'none', symbolSize: 8, data: pairs(function (i) { return mean[i]; }), lineStyle: { width: lvl === 'hour' ? 1.2 : 2, color: T.wind }, itemStyle: { color: T.wind }, z: 4 });
    return opt({
      legend: legend({ data: st ? ['Mean power', 'Min–max range'] : ['Hourly power'] }),
      grid: { left: 56, right: 16, top: 52, bottom: 58 },
      xAxis: axis({ type: 'time', splitLine: { show: false } }), yAxis: yAxis('MW', { max: 60 }),
      tooltip: tip({ formatter: function (ps) { var i = ps[0].dataIndex, t = st ? wall[st[i]] : wall[i]; return head(label(t, lvl)) + row(T.wind, st ? 'Mean' : 'Power', n1(mean[i]) + ' MW') + (st ? row('', 'Maximum', n1(mx[i]) + ' MW') + row('', 'Minimum', n1(mn[i]) + ' MW') : ''); } }),
      dataZoom: zoom([0], lvl === 'hour' ? { startValue: wall[0], endValue: wall[31 * 24] } : {}),
      series: series
    });
  });

  chart('ch-pc', [], function () {
    var N = D.wind.numTurbines, pc = D.wind.powerCurve.map(function (p) { return [p[0], Math.round(p[1] * N * 100) / 100]; });
    return opt({
      grid: { left: 50, right: 16, top: 34, bottom: 44 },
      xAxis: xName('Wind speed at hub height (m/s)', { type: 'value', min: 0, max: 26, splitLine: { show: false } }), yAxis: yAxis('Farm output, MW'),
      tooltip: tip({ formatter: function (ps) { var v = ps[0].value; return head(v[0] + ' m/s') + row(T.wind, N + ' turbines', n1(v[1]) + ' MW') + row('', 'Per turbine', nf2.format(v[1] / N) + ' MW'); } }),
      series: [{ type: 'line', data: pc, symbol: 'circle', symbolSize: 6, lineStyle: { width: 2, color: T.wind }, itemStyle: { color: T.wind } }]
    });
  });

  chart('ch-weibull', [], function () {
    var ws = D.hourly.windSpeedHub, mx = 0; ws.forEach(function (v) { if (v > mx) mx = v; });
    var top = Math.ceil(mx), hist = M.histogram(ws, top, 0, top, true), wb = D.wind.weibull, pdf = [];
    for (var x = 0; x <= top; x += top / 160) pdf.push([x, M.weibullPdf(x, wb.k, wb.A)]);
    return opt({
      legend: legend(), grid: { left: 50, right: 16, top: 52, bottom: 44 },
      xAxis: xName('Wind speed at 130 m (m/s)', { type: 'value', min: 0, max: top, splitLine: { show: false } }),
      yAxis: yAxis('Share of hours per m/s', { axisLabel: { color: T.text2, fontSize: 11.5, formatter: function (v) { return (v * 100).toFixed(0) + '%'; } } }),
      tooltip: tip({ trigger: 'item', formatter: function (p) { if (p.seriesType !== 'custom') return ''; var v = p.value; return head(v[0] + '–' + v[1] + ' m/s') + row(T.wind, 'Observed', pct(v[3], 1) + ' of hours') + row(T.text, 'Weibull fit', pct(M.weibullPdf((v[0] + v[1]) / 2, wb.k, wb.A), 1)); } }),
      series: [
        rects('Observed', hist.map(function (b) { return [b.x0, b.x1, 0, b.value]; }), T.wind),
        { name: 'Weibull fit', type: 'line', data: pdf, symbol: 'none', lineStyle: { width: 2, color: T.text }, itemStyle: { color: T.text }, silent: true }
      ]
    });
  });

  chart('ch-rose', [], function () {
    var edges = [0, 5, 10, 15, 20], names = ['0–5', '5–10', '10–15', '15–20', '20+ m/s'];
    var rose = M.windRose(D.hourly.windSpeedHub, D.hourly.windDirHub, edges, 16), cols = ramp(5);
    var dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return opt({
      legend: legend({ top: 'auto', bottom: 0, left: 'center', itemGap: 10 }),
      polar: { radius: '70%', center: ['50%', '46%'] },
      angleAxis: { type: 'category', data: dirs, startAngle: 101.25, clockwise: true, axisLine: { lineStyle: { color: T.border } }, axisTick: { show: false }, axisLabel: { color: T.text2, fontSize: 11 }, splitLine: { show: false } },
      radiusAxis: { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: T.text3, fontSize: 10.5, formatter: '{value}%' }, splitLine: { lineStyle: { color: T.grid } }, splitNumber: 3 },
      tooltip: tip({ trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(128,128,128,.12)' } },
        formatter: function (ps) { var tot = 0; ps.forEach(function (p) { tot += p.value; }); return head('From ' + ps[0].name + ' · ' + n1(tot) + '% of hours') + ps.map(function (p) { return row(p.color, p.seriesName, n1(p.value) + '%'); }).join(''); } }),
      series: rose.map(function (r, i) { return { name: names[i], type: 'bar', coordinateSystem: 'polar', stack: 'r', data: r.map(function (v) { return Math.round(v * 100) / 100; }), itemStyle: { color: cols[i], borderColor: T.surface, borderWidth: .5 }, emphasis: { disabled: true } }; })
    });
  });

  chart('ch-wdist', [], function () {
    var dist = M.monthlyDistribution(D.hourly.wind, D.meta.monthStart, 6), cols = ramp(6);
    return opt({
      legend: legend({ type: 'scroll' }), grid: { left: 44, right: 12, top: 52, bottom: 28 },
      xAxis: axis({ type: 'category', data: MON, splitLine: { show: false } }),
      yAxis: axis({ type: 'value', max: 100, axisLine: { show: false }, axisLabel: { color: T.text2, fontSize: 11.5, formatter: '{value}%' } }),
      tooltip: tip({ axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(128,128,128,.1)' } },
        formatter: function (ps) { return head(MONTHS[ps[0].dataIndex] + ' · share of hours') + ps.slice().reverse().map(function (p) { return row(p.color, p.seriesName, n1(p.value) + '%'); }).join(''); } }),
      series: cols.map(function (c, b) {
        return { name: n0(dist.edges[b]) + '–' + n0(dist.edges[b + 1]) + ' MW', type: 'bar', stack: 'd', barMaxWidth: 34, itemStyle: { color: c, borderColor: T.surface, borderWidth: 1 },
          data: dist.shares.map(function (s) { return Math.round(s[b] * 10) / 10; }), emphasis: { disabled: true } };
      })
    });
  });

  chart('ch-season', ['scenario'], function () {
    var st = starts.month, s = M.aggregate(SC.solar, st, 'mean'), w = M.aggregate(SC.wind, st, 'mean');
    function bar(name, a, color) { return { name: name, type: 'bar', data: a.map(function (v) { return Math.round(v * 10) / 10; }), itemStyle: { color: color, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 20, barGap: '12%' }; }
    return opt({
      legend: legend(), grid: { left: 50, right: 12, top: 52, bottom: 28 },
      xAxis: axis({ type: 'category', data: MON, splitLine: { show: false } }), yAxis: yAxis('Average power, MW'),
      tooltip: tip({ axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(128,128,128,.1)' } },
        formatter: function (ps) { var i = ps[0].dataIndex; return head(MONTHS[i]) + row(T.solar, 'Solar', n1(s[i]) + ' MW') + row(T.wind, 'Wind', n1(w[i]) + ' MW') + row('', 'Combined', n1(s[i] + w[i]) + ' MW') + row(T.text, 'Plant demand', n1(SC.consHourly) + ' MW'); } }),
      series: [bar('Solar', s, T.solar), bar('Wind', w, T.wind),
        { name: 'Plant demand', type: 'line', data: MON.map(function () { return Math.round(SC.consHourly * 10) / 10; }), symbol: 'none', lineStyle: { color: T.text, width: 2, type: 'dashed' }, itemStyle: { color: T.text }, silent: true }]
    });
  });

  // ================================================================== SITES
  var mapRegistered = false;
  function geoRows() {
    var mode = state.geoMode;
    return D.geo.map(function (g) { return { name: g.name, lat: g.lat, lon: g.lon, solar: g.solar, wind: g.wind, v: (mode === 'solar' ? g.solar : mode === 'wind' ? g.wind : g.solar + g.wind) / 1000 }; });
  }
  var GEO_LABEL = { solar: 'Solar farm yield', wind: 'Wind farm yield', total: 'Combined solar + wind yield' };
  function geoTip(r, rank, total) {
    return head(r.name + (r.name === D.meta.site ? ' · project site' : '')) + row(T.solar, 'Solar (all-sky)', n1(r.solar / 1000) + ' GWh') + row(T.wind, 'Wind', n1(r.wind / 1000) + ' GWh') +
      row('', 'Combined', n1((r.solar + r.wind) / 1000) + ' GWh') + (rank ? row('', 'Rank', rank + ' of ' + total) : '');
  }
  chart('ch-map', ['geoMode'], function () {
    if (!mapRegistered) { echarts.registerMap('dk', window.DK_MAP); mapRegistered = true; }
    var rows = geoRows(), vals = rows.map(function (r) { return r.v; }), mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var sorted = rows.slice().sort(function (a, b) { return b.v - a.v; });
    function size(v) { return 11 + 15 * (v - mn) / (mx - mn || 1); }
    function item(r) { return { name: r.name, value: [r.lon, r.lat, Math.round(r.v * 10) / 10], row: r }; }
    var site = rows.filter(function (r) { return r.name === D.meta.site; })[0];
    return opt({
      geo: { map: 'dk', roam: false, aspectScale: 0.57, boundingCoords: [[7.0, 58.2], [16.0, 54.1]], silent: true, top: 8, bottom: 56, left: 4, right: 4,
        itemStyle: { areaColor: T.land, borderColor: T.mapLine, borderWidth: .8 }, label: { show: false },
        regions: [{ name: 'Denmark', itemStyle: { areaColor: T.landDk, borderColor: T.text3, borderWidth: 1 } }] },
      visualMap: { type: 'continuous', min: Math.floor(mn), max: Math.ceil(mx), dimension: 2, seriesIndex: 0, calculable: false, orient: 'horizontal', left: 'center', bottom: 4, itemWidth: 12, itemHeight: narrow() ? 120 : 200,
        inRange: { color: T.seq.slice(1) }, text: [n0(mx) + ' GWh/yr', n0(mn) + ' GWh/yr'], textStyle: { color: T.text2, fontSize: 11.5 } },
      tooltip: tip({ trigger: 'item', formatter: function (p) { var r = p.data.row; return geoTip(r, sorted.indexOf(r) + 1, rows.length); } }),
      series: [
        { type: 'scatter', coordinateSystem: 'geo', data: rows.map(item), symbolSize: function (v) { return size(v[2]); },
          itemStyle: { borderColor: T.text2, borderWidth: 1 }, emphasis: { scale: 1.25, itemStyle: { borderColor: T.text, borderWidth: 2 }, label: { show: true, formatter: '{b}', position: 'top', color: T.text, fontWeight: 700, fontSize: 12, backgroundColor: T.surface, padding: [2, 5], borderRadius: 4 } } },
        { type: 'scatter', coordinateSystem: 'geo', data: [item(site)], symbol: 'circle', symbolSize: size(site.v) + 12, silent: true, z: 1,
          itemStyle: { color: 'transparent', borderColor: T.text, borderWidth: 2 },
          label: { show: true, formatter: 'Project site', position: 'left', distance: 6, color: T.text, fontWeight: 700, fontSize: 12, backgroundColor: T.surface, padding: [2, 5], borderRadius: 4 } }
      ]
    });
  });
  chart('ch-rank', ['geoMode'], function () {
    var rows = geoRows().sort(function (a, b) { return b.v - a.v; });
    return opt({
      grid: { left: 4, right: 52, top: 4, bottom: 4, containLabel: true },
      xAxis: axis({ type: 'value', show: false, min: 0 }),
      yAxis: axis({ type: 'category', inverse: true, data: rows.map(function (r) { return r.name; }), splitLine: { show: false }, axisLine: { show: false },
        axisLabel: { color: T.text2, fontSize: 11.5, interval: 0, hideOverlap: false, formatter: function (v) { return v === D.meta.site ? '{s|' + v + '}' : v; }, rich: { s: { color: T.text, fontWeight: 700, fontSize: 11.5 } } } }),
      tooltip: tip({ trigger: 'item', formatter: function (p) { return geoTip(rows[p.dataIndex], p.dataIndex + 1, rows.length); } }),
      series: [{ type: 'bar', barWidth: '62%', data: rows.map(function (r) { return { value: Math.round(r.v * 10) / 10, itemStyle: { color: r.name === D.meta.site ? T.accent : T.seq[2], borderRadius: [0, 3, 3, 0] } }; }),
        label: { show: true, position: 'right', color: T.text2, fontSize: 11, formatter: function (p) { return n0(p.value); } } }]
    });
  });

  // ================================================================== ECONOMICS
  chart('ch-break', ['lcom'], function () {
    var b = ECON.base.breakdown, items = [['CAPEX', b.capex], ['Fixed OPEX', b.opex], ['Renewables at LCOE', b.generation], ['Grid import', b.gridImport], ['Export revenue', b.gridExport]];
    return opt({
      grid: { left: 130, right: 64, top: 8, bottom: 8 },
      xAxis: axis({ type: 'value', axisLabel: { show: false }, splitLine: { show: false } }),
      yAxis: axis({ type: 'category', inverse: true, data: items.map(function (i) { return i[0]; }), splitLine: { show: false }, axisLabel: { color: T.text2, fontSize: 12 } }),
      tooltip: tip({ trigger: 'item', formatter: function (p) { return head(p.name) + row('', 'Contribution', signed(p.value, n0) + ' EUR/t') + row('', 'Share of LCOM', pct(p.value / ECON.base.lcom, 1)); } }),
      series: [{ type: 'bar', barWidth: '58%', data: items.map(function (i) { return { value: Math.round(i[1] * 10) / 10, itemStyle: { color: i[1] < 0 ? T.aqua : T.seq[2], borderRadius: 3 } }; }),
        label: { show: true, position: 'right', color: T.text, fontSize: 12, fontWeight: 600, formatter: function (p) { return signed(p.value, n0); } } }]
    });
  });

  chart('ch-tornado', ['lcom'], function () {
    var t = ECON.tornado, rows = t.rows, lo = [], hi = [];
    rows.forEach(function (r, i) { lo.push([t.base, r.low, i - .3, i + .3]); hi.push([t.base, r.high, i - .3, i + .3]); });
    var all = rows.reduce(function (a, r) { return a.concat([r.low, r.high]); }, [t.base]), mn = Math.min.apply(null, all), mx = Math.max.apply(null, all), pad = (mx - mn) * .08 || 1;
    return opt({
      legend: legend(), grid: { left: 84, right: 24, top: 56, bottom: 48 },
      xAxis: axis({ type: 'value', scale: true, name: 'LCOM, EUR/t', nameLocation: 'middle', nameGap: 24 }),
      yAxis: axis({ type: 'value', min: -.5, max: rows.length - .5, inverse: true, interval: 1, splitLine: { show: false }, axisLine: { show: false },
        axisLabel: { color: T.text2, fontSize: 12, customValues: rows.map(function (_, i) { return i; }), formatter: function (v) { return rows[v] ? rows[v].name : ''; } } }),
      tooltip: tip({ trigger: 'item', formatter: function (p) { var r = rows[Math.round((p.value[2] + p.value[3]) / 2)]; return head(r.name + ' · ' + r.range) + row(T.wind, 'Input low', n0(r.low) + ' EUR/t') + row(T.orange, 'Input high', n0(r.high) + ' EUR/t') + row('', 'Base', n0(t.base) + ' EUR/t'); } }),
      series: [
        rects('Input at low value', lo, T.wind, { markLine: { silent: true, symbol: 'none', lineStyle: { color: T.text, type: 'dashed', width: 1.5 }, label: { color: T.text, fontSize: 11.5, formatter: 'base ' + n0(t.base), position: 'start' }, data: [{ xAxis: t.base }] } }),
        rects('Input at high value', hi, T.orange)
      ]
    });
  });

  chart('ch-mc', ['lcom'], function () {
    var mc = ECON.mc, v = mc.values, lo = v[0], hi = v[v.length - 1], span = hi - lo || 1;
    var hist = M.histogram(v, 50, lo, hi, false);
    function ml(x, name) { return { xAxis: x, label: { formatter: name + '\n' + n0(x), color: T.text, fontSize: 11.5, lineHeight: 14 } }; }
    return opt({
      grid: { left: 50, right: 20, top: 44, bottom: 44 },
      xAxis: xName('LCOM (EUR per tonne)', { type: 'value', min: lo - span * .02, max: hi + span * .02, splitLine: { show: false }, axisLabel: { color: T.text2, fontSize: 11.5, formatter: function (x) { return n0(x); } } }),
      yAxis: yAxis('Simulation runs'),
      tooltip: tip({ trigger: 'item', formatter: function (p) { var q = p.value; return head(n0(q[0]) + '–' + n0(q[1]) + ' EUR/t') + row(T.wind, 'Runs', n0(q[3]) + ' of ' + n0(v.length)); } }),
      series: [rects('LCOM', hist.map(function (b) { return [b.x0, b.x1, 0, b.count]; }), T.wind, {
        markLine: { silent: true, symbol: 'none', lineStyle: { color: T.text, width: 1.5, type: 'dashed' }, data: [ml(mc.p5, 'P5'), ml(mc.mean, 'Mean'), ml(mc.p95, 'P95')] },
        markArea: { silent: true, itemStyle: { color: T.text3, opacity: .1 }, data: [[{ xAxis: mc.p5 }, { xAxis: mc.p95 }]] }
      })]
    });
  });

  // ================================================================== DOM updates
  function updateScenarioDom() {
    var t = SC.totals, p = SC.params, pr = SC.process;
    setHtml('k-gen', gwh(t.generation)); setText('k-gen-n', pct(t.generation ? t.solar / t.generation : 0) + ' solar · ' + pct(t.generation ? t.wind / t.generation : 0) + ' wind');
    setHtml('k-cons', gwh(t.consumption)); setText('k-cons-n', n1(SC.consHourly) + ' MW average load');
    setHtml('k-net', (t.net >= 0 ? '+' : '−') + gwh(Math.abs(t.net))); setText('k-net-n', t.net >= 0 ? 'annual surplus' : 'annual deficit');
    setHtml('k-exp', gwh(t.exportMwh)); setText('k-exp-n', pct(t.surplusShare) + ' of hours in surplus');
    setHtml('k-imp', gwh(t.importMwh)); setText('k-imp-n', pct(1 - t.surplusShare) + ' of hours in deficit');
    setHtml('k-self', pct(t.selfSufficiency, 1));
    setHtml('k-h2', tonnes(pr.h2T)); setHtml('k-meoh', tonnes(pr.meohT)); setText('k-meoh-n', n0(pr.co2T) + ' t CO₂ utilised');

    setHtml('fl-solar', gwh(t.solar)); setText('fl-solar-s', n0(p.solarDcMw) + ' MW DC · ' + (p.solarBasis === 'clear' ? 'clear-sky' : 'all-sky') + ' · CF ' + pct(t.solarCf, 1));
    setHtml('fl-wind', gwh(t.wind)); setText('fl-wind-s', p.turbines + ' × ' + D.wind.ratedMw + ' MW at ' + D.wind.hubHeight + ' m · CF ' + pct(t.windCf, 1));
    setHtml('fl-grid', (t.net >= 0 ? '+' : '−') + gwh(Math.abs(t.net))); setText('fl-grid-s', n1(t.exportMwh / 1000) + ' GWh exported · ' + n1(t.importMwh / 1000) + ' GWh imported');
    setHtml('fl-el', unit(n0(p.electrolyzerMw), 'MW')); setText('fl-el-s', n1(t.electrolyzer / 1000) + ' GWh/yr at ' + pct(p.uptime) + ' uptime');
    setText('fl-h2o-in', n0(pr.waterInT) + ' t/yr'); setText('fl-o2', n0(pr.o2T) + ' t/yr');
    setText('fl-h2-arrow', 'H₂ ' + n0(pr.h2T) + ' t/yr');
    setHtml('fl-syn', unit(n1(p.methanolMw), 'MW')); setText('fl-syn-s', n1(t.methanolPlant / 1000) + ' GWh/yr auxiliary power');
    setText('fl-co2', n0(pr.co2T) + ' t/yr'); setText('fl-h2o-out', n0(pr.waterOutT) + ' t/yr');
    setHtml('fl-meoh', unit(n0(pr.meohT), 't/yr')); setText('fl-meoh-s', pr.meohT ? n0(pr.meohT / 365) + ' t per day on average' : 'no production');
    setText('fl-co2-b', n0(pr.co2T) + ' t/yr'); setText('fl-spec', pr.meohT ? n1(t.consumption / pr.meohT) + ' MWh/t' : '–');

    setText('basisHint', p.solarBasis === 'clear' ? 'Notebook baseline: a cloud-free sky model — an upper bound on solar yield.' : 'NASA POWER 2023 irradiance including clouds — a realistic single-year yield.');
    setText('balanceSub', (state.balanceRes === 'hour' ? 'Hourly values, two weeks shown. ' : '') + 'Drag the slider to pan, Ctrl + scroll to zoom.');

    // controls
    Object.keys(CTL).forEach(function (k) { var c = CTL[k], el = $('c-' + k); if (!el) return; var val = p[k] * (c.scale || 1); if (document.activeElement !== el) el.value = val; setText('o-' + k, c.fmt(val)); });
    document.querySelectorAll('input[name=solarBasis]').forEach(function (r) { r.checked = r.value === p.solarBasis; });

    // monthly table
    var rows = M.monthlyTable(SC, wall), keys = ['solar', 'wind', 'generation', 'electrolyzer', 'methanol', 'consumption', 'net'], tot = {};
    var html = '<thead><tr><th scope="col">Month</th><th scope="col">Solar</th><th scope="col">Wind</th><th scope="col">Total generation</th><th scope="col">Electrolyser</th><th scope="col">Methanol plant</th><th scope="col">Total consumption</th><th scope="col">Net energy</th><th scope="col">Grid interaction</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr><td>' + MONTHS[r.month] + ' ' + D.meta.year + '</td>';
      keys.forEach(function (k) { tot[k] = (tot[k] || 0) + r[k]; html += '<td>' + (k === 'net' ? signed(r[k], n0) : n0(r[k])) + '</td>'; });
      html += '<td>' + pill(r.net) + '</td></tr>';
    });
    html += '</tbody><tfoot><tr><td>Year</td>' + keys.map(function (k) { return '<td>' + (k === 'net' ? signed(tot[k], n0) : n0(tot[k])) + '</td>'; }).join('') + '<td>' + pill(tot.net) + '</td></tr></tfoot>';
    setHtml('monthlyTable', html);
  }
  function pill(v) { return v > 0 ? '<span class="pill excess">Excess</span>' : v < 0 ? '<span class="pill deficit">Deficit</span>' : '<span class="pill">Balanced</span>'; }

  var CTL = {
    solarDcMw: { fmt: function (v) { return n0(v) + ' MW DC'; } },
    turbines: { fmt: function (v) { return n0(v) + ' · ' + n0(v * D.wind.ratedMw) + ' MW'; } },
    electrolyzerMw: { fmt: function (v) { return n0(v) + ' MW'; } },
    methanolMw: { fmt: function (v) { return n1(v) + ' MW'; } },
    uptime: { scale: 100, fmt: function (v) { return n0(v) + '%'; } },
    h2KwhPerKg: { fmt: function (v) { return n1(v) + ' kWh/kg H₂'; } }
  };
  var raf = 0;
  function scenarioChanged() {
    SC = M.runScenario(D, state.scenario);
    updateScenarioDom();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () { invalidate('scenario'); });
  }

  // ---- economics
  var LF = [
    ['Plant'], ['productionT', 'Methanol output (t/yr)', 1, 0], ['capex', 'CAPEX (M EUR)', 1e6, 2], ['opexFixed', 'Fixed OPEX (M EUR/yr)', 1e6, 2], ['lcoe', 'Renewables LCOE (EUR/MWh)', 1, 2],
    ['Electricity'], ['generationMwh', 'Generation (GWh/yr)', 1e3, 1], ['exportMwh', 'Grid export (GWh/yr)', 1e3, 1], ['importMwh', 'Grid import (GWh/yr)', 1e3, 1], ['exportFactor', 'Export price factor (%)', .01, 0],
    ['Market prices'], ['dayPrice', 'Day price (EUR/MWh)', 1, 2], ['nightPrice', 'Night price (EUR/MWh)', 1, 2], ['dayExportShare', 'Export by day (%)', .01, 0], ['dayImportShare', 'Import by day (%)', .01, 0],
    ['Finance'], ['years', 'Lifetime (years)', 1, 0], ['discountRate', 'Discount rate (%)', .01, 2], ['degradation', 'Output decline (%/yr)', .01, 2], ['mcRuns', 'Monte Carlo runs', 1, 0],
    ['Monte Carlo shifts'], ['mcLcoeShift', 'LCOE shift (%)', .01, 0], ['mcPriceShift', 'Price shift (%)', .01, 0], ['mcSd', 'Std. deviation (%)', .01, 1]
  ];
  var LIMITS = { years: [1, 60], mcRuns: [100, 50000], productionT: [1, 1e9], discountRate: [0, 1], mcSd: [0, 1] };
  function buildLcomForm() {
    var html = '';
    LF.forEach(function (f) {
      if (f.length === 1) { html += '<div class="group">' + f[0] + '</div>'; return; }
      html += '<label>' + f[1] + '<input type="number" inputmode="decimal" step="any" id="l-' + f[0] + '" data-key="' + f[0] + '"></label>';
    });
    $('lcomForm').innerHTML = html;
    $('lcomForm').addEventListener('change', function (e) {
      var k = e.target.getAttribute('data-key'); if (!k) return;
      var f = LF.filter(function (x) { return x[0] === k; })[0], v = parseFloat(e.target.value);
      if (!isFinite(v)) { fillLcomForm(); return; }
      v *= f[2];
      if (LIMITS[k]) v = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v));
      if (k === 'years' || k === 'mcRuns') v = Math.round(v);
      state.lcom[k] = v; lcomChanged();
    });
  }
  function fillLcomForm() {
    LF.forEach(function (f) { if (f.length > 1) $('l-' + f[0]).value = +(state.lcom[f[0]] / f[2]).toFixed(f[3]); });
  }
  function lcomChanged() {
    var p = state.lcom;
    ECON = { base: M.lcom(p), mc: M.monteCarlo(p), tornado: M.tornado(p) };
    fillLcomForm();
    setHtml('e-base', n0(ECON.base.lcom));
    setHtml('e-mean', n0(ECON.mc.mean)); setText('e-mean-n', n0(p.mcRuns) + ' runs, EUR per tonne');
    setHtml('e-band', n0(ECON.mc.p5) + ' – ' + n0(ECON.mc.p95));
    setHtml('e-energy', unit(n1(ECON.base.annualEnergyCost / 1e6), 'M EUR'));
    setText('e-energy-n', 'import ' + nf2.format(ECON.base.importPrice) + ' · export ' + nf2.format(ECON.base.exportPrice) + ' EUR/MWh');
    function sh(x) { return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(Math.round(x * 100)) + '%'; }
    setText('mcSub', n0(p.mcRuns) + ' runs with renewables LCOE shifted ' + sh(p.mcLcoeShift) + ' and grid prices ' + sh(p.mcPriceShift) + ' (σ = ' + +(p.mcSd * 100).toFixed(1) + ' points each), reflecting cheaper renewables and higher market prices than the base case. Shaded band: 5th–95th percentile.');
    invalidate('lcom');
  }

  // ---- static content
  function fillStatic() {
    var b = BASELINE.totals, pr = BASELINE.process, s = D.solar, w = D.wind;
    setHtml('hk-gen', gwh(b.generation)); setText('hk-gen-n', n0(b.generation) + ' MWh in ' + D.meta.year);
    setHtml('hk-solar', gwh(b.solar)); setText('hk-solar-n', s.targetDcMw + ' MW DC · clear-sky model');
    setHtml('hk-wind', gwh(b.wind)); setText('hk-wind-n', w.numTurbines + ' × ' + w.ratedMw + ' MW · capacity factor ' + pct(b.windCf));
    setHtml('hk-cons', gwh(b.consumption)); setText('hk-cons-n', D.plant.electrolyzerMw + ' MW + ' + D.plant.methanolMw + ' MW at ' + pct(D.plant.uptime) + ' uptime');
    setHtml('hk-meoh', tonnes(pr.meohT)); setText('hk-meoh-n', 'per year, from ' + n0(pr.co2T / 1000) + ' kt biogas CO₂');
    setHtml('hk-lcom', unit(n0(M.lcom(M.LCOM_DEFAULTS).lcom), 'EUR/t'));

    function dl(id, rows) { $(id).innerHTML = rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join(''); }
    dl('solarSpec', [
      ['Module', s.module], ['Inverter', s.inverter], ['Module power (Vmp × Imp)', nf2.format(s.moduleW) + ' W'], ['Inverter AC rating', (s.inverterAcMw * 1000).toFixed(0) + ' kW'],
      ['Modules per string', s.modulesPerString], ['Strings per inverter', s.stringsPerInverter], ['Inverters', n0(s.numInverters)], ['Modules', n0(s.totalModules)],
      ['DC capacity', nf2.format(s.dcMw) + ' MW'], ['AC capacity', nf2.format(s.acMw) + ' MW'], ['DC/AC ratio', nf2.format(s.dcMw / s.acMw)], ['Tilt / azimuth', s.tilt + '° / ' + s.azimuth + '° (south)'],
      ['Clear-sky yield', n0(b.solar) + ' MWh'], ['All-sky 2023 yield', n0(sum(D.hourly.solarAllsky)) + ' MWh']
    ]);
    var ws = D.hourly.windSpeedHub;
    dl('windSpec', [
      ['Turbine', 'Vestas ' + w.turbine], ['Rated power', w.ratedMw + ' MW'], ['Turbines', w.numTurbines], ['Installed capacity', n0(w.numTurbines * w.ratedMw) + ' MW'],
      ['Hub height', w.hubHeight + ' m'], ['Rotor diameter', w.rotorDiameter + ' m'], ['Layout', 'Ring, radius ' + w.spacingFactor + ' D'], ['Wake model', 'Jensen'],
      ['Mean wind speed at hub', nf2.format(sum(ws) / ws.length) + ' m/s'], ['Weibull k / A', w.weibull.k.toFixed(2) + ' / ' + w.weibull.A.toFixed(2) + ' m/s'],
      ['Annual yield', n0(b.wind) + ' MWh'], ['Capacity factor', pct(b.windCf, 1)], ['Full-load hours', n0(b.wind / (w.numTurbines * w.ratedMw)) + ' h']
    ]);
    setText('weibullSub', 'Hourly wind speed at ' + w.hubHeight + ' m. Weibull fit: k = ' + w.weibull.k.toFixed(2) + ', A = ' + w.weibull.A.toFixed(2) + ' m/s.');
    setText('dataStamp', 'Model data generated ' + D.meta.generated + ' with scripts/build_site_data.py from the repository.');
    updateGeoText();
  }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function updateGeoText() {
    var rows = geoRows().sort(function (a, b) { return b.v - a.v; }), i = rows.findIndex(function (r) { return r.name === D.meta.site; });
    setText('mapTitle', GEO_LABEL[state.geoMode] + ' by location');
    setText('mapSub', 'Best: ' + rows[0].name + ' (' + n0(rows[0].v) + ' GWh). ' + D.meta.site + ' ranks ' + (i + 1) + ' of ' + rows.length + ' with ' + n0(rows[i].v) + ' GWh — ' + pct(rows[i].v / rows[0].v) + ' of the best site.');
  }

  // ---- CSV
  function downloadCsv() {
    var lines = ['timestamp_local,solar_mwh,wind_mwh,generation_mwh,consumption_mwh,net_mwh,grid_interaction'];
    for (var i = 0; i < SC.n; i++) {
      var p = dParts(wall[i]), ts = p.y + '-' + String(p.m + 1).padStart(2, '0') + '-' + String(p.d).padStart(2, '0') + ' ' + String(p.h).padStart(2, '0') + ':00';
      lines.push([ts, SC.solar[i].toFixed(2), SC.wind[i].toFixed(2), SC.gen[i].toFixed(2), SC.consHourly.toFixed(2), SC.net[i].toFixed(2), SC.net[i] > 0 ? 'Excess' : SC.net[i] < 0 ? 'Deficit' : 'Balanced'].join(','));
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
    a.download = 'green-methanol-hourly-balance.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    return lines.length;
  }

  // ------------------------------------------------------------------ wiring
  function init() {
    readTheme();
    Object.keys(CTL).forEach(function (k) {
      var el = $('c-' + k), c = CTL[k];
      el.addEventListener('input', function () { state.scenario[k] = parseFloat(el.value) / (c.scale || 1); scenarioChanged(); });
    });
    document.querySelectorAll('input[name=solarBasis]').forEach(function (r) { r.addEventListener('change', function () { if (r.checked) { state.scenario.solarBasis = r.value; scenarioChanged(); } }); });
    $('resetScenario').addEventListener('click', function () { state.scenario = Object.assign({}, BASE_SCENARIO); scenarioChanged(); });
    $('downloadCsv').addEventListener('click', downloadCsv);
    [['balanceRes', 'balanceRes'], ['windRes', 'windRes'], ['geoMode', 'geoMode']].forEach(function (pair) {
      document.querySelectorAll('input[name=' + pair[0] + ']').forEach(function (r) {
        r.addEventListener('change', function () { if (!r.checked) return; state[pair[1]] = r.value; if (pair[0] === 'geoMode') updateGeoText(); if (pair[0] === 'balanceRes') updateScenarioDom(); invalidate(pair[1], true); });
      });
    });
    buildLcomForm();
    $('resetLcom').addEventListener('click', function () { state.lcom = Object.assign({}, M.LCOM_DEFAULTS); setText('lcomHint', 'Defaults are the project\'s techno-economic inputs. CAPEX and OPEX are not rescaled when you pull in a different scenario.'); lcomChanged(); });
    $('useScenario').addEventListener('click', function () {
      var t = SC.totals;
      state.lcom.generationMwh = t.generation; state.lcom.exportMwh = t.exportMwh; state.lcom.importMwh = t.importMwh; state.lcom.productionT = Math.max(1, SC.process.meohT);
      setText('lcomHint', 'Linked to the current scenario (' + (SC.params.solarBasis === 'clear' ? 'clear-sky' : 'all-sky') + ' solar, ' + n0(SC.params.solarDcMw) + ' MW solar, ' + SC.params.turbines + ' turbines). CAPEX and OPEX were not rescaled.');
      lcomChanged();
    });
    $('themeToggle').addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) { /* storage unavailable */ }
      readTheme(); invalidate(null);
    });

    // nav highlight
    var links = {}; document.querySelectorAll('.nav a').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
    if (window.IntersectionObserver) {
      var so = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { Object.keys(links).forEach(function (k) { links[k].classList.toggle('active', k === e.target.id); }); } });
      }, { rootMargin: '-40% 0px -55% 0px' });
      Object.keys(links).forEach(function (id) { var s = $(id); if (s) so.observe(s); });
    }

    fillStatic();
    updateScenarioDom();
    lcomChanged();
    observeCharts();
  }

  window.__app = {
    state: state, registry: registry, downloadCsv: downloadCsv,
    get scenario() { return SC; }, get econ() { return ECON; },
    renderAll: function () { registry.forEach(function (r) { r.visible = true; render(r); }); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
