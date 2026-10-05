// التحليلات: a dashboard of the period — headline figures against the period
// before, the sales trend, peak hours, weekdays, best customers and items,
// categories, cash/credit and cashiers. Charts are inline SVG drawn at the
// card's real width (redrawn when it changes) so text stays legible on a
// phone; ranked lists are plain HTML bars. Every chart can flip to a table.
import * as A from './analysis.js';

export function setupAnalytics(ctx) {
  const { $, $$, esc, fmt, money, table, icon, onAfter, state, store } = ctx;

  let specs = new Map(); // chart id → { draw, tip(i), … }
  let seq = 0;
  let ro = null;
  let itemsMode = store.get('fr3oon-analytics-items') === 'profit' ? 'profit' : 'rev';

  // ---------- formatting ----------

  const trim1 = (x) => String(Math.round(x * 10) / 10);
  const short = (n) => {
    const a = Math.abs(n);
    if (a >= 1e6) return trim1(n / 1e6) + 'M';
    if (a >= 1e3) return trim1(n / 1e3) + 'K';
    return String(Math.round(n));
  };
  const pctText = (r) => `${(r * 100).toFixed(1)}%`;
  const num = (n) => `<span class="num">${fmt(n)}</span>`;
  const periodHtml = () => {
    const { from, to } = state.filter;
    if (!from && !to) return 'كل الفترات';
    if (from === to) return `<span class="num">${from}</span>`;
    return `${from ? `<span class="num">${from}</span>` : '…'} إلى ${to ? `<span class="num">${to}</span>` : '…'}`;
  };
  const delta = (r) => {
    if (r == null || !isFinite(r)) return '<span class="delta flat"><span class="num">—</span></span>';
    const flat = Math.abs(r) < 0.0005, up = r > 0;
    return `<span class="delta ${flat ? 'flat' : up ? 'up' : 'down'}" title="التغيّر عن الفترة السابقة"><span aria-hidden="true">${flat ? '•' : up ? '▲' : '▼'}</span> <span class="num">${flat ? '0.0%' : (up ? '+' : '−') + Math.abs(r * 100).toFixed(1) + '%'}</span></span>`;
  };
  const niceStep = (x) => {
    const p = Math.pow(10, Math.floor(Math.log10(x || 1)));
    const m = x / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  };
  const scale = (max, n = 4) => {
    const step = niceStep(Math.max(max, 1) / n);
    return { step, top: Math.ceil(Math.max(max, 1) / step) * step };
  };
  const textW = (s, px = 11) => String(s).length * px * 0.62;

  const reg = (spec) => {
    const id = 'ac' + ++seq;
    specs.set(id, spec);
    return id;
  };

  // ---------- tooltip (own element; values via textContent) ----------

  let tipEl = null;
  let hovered = null;
  function tipBox() {
    if (!tipEl || !tipEl.isConnected) {
      tipEl = document.createElement('div');
      tipEl.className = 'an-tip';
      tipEl.hidden = true;
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function showTip(info, x, y) {
    if (!info) return hideTip();
    const el = tipBox();
    const title = document.createElement('div');
    title.className = 'an-tip-title';
    title.textContent = info.title;
    el.replaceChildren(title);
    for (const r of info.rows) {
      const row = document.createElement('div');
      row.className = 'an-tip-row';
      const key = document.createElement('i');
      key.className = 'an-lkey ' + (r.key || 'k1');
      const v = document.createElement('b');
      v.className = 'num';
      v.textContent = r.value;
      const l = document.createElement('span');
      l.textContent = r.label;
      row.append(key, v, l);
      el.append(row);
    }
    if (info.note) {
      const n = document.createElement('div');
      n.className = 'an-tip-note';
      n.textContent = info.note;
      el.append(n);
    }
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > innerWidth - 8) left = x - w - 14;
    if (left < 8) left = 8;
    if (top + h > innerHeight - 8) top = y - h - 14;
    if (top < 8) top = 8;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }
  function clearHover() {
    if (hovered) {
      hovered.classList.remove('is-hover');
      hovered = null;
    }
    $$('.an-cross').forEach((g) => g.setAttribute('visibility', 'hidden'));
  }
  function hideTip() {
    if (tipEl) tipEl.hidden = true;
    clearHover();
  }

  // Line charts: the crosshair snaps to the nearest point.
  function lineIndex(spec, el, clientX) {
    const g = spec.geom;
    if (!g) return 0;
    const r = el.ownerSVGElement.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * g.W;
    return Math.max(0, Math.min(g.n - 1, g.n === 1 ? 0 : Math.round((px - g.x0) / g.dx)));
  }
  function moveCross(spec, el, i) {
    const g = spec.geom;
    const svg = el.ownerSVGElement;
    const cross = svg?.querySelector('.an-cross');
    if (!g || !cross) return;
    const x = g.x(i);
    cross.querySelector('line').setAttribute('x1', x);
    cross.querySelector('line').setAttribute('x2', x);
    cross.querySelectorAll('circle').forEach((c) => {
      const v = c.dataset.s === 'prev' ? spec.points[i].prev : spec.points[i].cur;
      c.setAttribute('cx', x);
      c.setAttribute('cy', g.y(v || 0));
      c.setAttribute('visibility', v == null ? 'hidden' : 'visible');
    });
    cross.setAttribute('visibility', 'visible');
  }
  function point(el, e) {
    const spec = specs.get(el.dataset.ac);
    if (!spec) return hideTip();
    let i;
    if (el.dataset.line) {
      i = e ? lineIndex(spec, el, e.clientX) : spec.focusI ?? spec.points.length - 1;
      spec.focusI = i;
      clearHover();
      moveCross(spec, el, i);
    } else {
      i = Number(el.dataset.ai);
      if (hovered !== el) {
        clearHover();
        hovered = el;
        el.classList.add('is-hover');
      }
    }
    let x, y;
    if (e) [x, y] = [e.clientX, e.clientY];
    else {
      const r = el.getBoundingClientRect();
      const g = spec.geom;
      x = el.dataset.line && g ? r.left + (g.x(i) / g.W) * r.width : r.left + r.width / 2;
      y = r.top + Math.min(r.height / 2, 40);
    }
    showTip(spec.tip(i), x, y);
  }

  const onPointer = (e) => {
    const el = e.target.closest?.('#main [data-ac]');
    if (!el) return tipEl && !tipEl.hidden && hideTip();
    point(el, e);
  };
  document.addEventListener('pointermove', onPointer);
  document.addEventListener('pointerdown', onPointer);
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('#main [data-ac]');
    if (el) point(el, null);
    else if (tipEl && !tipEl.hidden) hideTip();
  });
  document.addEventListener('keydown', (e) => {
    const el = e.target.closest?.('#main [data-ac][data-line]');
    if (!el || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const spec = specs.get(el.dataset.ac);
    if (!spec) return;
    e.preventDefault();
    // the time axis runs left → right
    spec.focusI = Math.max(0, Math.min(spec.points.length - 1, (spec.focusI ?? spec.points.length - 1) + (e.key === 'ArrowRight' ? 1 : -1)));
    point(el, null);
  });

  // ---------- SVG charts ----------

  const yAxis = (W, padL, padR, y, top, step) => {
    let g = '';
    for (let v = 0; v <= top + 1e-9; v += step) {
      g += `<line class="${v === 0 ? 'an-base' : 'an-gline'}" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`;
      g += `<text class="an-axis" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${short(v)}</text>`;
    }
    return g;
  };
  const xLabel = (x, H, s, W) => {
    const half = textW(s) / 2 + 2;
    return `<text class="an-axis" x="${Math.max(half, Math.min(W - half, x))}" y="${H - 8}" text-anchor="middle">${esc(s)}</text>`;
  };

  // Trend: this period (line + soft area) against the previous one (muted line).
  function drawLine(spec, W) {
    const pts = spec.points;
    const n = pts.length;
    const H = W < 520 ? 230 : 280;
    const max = Math.max(...pts.map((p) => Math.max(p.cur, p.prev || 0)));
    const { top, step } = scale(max);
    const padT = 14, padB = 30, padR = 18;
    const padL = Math.max(36, textW(short(top)) + 14);
    const iw = W - padL - padR, ih = H - padT - padB;
    const dx = n > 1 ? iw / (n - 1) : 0;
    const x = (i) => (n > 1 ? padL + i * dx : padL + iw / 2);
    const y = (v) => padT + ih - (v / top) * ih;
    spec.geom = { W, n, x0: padL, dx, x, y };
    const path = (key) => {
      let d = '';
      pts.forEach((p, i) => {
        if (p[key] == null) return;
        d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`;
      });
      return d;
    };
    const cur = path('cur');
    const gid = 'ang' + spec.id;
    const area = n > 1 ? `${cur}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '';
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / (spec.mode === 'month' ? 74 : 62)))));
    let labels = '';
    for (let i = 0; i < n; i += every) labels += xLabel(x(i), H, spec.fmtX(pts[i].label), W);
    const last = n - 1;
    return `<svg class="an-svg-el" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(spec.aria)}" direction="ltr">
      <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="an-stop" stop-opacity=".22"/><stop offset="1" class="an-stop" stop-opacity="0"/></linearGradient></defs>
      ${yAxis(W, padL, padR, y, top, step)}${labels}
      ${spec.hasPrev ? `<path class="an-line prev" d="${path('prev')}"/>` : ''}
      ${area ? `<path d="${area}" fill="url(#${gid})"/>` : ''}
      <path class="an-line cur" d="${cur}"/>
      <circle class="an-dot cur" cx="${x(last)}" cy="${y(pts[last].cur)}" r="4"/>
      <g class="an-cross" visibility="hidden"><line y1="${padT}" y2="${padT + ih}"/>
        ${spec.hasPrev ? '<circle class="an-dot prev" data-s="prev" r="4"/>' : ''}<circle class="an-dot cur" data-s="cur" r="4.5"/></g>
      <rect class="an-hit-area" x="${padL - Math.min(dx / 2, padL)}" y="${padT}" width="${iw + Math.min(dx, padL + padR)}" height="${ih}" data-ac="${spec.id}" data-line="1" tabindex="0" aria-label="${esc(spec.aria)}: استخدم الأسهم للتنقل"/>
    </svg>`;
  }

  // Columns from one baseline; `emph` greys every column but that one.
  function drawCols(spec, W) {
    const d = spec.data;
    const n = d.length;
    const H = W < 520 ? 210 : 240;
    const max = Math.max(...d.map((p) => p.total));
    const { top, step } = scale(max);
    const padT = 24, padB = 30, padR = 8;
    const padL = Math.max(34, textW(short(top)) + 14);
    const iw = W - padL - padR, ih = H - padT - padB;
    const band = iw / n;
    const bw = Math.max(3, Math.min(24, band * 0.62));
    const y = (v) => padT + ih - (v / top) * ih;
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / spec.labelGap))));
    const narrow = band < spec.shortBelow;
    let marks = '', labels = '';
    d.forEach((p, i) => {
      const cx = padL + band * i + band / 2;
      const h = Math.max(0, y(0) - y(p.total));
      const r = Math.min(4, h, bw / 2);
      const x0 = cx - bw / 2, x1 = cx + bw / 2, yb = y(0), yt = yb - h;
      const bar = h > 0 ? `M${x0},${yb}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x1 - r}Q${x1},${yt} ${x1},${yt + r}V${yb}Z` : '';
      const cls = spec.emph == null || spec.emph === i ? '' : ' dim';
      marks += `<g class="an-hit" data-ac="${spec.id}" data-ai="${i}" tabindex="0" role="img" aria-label="${esc(spec.aria(p))}">
        <rect class="an-hitbox" x="${padL + band * i}" y="${padT - 20}" width="${band}" height="${ih + 20}"/>${bar ? `<path class="an-col${cls}" d="${bar}"/>` : ''}</g>`;
      if (i % every === 0) labels += xLabel(cx, H, narrow && spec.shortLabel ? spec.shortLabel(p) : spec.label(p), W);
      if (i === spec.mark && p.total > 0) {
        const s = short(p.total);
        const hw = textW(s, 12) / 2 + 2;
        labels += `<text class="an-val" x="${Math.max(padL + hw, Math.min(W - hw, cx))}" y="${yt - 7}" text-anchor="middle">${s}</text>`;
      }
    });
    return `<svg class="an-svg-el" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(spec.title)}" direction="ltr">
      ${yAxis(W, padL, padR, y, top, step)}${marks}${labels}</svg>`;
  }

  function drawAll() {
    $$('#main .an-svg[data-chart]').forEach((el) => drawOne(el));
  }
  function drawOne(el) {
    const spec = specs.get(el.dataset.chart);
    const W = Math.floor(el.clientWidth);
    if (!spec || W < 40 || W === Number(el.dataset.w)) return;
    el.dataset.w = W;
    el.innerHTML = spec.draw(spec, W);
  }

  // ---------- HTML pieces ----------

  const card = ({ title, sub = '', body, tableHtml = '', tools = '', cls = '' }) => `<section class="card an-card ${cls}">
      <header class="an-head"><div class="an-head-text"><h3>${esc(title)}</h3>${sub ? `<p class="an-sub">${sub}</p>` : ''}</div>
        <div class="an-tools">${tools}${tableHtml ? `<button type="button" class="an-toggle" data-an-toggle aria-pressed="false" title="عرض البيانات كجدول">${icon('reports')}<span>جدول</span></button>` : ''}</div></header>
      <div class="an-viz">${body}</div>${tableHtml ? `<div class="an-table">${tableHtml}</div>` : ''}
    </section>`;
  const empty = (msg, hint = '') => `<div class="an-empty">${icon('analytics')}<b>${esc(msg)}</b>${hint ? `<span>${hint}</span>` : ''}</div>`;
  const chartBox = (spec, cls = '') => {
    const id = reg(spec);
    spec.id = id;
    return `<div class="an-svg ${cls}" data-chart="${id}"></div>`;
  };

  // Ranked horizontal bars (RTL: they grow from the right).
  function hbars(rows, { label, value, valueHtml, sub, tip, max, key = 'k1', rank = true }) {
    const id = reg({ tip: (i) => tip(rows[i], i) });
    const top = max ?? Math.max(...rows.map(value), 1);
    return `<ol class="an-hbars${rank ? ' ranked' : ''}">${rows
      .map((r, i) => {
        const w = top > 0 ? Math.max(0, (value(r) / top) * 100) : 0;
        return `<li class="an-hb" data-ac="${id}" data-ai="${i}" tabindex="0">
          ${rank ? `<span class="an-rank num">${i + 1}</span>` : ''}
          <span class="an-hb-label" title="${esc(label(r))}">${esc(label(r))}${sub ? `<small>${sub(r)}</small>` : ''}</span>
          <span class="an-hb-val">${valueHtml ? valueHtml(r) : num(value(r))}</span>
          <span class="an-hb-track"><span class="an-hb-fill ${key}" style="width:${w.toFixed(2)}%"></span></span>
        </li>`;
      })
      .join('')}</ol>`;
  }

  const kpi = ({ label, value, ico, change, prev, prevFmt = fmt, hint = '', accent = false }) => `<div class="card kpi an-kpi${accent ? ' accent' : ''}">
      <div class="label"><span class="k-ico">${icon(ico)}</span>${esc(label)}</div>
      <div class="value">${value}</div>
      <div class="hint">${prev != null ? `${delta(change)}<span class="an-prev">الفترة السابقة: <span class="num">${prevFmt(prev)}</span></span>` : hint}</div>
    </div>`;

  // ---------- the page ----------

  function view() {
    specs = new Map();
    seq = 0;
    onAfter(bind);
    const P = state.P;
    const f = state.filter;
    const cmp = A.comparePeriods(P, f);
    const { cur, prev, change, range } = cmp;
    const avgFmt = (n) => fmt(n);
    const kpis = `<div class="grid kpis an-kpis">
        ${kpi({ label: 'المبيعات', value: money(cur.sales), ico: 'sales', change: change?.sales, prev: prev?.sales, hint: periodHtml(), accent: true })}
        ${kpi({ label: 'عدد الفواتير', value: num(cur.invoices), ico: 'receipt', change: change?.invoices, prev: prev?.invoices })}
        ${kpi({ label: 'متوسط الفاتورة', value: money(cur.avg), ico: 'cash', change: change?.avg, prev: prev?.avg, prevFmt: avgFmt })}
        ${kpi({ label: 'إجمالي الربح', value: money(cur.gross), ico: 'profit', change: change?.gross, prev: prev?.gross, hint: cur.sales ? `نسبة الربح ${pctText(cur.sales - cur.unknown ? cur.gross / (cur.sales - cur.unknown) : 0)}` : '' })}
        ${kpi({ label: 'الوحدات المبيعة', value: num(cur.units), ico: 'stock', change: change?.units, prev: prev?.units, hint: 'بوحدة البيع في كل سطر' })}
      </div>
      <p class="muted an-note">${range
        ? `المقارنة مع الفترة السابقة بالطول نفسه: <span class="num">${range.from}</span> إلى <span class="num">${range.to}</span>.`
        : 'اختر فترة محددة (اليوم، آخر 7 أيام، هذا الشهر…) لعرض المقارنة مع الفترة السابقة.'}</p>`;

    if (!cur.invoices) {
      const last = P.lastDate ? `آخر يوم فيه مبيعات: <span class="num">${P.lastDate}</span>. اختر فترة أخرى من الأعلى.` : 'لم تُسجَّل أي مبيعات بعد.';
      return `<div class="an">${kpis}<div class="card an-card">${empty('لا توجد مبيعات في هذه الفترة', last)}</div></div>`;
    }

    return `<div class="an">${kpis}
      ${trendCard(P, f)}
      <div class="an-grid">${hoursCard(P, f, cur)}${weekdayCard(P, f)}</div>
      <div class="an-grid"><div class="an-stackcol">${customersCard(P, f)}${usersCard(P, f)}</div>${itemsCard(P, f)}</div>
      <div class="an-grid">${categoriesCard(P, f)}${cashCard(cur)}</div>
    </div>`;
  }

  function trendCard(P, f) {
    const tr = A.salesTrend(P, f);
    const hasPrev = !!tr.prev && tr.points.some((p) => p.prev != null);
    const modeText = { hour: 'حسب الساعة', day: 'يومياً', month: 'شهرياً' }[tr.mode];
    const fmtX = tr.mode === 'day' ? (s) => s.slice(5) : (s) => s;
    const tip = (i) => {
      const p = tr.points[i];
      const rows = [{ key: 'k1', value: fmt(p.cur), label: 'هذه الفترة' }];
      if (hasPrev && p.prev != null) rows.push({ key: 'kp', value: fmt(p.prev), label: `الفترة السابقة${p.prevLabel ? ` (\u2066${p.prevLabel}\u2069)` : ''}` });
      const ch = hasPrev ? A.pctChange(p.cur, p.prev) : null;
      return { title: tr.mode === 'hour' ? `الساعة ${p.label}` : p.label, rows, note: ch == null ? '' : `التغيّر عن الفترة السابقة: \u2066${ch >= 0 ? '+' : '−'}${Math.abs(ch * 100).toFixed(1)}%\u2069` };
    };
    const legend = hasPrev
      ? `<div class="an-legend"><span><i class="an-lkey k1"></i>هذه الفترة</span><span><i class="an-lkey kp"></i>الفترة السابقة: <span class="num">${tr.prev.from}</span> إلى <span class="num">${tr.prev.to}</span></span></div>`
      : '';
    const total = tr.points.reduce((a, p) => a + p.cur, 0);
    const best = tr.points.reduce((b, p) => (p.cur > b.cur ? p : b), tr.points[0]);
    const tableHtml = table(tr.points, [
      { key: 'label', label: tr.mode === 'hour' ? 'الساعة' : tr.mode === 'month' ? 'الشهر' : 'اليوم', html: (r) => `<span class="num">${esc(r.label)}</span>` },
      { key: 'cur', label: 'هذه الفترة', money: true, total: true },
      ...(hasPrev ? [{ key: 'prev', label: 'الفترة السابقة', money: true, total: true }] : []),
    ], { name: 'اتجاه المبيعات' });
    return card({
      title: 'اتجاه المبيعات',
      sub: `${modeText} — <span class="num">${tr.from}</span>${tr.from !== tr.to ? ` إلى <span class="num">${tr.to}</span>` : ''}${best?.cur ? ` · الأعلى: <span class="num">${esc(best.label)}</span> (${num(best.cur)})` : ''}`,
      tools: legend,
      body: chartBox({ draw: drawLine, points: tr.points, hasPrev, mode: tr.mode, fmtX, tip, aria: `المبيعات ${modeText}، المجموع ${fmt(total)}` }, 'an-trend'),
      tableHtml,
      cls: 'an-wide',
    });
  }

  function hoursCard(P, f, cur) {
    const hrs = A.salesByHour(P, f);
    const peak = hrs.reduce((b, h) => (h.total > b.total ? h : b), hrs[0]);
    const hh = (h) => String(h).padStart(2, '0') + ':00';
    // isolated LTR so the range never flips inside Arabic text
    const span = (h) => `\u2066${hh(h)}–${hh((h + 1) % 24)}\u2069`;
    const tip = (i) => ({
      title: `الساعة ${span(i)}`,
      rows: [{ key: i === peak.hour ? 'k1' : 'kd', value: fmt(hrs[i].total), label: `المبيعات — ${fmt(hrs[i].count)} فاتورة` }],
      note: i === peak.hour ? 'ساعة الذروة' : cur.sales ? `${pctText(hrs[i].total / cur.sales)} من مبيعات الفترة` : '',
    });
    return card({
      title: 'ساعات الذروة',
      sub: `المبيعات حسب ساعة تسجيل الفاتورة`,
      tools: peak.total ? `<span class="an-badge">${icon('analytics')}ساعة الذروة <b class="num">${span(peak.hour)}</b></span>` : '',
      body: chartBox({
        draw: drawCols, data: hrs, emph: peak.total ? peak.hour : null, mark: peak.total ? peak.hour : -1, tip,
        title: 'المبيعات حسب الساعة', aria: (p) => `${hh(p.hour)}: ${fmt(p.total)}`,
        label: (p) => String(p.hour).padStart(2, '0'), labelGap: 34, shortBelow: 0,
      }) + (peak.total ? `<p class="an-foot"><i class="an-sw k1"></i>ساعة الذروة <span class="num">${span(peak.hour)}</span>: ${num(peak.total)} — ${pctText(cur.sales ? peak.total / cur.sales : 0)} من مبيعات الفترة، ${fmt(peak.count)} فاتورة</p>` : ''),
      tableHtml: table(hrs.filter((h) => h.count), [
        { key: 'hour', label: 'الساعة', html: (r) => `<span class="num">${span(r.hour)}</span>`, csv: (r) => span(r.hour) },
        { key: 'count', label: 'الفواتير', num: true, total: true },
        { key: 'total', label: 'المبيعات', money: true, total: true },
      ], { name: 'المبيعات حسب الساعة' }),
    });
  }

  function weekdayCard(P, f) {
    const wd = A.salesByWeekday(P, f);
    const best = wd.reduce((b, d) => (d.total > b.total ? d : b), wd[0]);
    const SHORT = ['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'];
    const total = wd.reduce((a, d) => a + d.total, 0);
    const tip = (i) => ({
      title: wd[i].name,
      rows: [{ key: 'k1', value: fmt(wd[i].total), label: `المبيعات — ${fmt(wd[i].count)} فاتورة` }],
      note: total ? `${pctText(wd[i].total / total)} من مبيعات الفترة` : '',
    });
    return card({
      title: 'المبيعات حسب أيام الأسبوع',
      sub: best.total ? `أفضل يوم: <b>${best.name}</b> (${num(best.total)})` : '',
      body: chartBox({
        draw: drawCols, data: wd, emph: null, mark: best.total ? best.day : -1, tip,
        title: 'المبيعات حسب أيام الأسبوع', aria: (p) => `${p.name}: ${fmt(p.total)}`,
        label: (p) => p.name, shortLabel: (p) => SHORT[p.day], labelGap: 20, shortBelow: 58,
      }),
      tableHtml: table(wd, [
        { key: 'name', label: 'اليوم', get: (r) => r.day, html: (r) => esc(r.name), csv: (r) => r.name },
        { key: 'count', label: 'الفواتير', num: true, total: true },
        { key: 'total', label: 'المبيعات', money: true, total: true },
      ], { name: 'المبيعات حسب أيام الأسبوع' }),
    });
  }

  function customersCard(P, f) {
    const tc = A.topCustomers(P, f, 10);
    const tip = (r) => ({
      title: r.name,
      rows: [{ key: 'k1', value: fmt(r.total), label: `المبيعات — ${fmt(r.count)} فاتورة` }],
      note: tc.total ? `${pctText(r.total / tc.total)} من مبيعات الفترة` : '',
    });
    const cashLine = tc.cashCount
      ? `<p class="an-foot"><i class="an-sw kd"></i>مبيعات «${A.CASH_CUSTOMER}» (بلا اسم): ${num(tc.cashTotal)} — ${fmt(tc.cashCount)} فاتورة، ${pctText(tc.total ? tc.cashTotal / tc.total : 0)} من المبيعات</p>`
      : '';
    return card({
      title: 'أفضل العملاء',
      sub: `الأعلى مبيعاً (نقدي وآجل) — عدد العملاء المسجّلين: ${num(tc.customers)}`,
      body: (tc.list.length ? hbars(tc.list, { label: (r) => r.name, value: (r) => r.total, sub: (r) => `${fmt(r.count)} فاتورة`, tip }) : empty('لا توجد مبيعات لعملاء مسجّلين في هذه الفترة')) + cashLine,
      tableHtml: tc.list.length
        ? table(tc.list, [
          { key: 'name', label: 'العميل' },
          { key: 'count', label: 'الفواتير', num: true },
          { key: 'total', label: 'المبيعات', money: true, total: true },
        ], { name: 'أفضل العملاء' })
        : '',
    });
  }

  function itemsCard(P, f) {
    const ip = A.itemProfit(P, f);
    const byRev = [...ip.items].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    const byProfit = [...ip.items].sort((a, b) => b.profit - a.profit).slice(0, 10);
    const qty = (r) => `${fmt(r.big)} ${r.unitL1}${r.small ? ` + ${fmt(r.small)} ${r.unitL2}` : ''}`;
    const tip = (r) => ({
      title: r.item,
      rows: [
        { key: itemsMode === 'rev' ? 'k1' : 'kd', value: fmt(r.revenue), label: 'المبيعات' },
        { key: itemsMode === 'profit' ? 'k1' : 'kd', value: fmt(r.profit), label: `الربح — ${pctText(r.margin)}` },
      ],
      note: `الكمية: ${qty(r)}`,
    });
    const tools = `<div class="chips an-chips" role="tablist">
        <button type="button" class="chip${itemsMode === 'rev' ? ' on' : ''}" data-an-items="rev" role="tab" aria-selected="${itemsMode === 'rev'}">حسب المبيعات</button>
        <button type="button" class="chip${itemsMode === 'profit' ? ' on' : ''}" data-an-items="profit" role="tab" aria-selected="${itemsMode === 'profit'}">حسب الربح</button>
      </div>`;
    const list = (rows, val) => (rows.length ? hbars(rows, { label: (r) => r.item, value: val, valueHtml: (r) => num(val(r)), sub: (r) => esc(r.cls), tip }) : empty('لا توجد مبيعات'));
    return card({
      title: 'أفضل الأصناف',
      sub: `عدد الأصناف المبيعة: ${num(ip.items.length)}`,
      tools,
      body: `<div data-an-list="rev"${itemsMode === 'rev' ? '' : ' hidden'}>${list(byRev, (r) => r.revenue)}</div>
        <div data-an-list="profit"${itemsMode === 'profit' ? '' : ' hidden'}>${list(byProfit, (r) => r.profit)}</div>`,
      tableHtml: table(ip.items, [
        { key: 'item', label: 'الصنف' },
        { key: 'revenue', label: 'المبيعات', money: true, total: true },
        { key: 'profit', label: 'الربح', money: true, total: true },
        { key: 'margin', label: 'نسبة الربح', get: (r) => r.margin, html: (r) => `<span class="num">${pctText(r.margin)}</span>`, csv: (r) => pctText(r.margin) },
      ], { name: 'الأصناف', sort: { key: itemsMode === 'rev' ? 'revenue' : 'profit', dir: -1 } }),
    });
  }

  function categoriesCard(P, f) {
    const cp = A.categoryProfit(P, f);
    const tip = (r) => ({
      title: r.cls,
      rows: [
        { key: 'k1', value: pctText(r.share), label: 'من المبيعات' },
        { key: 'kd', value: fmt(r.revenue), label: 'المبيعات' },
        { key: 'kd', value: fmt(r.profit), label: `الربح — ${pctText(r.margin)}` },
      ],
    });
    return card({
      title: 'حصص الفئات',
      sub: 'نسبة كل فئة من مبيعات الفترة',
      body: cp.cats.length
        ? hbars(cp.cats, { label: (r) => r.cls, value: (r) => r.share, max: Math.max(...cp.cats.map((c) => c.share)), valueHtml: (r) => `<span class="num">${pctText(r.share)}</span>`, sub: (r) => `<span class="num">${fmt(r.revenue)}</span>`, tip, rank: false })
        : empty('لا توجد مبيعات'),
      tableHtml: table(cp.cats, [
        { key: 'cls', label: 'الفئة' },
        { key: 'revenue', label: 'المبيعات', money: true, total: true },
        { key: 'share', label: 'الحصة', get: (r) => r.share, html: (r) => `<span class="num">${pctText(r.share)}</span>`, csv: (r) => pctText(r.share) },
      ], { name: 'حصص الفئات' }),
    });
  }

  function cashCard(cur) {
    const P = state.P;
    const list = A.saleList(P, state.filter);
    const parts = [
      { name: 'نقدي', key: 'k1', total: cur.cash, count: list.filter((s) => s.type === ctx.C.CASH).length },
      { name: 'آجل', key: 'k2', total: cur.credit, count: list.filter((s) => s.type === ctx.C.CREDIT).length },
    ];
    const all = cur.sales || 1;
    const id = reg({
      tip: (i) => ({ title: parts[i].name, rows: [{ key: parts[i].key, value: fmt(parts[i].total), label: `${pctText(parts[i].total / all)} — ${fmt(parts[i].count)} فاتورة` }] }),
    });
    const segs = parts
      .filter((p) => p.total > 0)
      .map((p) => {
        const share = p.total / all;
        const i = parts.indexOf(p);
        return `<span class="an-seg ${p.key}" style="flex:${share.toFixed(4)} 1 0" data-ac="${id}" data-ai="${i}" tabindex="0" aria-label="${p.name}: ${pctText(share)}">${share >= 0.16 ? `<span class="num">${pctText(share)}</span>` : ''}</span>`;
      })
      .join('');
    const legend = parts
      .map((p, i) => `<li data-ac="${id}" data-ai="${i}" tabindex="0"><i class="an-sw ${p.key}"></i><span class="an-split-name">${p.name}</span>
          <b class="num">${fmt(p.total)}</b><span class="an-split-pct num">${pctText(p.total / all)}</span><small>${fmt(p.count)} فاتورة</small></li>`)
      .join('');
    return card({
      title: 'نقدي وآجل',
      sub: 'توزيع مبيعات الفترة حسب نوع الفاتورة',
      body: `<div class="an-split"><div class="an-stack" role="img" aria-label="نقدي ${pctText(cur.cash / all)}، آجل ${pctText(cur.credit / all)}">${segs}</div>
        <ul class="an-split-legend">${legend}</ul></div>`,
    });
  }

  function usersCard(P, f) {
    const users = A.salesByUser(P, f);
    const total = users.reduce((a, u) => a + u.total, 0);
    const tip = (r) => ({
      title: r.user,
      rows: [{ key: 'k1', value: fmt(r.total), label: `المبيعات — ${fmt(r.count)} فاتورة` }],
      note: total ? `${pctText(r.total / total)} من مبيعات الفترة` : '',
    });
    return card({
      title: 'المبيعات حسب الكاشير',
      sub: `عدد المستخدمين الذين سجّلوا مبيعات: ${num(users.length)}`,
      body: users.length ? hbars(users, { label: (r) => r.user, value: (r) => r.total, sub: (r) => `${fmt(r.count)} فاتورة · متوسط ${fmt(r.count ? r.total / r.count : 0)}`, tip, rank: false }) : empty('لا توجد مبيعات'),
      tableHtml: table(users, [
        { key: 'user', label: 'الكاشير' },
        { key: 'count', label: 'الفواتير', num: true, total: true },
        { key: 'total', label: 'المبيعات', money: true, total: true },
      ], { name: 'المبيعات حسب الكاشير' }),
    });
  }

  // ---------- after the HTML is in the page ----------

  function bind() {
    hideTip();
    const root = $('#main .an');
    if (!root) return;
    ro?.disconnect();
    drawAll();
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver((entries) => entries.forEach((en) => drawOne(en.target)));
      $$('#main .an-svg[data-chart]').forEach((el) => ro.observe(el));
    }
    root.onclick = (e) => {
      const t = e.target.closest('[data-an-toggle]');
      if (t) {
        const c = t.closest('.an-card');
        const on = c.classList.toggle('show-table');
        t.setAttribute('aria-pressed', on);
        t.querySelector('span').textContent = on ? 'مخطط' : 'جدول';
        t.title = on ? 'عرض المخطط' : 'عرض البيانات كجدول';
        hideTip();
        if (!on) c.querySelectorAll('.an-svg[data-chart]').forEach(drawOne);
        return;
      }
      const m = e.target.closest('[data-an-items]');
      if (m) {
        itemsMode = m.dataset.anItems;
        store.set('fr3oon-analytics-items', itemsMode);
        const c = m.closest('.an-card');
        c.querySelectorAll('[data-an-items]').forEach((b) => {
          b.classList.toggle('on', b === m);
          b.setAttribute('aria-selected', b === m);
        });
        c.querySelectorAll('[data-an-list]').forEach((l) => (l.hidden = l.dataset.anList !== itemsMode));
      }
    };
  }

  return { view };
}
