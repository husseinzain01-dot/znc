// سجل العمليات (managers only): who did what and when — every save, delete,
// sign-in and change of settings, as the helper logged it (server.ps1:
// Add-OpActivity, Get-Activity). The range is this screen's own; the log is
// fetched again when it changes and filtered here otherwise.

// The action keys of server.ps1 ($ActivityNames), in groups.
const GROUPS = [
  ['sales', 'المبيعات', (a) => /Sale/.test(a) || a === 'price_change'],
  ['purchases', 'المشتريات', (a) => /Purchase/.test(a)],
  ['vouchers', 'السندات', (a) => /Receipt|Payment/.test(a)],
  ['people', 'العملاء والموردون', (a) => /Customer|Supplier/.test(a)],
  ['items', 'الأصناف', (a) => /Item(?!Codes)/.test(a)],
  ['stock', 'الجرد والباركود', (a) => /StockCount|ItemCodes/.test(a)],
  ['login', 'الدخول', (a) => /^(login|login_failed|logout|password)$/.test(a)],
  ['system', 'الإعدادات والنظام', () => true],
];
const groupOf = (a) => GROUPS.find(([, , test]) => test(a))[0];

// The tiles: each one also filters the list when clicked.
const KINDS = [
  ['all', 'عمليات', 'activity', () => true, 'كل ما سُجّل في الفترة'],
  ['delete', 'حذف', 'trash', (a) => a.startsWith('delete') || a === 'user_delete', 'فواتير وسندات وبيانات'],
  ['edit', 'تعديل', 'edit', (a) => a.endsWith('_edit'), 'فواتير وسندات وبيانات محفوظة'],
  ['price', 'بيع بسعر مختلف', 'receipt', (a) => a === 'price_change', 'سعر غير سعر بطاقة الصنف'],
  ['failed', 'محاولات دخول فاشلة', 'logout', (a) => a === 'login_failed', 'كلمة مرور خاطئة أو حساب موقوف'],
];

const RANGES = [
  ['today', 'اليوم'],
  ['yesterday', 'أمس'],
  ['week', 'آخر 7 أيام'],
  ['month', 'هذا الشهر'],
];

const PAGE = 300;

// Arabic counted nouns: [one, two, 3–10, 11 and more].
function counted(n, [one, two, few, many]) {
  const f = n.toLocaleString('en-US');
  if (n === 1) return one;
  if (n === 2) return two;
  if (n % 100 >= 3 && n % 100 <= 10) return `${f} ${few}`;
  return `${f} ${many}`;
}
// The avatar letter: the first letter of the name, after a leading «ال».
const initial = (name) => {
  const s = String(name || '?').trim();
  return (s.length > 3 && s.startsWith('ال') ? s.slice(2) : s).charAt(0) || '?';
};

export function setupActivity(ctx) {
  const { $, $$, esc, api, toast, icon, onAfter, localDay, addDays, state: app } = ctx;

  const st = {
    preset: 'week',
    from: '',
    to: '',
    data: null, // { rows, limit }
    key: '', // from|to of data
    at: 0, // when it was fetched
    loading: false,
    error: '',
    seq: 0,
    user: '',
    group: '',
    kind: 'all',
    warn: false,
    q: '',
    shown: PAGE,
    open: new Set(),
  };

  function setPreset(p) {
    const today = localDay();
    const r = {
      today: [today, today],
      yesterday: [addDays(today, -1), addDays(today, -1)],
      week: [addDays(today, -6), today],
      month: [today.slice(0, 8) + '01', today],
    }[p];
    if (!r) return;
    st.preset = p;
    [st.from, st.to] = r;
  }
  setPreset('week');

  const rangeKey = () => `${st.from}|${st.to}`;

  async function fetchLog({ quiet = false } = {}) {
    const seq = ++st.seq;
    const key = rangeKey();
    st.loading = true;
    st.error = '';
    if (!quiet) draw();
    else drawStatus();
    try {
      const j = await api('/api/activity', { method: 'POST', body: { from: st.from, to: st.to } });
      if (seq !== st.seq) return;
      st.data = { rows: Array.isArray(j.rows) ? j.rows : [], limit: j.limit || 5000 };
      st.key = key;
      st.at = Date.now();
    } catch (e) {
      if (seq !== st.seq) return;
      st.error = e.message || 'تعذّر تحميل السجل';
      // never show another range's rows under this one
      if (st.key !== key) st.data = null;
      if (quiet) toast(st.error, true);
    } finally {
      if (seq === st.seq) {
        st.loading = false;
        draw();
      }
    }
  }

  // ---------------------------------------------------------------- filters

  const rows = () => st.data?.rows || [];
  const kindTest = (k) => KINDS.find(([id]) => id === k)[3];

  function filtered({ group = st.group, kind = st.kind } = {}) {
    const q = st.q.trim();
    const test = kindTest(kind);
    return rows().filter(
      (r) =>
        (!st.user || r.user === st.user) &&
        (!group || groupOf(r.action) === group) &&
        test(r.action) &&
        (!st.warn || r.warn) &&
        (!q || [r.user, r.label, r.target, r.details].some((v) => String(v || '').includes(q))),
    );
  }

  const anyFilter = () => st.user || st.group || st.kind !== 'all' || st.warn || st.q.trim();

  // ---------------------------------------------------------------- view

  function view() {
    onAfter(bind);
    return `<div class="act">
      <div class="card act-bar">
        <div class="act-range">
          <div class="chips" id="actPresets">${RANGES.map(([id, label]) => `<button type="button" class="chip${st.preset === id ? ' on' : ''}" data-p="${id}">${label}</button>`).join('')}</div>
          <div class="act-dates">
            <label>من <input type="date" id="actFrom" value="${st.from}"></label>
            <label>إلى <input type="date" id="actTo" value="${st.to}"></label>
            <button class="btn small" id="actReload" title="تحديث السجل">${icon('refresh')}<span>تحديث</span></button>
          </div>
        </div>
        <div class="act-filters">
          <label class="act-search">${icon('search')}<input type="search" id="actQ" placeholder="ابحث في السجل: رقم فاتورة، اسم، صنف…" value="${esc(st.q)}"></label>
          <select id="actUser" aria-label="المستخدم"></select>
          <label class="check act-warn"><input type="checkbox" id="actWarn"${st.warn ? ' checked' : ''}> التنبيهات فقط</label>
        </div>
        <div class="chips act-groups" id="actGroups"></div>
      </div>
      <div id="actOut"></div>
    </div>`;
  }

  function bind() {
    const stale = st.key !== rangeKey() || Date.now() - st.at > 60000;
    draw();
    if (stale && !st.loading) fetchLog({ quiet: !!st.data && st.key === rangeKey() });

    $('#actPresets').onclick = (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      setPreset(b.dataset.p);
      $('#actFrom').value = st.from;
      $('#actTo').value = st.to;
      changedRange();
    };
    const onDate = () => {
      let f = $('#actFrom').value, t = $('#actTo').value;
      if (!f || !t) return;
      if (f > t) [f, t] = [t, f];
      st.from = f;
      st.to = t;
      st.preset = Object.keys({ today: 1, yesterday: 1, week: 1, month: 1 }).find((p) => {
        const keep = [st.from, st.to];
        setPreset(p);
        const same = st.from === keep[0] && st.to === keep[1];
        [st.from, st.to] = keep;
        return same;
      }) || '';
      changedRange();
    };
    $('#actFrom').onchange = onDate;
    $('#actTo').onchange = onDate;
    $('#actReload').onclick = () => fetchLog({ quiet: !!st.data && st.key === rangeKey() });
    $('#actQ').oninput = (e) => {
      st.q = e.target.value;
      st.shown = PAGE;
      drawResults();
    };
    $('#actUser').onchange = (e) => {
      st.user = e.target.value;
      st.shown = PAGE;
      drawResults();
    };
    $('#actWarn').onchange = (e) => {
      st.warn = e.target.checked;
      st.shown = PAGE;
      drawResults();
    };
    $('#actGroups').onclick = (e) => {
      const b = e.target.closest('[data-g]');
      if (!b) return;
      st.group = b.dataset.g;
      st.shown = PAGE;
      drawResults();
    };
    $('#actOut').onclick = onOutClick;
  }

  function changedRange() {
    $$('#actPresets .chip').forEach((b) => b.classList.toggle('on', b.dataset.p === st.preset));
    st.shown = PAGE;
    st.open.clear();
    fetchLog();
  }

  function onOutClick(e) {
    const tile = e.target.closest('[data-kind]');
    if (tile) {
      st.kind = st.kind === tile.dataset.kind ? 'all' : tile.dataset.kind;
      st.shown = PAGE;
      drawResults();
      return;
    }
    const more = e.target.closest('[data-more]');
    if (more) {
      const id = more.dataset.more;
      const tr = more.closest('.act-row');
      const open = !st.open.has(id);
      if (open) st.open.add(id);
      else st.open.delete(id);
      tr.classList.toggle('open', open);
      more.textContent = open ? 'إخفاء التفاصيل' : more.dataset.label;
      more.setAttribute('aria-expanded', String(open));
      return;
    }
    if (e.target.closest('#actMoreRows')) {
      st.shown += PAGE * 2;
      drawResults();
      return;
    }
    if (e.target.closest('#actClear')) {
      Object.assign(st, { user: '', group: '', kind: 'all', warn: false, q: '', shown: PAGE });
      $('#actQ').value = '';
      $('#actWarn').checked = false;
      drawResults();
      return;
    }
    if (e.target.closest('#actRetry')) fetchLog();
    if (e.target.closest('#actCsv')) exportCsv();
    if (e.target.closest('#actPrint')) printLog();
  }

  // Draws everything below the range bar (and the user list / group chips,
  // which follow the rows).
  function draw() {
    if (app.view !== 'activity' || !$('#actOut')) return;
    drawResults();
  }

  function drawStatus() {
    const s = $('#actStatus');
    if (s) s.innerHTML = statusText();
  }
  const statusText = () =>
    st.loading ? `<span class="act-spin" aria-hidden="true"></span> جارٍ التحديث…` : st.at ? `حُدّث الساعة ${new Date(st.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '';

  function drawFilters() {
    const users = [...new Set(rows().map((r) => r.user).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
    if (st.user && !users.includes(st.user)) users.unshift(st.user);
    $('#actUser').innerHTML = `<option value="">كل المستخدمين</option>${users.map((u) => `<option${u === st.user ? ' selected' : ''}>${esc(u)}</option>`).join('')}`;
    const counts = {};
    for (const r of filtered({ group: '' })) counts[groupOf(r.action)] = (counts[groupOf(r.action)] || 0) + 1;
    const total = Object.values(counts).reduce((a, n) => a + n, 0);
    $('#actGroups').innerHTML = [['', 'كل الأنواع'], ...GROUPS.map(([id, label]) => [id, label])]
      .map(([id, label]) => {
        const n = id ? counts[id] || 0 : total;
        return `<button type="button" class="chip${st.group === id ? ' on' : ''}${n || id === st.group ? '' : ' act-zero'}" data-g="${id}">${label}${st.data ? ` <small>${n}</small>` : ''}</button>`;
      })
      .join('');
  }

  function drawResults() {
    if (!$('#actOut')) return;
    drawFilters();
    const out = $('#actOut');
    if (st.error && !st.data) {
      out.innerHTML = `<div class="card act-state"><div class="act-state-ico bad">${icon('checks')}</div><h3>تعذّر تحميل سجل العمليات</h3>
        <p class="muted">${esc(st.error)}</p><button class="btn primary" id="actRetry">${icon('refresh')} إعادة المحاولة</button></div>`;
      return;
    }
    if (!st.data || (st.loading && st.key !== rangeKey())) {
      out.innerHTML = `${kpisHtml(null)}<div class="table-wrap act-table act-loading" aria-busy="true">${'<div class="act-skel"><i></i><i></i><i></i><i></i></div>'.repeat(6)}</div>`;
      return;
    }
    const list = filtered();
    const limited = rows().length >= st.data.limit;
    out.innerHTML = `${kpisHtml(filtered({ kind: 'all' }))}
      ${limited ? `<p class="notice">${icon('checks')} بلغ السجل الحدّ الأقصى للعرض (${st.data.limit.toLocaleString('en-US')} عملية): تظهر أحدث العمليات فقط. اختر فترة أقصر لرؤية الأقدم.</p>` : ''}
      ${st.error ? `<p class="notice error">${esc(st.error)}</p>` : ''}
      <div class="section-head"><h2>العمليات <small class="muted act-count">${list.length.toLocaleString('en-US')}${list.length !== rows().length ? ` من ${rows().length.toLocaleString('en-US')}` : ''}</small></h2>
        <div class="tools"><span class="muted act-status" id="actStatus">${statusText()}</span>
          ${anyFilter() ? `<button class="btn small" id="actClear">مسح الفلاتر</button>` : ''}
          <button class="btn small" id="actCsv"${list.length ? '' : ' disabled'}>Excel</button>
          <button class="btn small" id="actPrint"${list.length ? '' : ' disabled'}>طباعة</button></div></div>
      ${list.length ? tableHtml(list) : emptyHtml()}`;
  }

  function kpisHtml(list) {
    return `<div class="grid kpis act-kpis">${KINDS.map(([id, label, ic, test, hint]) => {
      const n = list ? list.filter((r) => test(r.action)).length : null;
      const alert = id !== 'all' && n > 0;
      const users = id === 'all' && list ? new Set(list.map((r) => r.user)).size : 0;
      return `<button type="button" class="card kpi act-kpi${st.kind === id && id !== 'all' ? ' on' : ''}${alert ? ' alert' : ''}" data-kind="${id}"${list ? '' : ' disabled'}
          aria-pressed="${st.kind === id}" title="${id === 'all' ? 'عرض كل العمليات' : 'عرض هذه العمليات فقط'}">
        <div class="label"><span class="k-ico">${icon(ic)}</span>${label}</div>
        <div class="value">${n == null ? '<span class="act-dash">—</span>' : `<span class="num">${n.toLocaleString('en-US')}</span>`}</div>
        <div class="hint">${id === 'all' && list ? `${counted(users, ['مستخدم واحد', 'مستخدمان', 'مستخدمين', 'مستخدماً'])} في الفترة` : hint}</div>
      </button>`;
    }).join('')}</div>`;
  }

  function emptyHtml() {
    const none = !rows().length;
    return `<div class="card act-state"><div class="act-state-ico">${icon('activity')}</div>
      <h3>${none ? 'لا توجد عمليات في هذه الفترة' : 'لا توجد عمليات تطابق الفلاتر'}</h3>
      <p class="muted">${none ? 'يُسجَّل كل حفظ وحذف وتسجيل دخول تلقائياً. اختر فترة أخرى.' : 'غيّر الفلاتر أو امسحها لرؤية كل عمليات الفترة.'}</p>
      ${none ? '' : '<button class="btn" id="actClear">مسح الفلاتر</button>'}</div>`;
  }

  const dayName = (iso) => {
    const today = localDay();
    const d = new Date(iso + 'T12:00:00');
    const name = isNaN(d) ? iso : d.toLocaleDateString('ar-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return iso === today ? `اليوم — ${name}` : iso === addDays(today, -1) ? `أمس — ${name}` : name;
  };

  function tableHtml(list) {
    const shown = list.slice(0, st.shown);
    let day = '';
    let body = '';
    for (const r of shown) {
      const d = String(r.at || '').slice(0, 10);
      if (d !== day) {
        day = d;
        const n = list.filter((x) => String(x.at || '').startsWith(d)).length;
        body += `<tr class="act-day"><td colspan="5"><div><b>${esc(dayName(d))}</b><span class="muted">${counted(n, ['عملية واحدة', 'عمليتان', 'عمليات', 'عملية'])}</span></div></td></tr>`;
      }
      const lines = String(r.details || '').split(/\r?\n/).filter((l) => l.trim());
      const id = String(r.id);
      const open = st.open.has(id);
      const moreLabel = lines.length > 1 ? '+ ' + counted(lines.length - 1, ['سطر آخر', 'سطران آخران', 'أسطر أخرى', 'سطراً آخر']) : '';
      body += `<tr class="act-row${r.warn ? ' warn' : ''}${open ? ' open' : ''}">
        <td class="act-time"><span class="num">${esc(String(r.at || '').slice(11, 16))}</span></td>
        <td class="act-user"><span class="act-av" aria-hidden="true">${esc(initial(r.user))}</span><span>${esc(r.user || '—')}</span></td>
        <td class="act-action"><span class="pill ${r.warn ? 'bad' : pillFor(r.action)}">${r.warn ? '⚠ ' : ''}${esc(r.label || r.action)}</span></td>
        <td class="act-target">${esc(r.target || '')}</td>
        <td class="act-details">${lines.length ? `<div class="act-first">${esc(lines[0])}</div>${lines.length > 1 ? `<div class="act-rest">${lines.slice(1).map((l) => `<div>${esc(l)}</div>`).join('')}</div>
          <button type="button" class="act-more" data-more="${esc(id)}" data-label="${moreLabel}" aria-expanded="${open}">${open ? 'إخفاء التفاصيل' : moreLabel}</button>` : ''}` : '<span class="muted">—</span>'}</td>
      </tr>`;
    }
    return `<div class="table-wrap act-table"><table>
      <thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>المرجع</th><th>التفاصيل</th></tr></thead>
      <tbody>${body}</tbody></table></div>
      ${list.length > shown.length ? `<div class="act-more-rows"><span class="muted">يظهر ${shown.length.toLocaleString('en-US')} من ${list.length.toLocaleString('en-US')}</span>
        <button class="btn" id="actMoreRows">عرض المزيد</button></div>` : ''}`;
  }

  // calm colours for the everyday actions, red for the warnings
  function pillFor(a) {
    if (a === 'login' || a === 'logout') return 'muted-pill';
    if (/_new$/.test(a) || a === 'setItemCodes' || a === 'backup') return 'good';
    return 'info';
  }

  // ---------------------------------------------------------------- export

  const rangeText = () => (st.from === st.to ? st.from : `${st.from} إلى ${st.to}`);

  function exportCsv() {
    const list = filtered();
    const q = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [['التاريخ', 'الوقت', 'المستخدم', 'العملية', 'تنبيه', 'على', 'التفاصيل'].join(',')];
    for (const r of list) {
      lines.push([r.at.slice(0, 10), r.at.slice(11, 19), r.user, r.label || r.action, r.warn ? 'نعم' : '', r.target, r.details].map(q).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `سجل العمليات ${rangeText()}.csv`.replace(/[\\/:*?"<>|]/g, '-');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Prints what is shown, every detail line open, with the range and the
  // filters in a heading.
  function printLog() {
    const head = document.createElement('div');
    head.className = 'act-print-head';
    const parts = [
      st.user && `المستخدم: ${st.user}`,
      st.group && `النوع: ${GROUPS.find(([id]) => id === st.group)[1]}`,
      st.kind !== 'all' && KINDS.find(([id]) => id === st.kind)[1],
      st.warn && 'التنبيهات فقط',
      st.q.trim() && `بحث: ${st.q.trim()}`,
    ].filter(Boolean);
    head.innerHTML = `<b>سجل العمليات — ${esc(app.shopName || '')}</b><span>${esc(rangeText())}${parts.length ? ' — ' + esc(parts.join('، ')) : ''}</span>`;
    $('#actOut').prepend(head);
    document.body.classList.add('act-printing');
    window.print();
    document.body.classList.remove('act-printing');
    head.remove();
  }

  return { view };
}
