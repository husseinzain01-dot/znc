// Settings (managers only): shop name, users and what each may see and do,
// the data file, the system check and the backups folder. Stored by server.ps1 in
// %APPDATA%\LawhatAlMahal\config.json, so every user of this computer shares
// them and they survive updates.

import { databasePicker } from './picker.js';

// Same ids as $AllPerms in server.ps1, which checks them on every save.
const PERM_GROUPS = [
  ['الشاشات اللي يشوفها', [
    ['home', 'الرئيسية (ملخص اليوم)'],
    ['sales', 'المبيعات (كل القوائم)'],
    ['purchases', 'المشتريات'],
    ['customers', 'الزبائن وأرصدتهم'],
    ['suppliers', 'الموردين وأرصدتهم'],
    ['stock', 'المخزن والأسعار'],
    ['cash', 'الصندوق'],
    ['profit', 'الأرباح'],
    ['checks', 'ملاحظات البيانات'],
  ]],
  ['البيع', [
    ['sale_cash', 'بيع نقدي (شاشة البيع السريع)'],
    ['sale_credit', 'بيع آجل (على زبون)'],
    ['sale_wholesale', 'بيع جملة (بالوحدة الكبيرة)'],
    ['edit_price', 'تغيير السعر بالقائمة'],
    ['print', 'طباعة الوصل'],
    ['sale_edit', 'تعديل قوائم البيع'],
    ['sale_delete', 'مسح قوائم البيع'],
  ]],
  ['الإدخال', [
    ['purchase', 'قوائم شراء جديدة'],
    ['purchase_edit', 'تعديل ومسح قوائم الشراء'],
    ['receipt', 'وصل قبض'],
    ['payment', 'وصل دفع ومصاريف'],
    ['voucher_edit', 'تعديل ومسح الوصولات'],
    ['customer_add', 'إضافة زبون'],
    ['customer_edit', 'تعديل ومسح الزبائن'],
    ['supplier_manage', 'إضافة وتعديل الموردين'],
    ['item_manage', 'المواد والأسعار (إضافة وتعديل)'],
  ]],
];

// Same as $ImpliedBy in server.ps1: a screen comes with the work done on it.
const IMPLIED_BY = {
  sales: ['sale_edit', 'sale_delete'],
  purchases: ['purchase', 'purchase_edit'],
  customers: ['customer_add', 'customer_edit', 'receipt'],
  suppliers: ['supplier_manage'],
  stock: ['item_manage'],
  cash: ['payment', 'voucher_edit'],
};
const asList = (v) => (Array.isArray(v) ? v : Array.isArray(v?.value) ? v.value : v ? [String(v)] : []).map(String);

export const PRESETS = [
  ['cashier', 'كاشير نقدي — فاتورة البيع بس', ['pos', 'sale_cash', 'print']],
  ['cashier2', 'كاشير نقدي وآجل', ['pos', 'sale_cash', 'sale_credit', 'print', 'customers', 'receipt', 'customer_add']],
  ['wholesale', 'بائع جملة', ['pos', 'sale_cash', 'sale_credit', 'sale_wholesale', 'edit_price', 'print', 'customers', 'stock', 'receipt', 'customer_add']],
  ['accountant', 'محاسب', ['home', 'sales', 'purchases', 'customers', 'suppliers', 'stock', 'cash', 'profit', 'checks', 'print',
    'purchase', 'purchase_edit', 'receipt', 'payment', 'voucher_edit', 'customer_add', 'customer_edit', 'supplier_manage']],
];

export function setupSettings(ctx) {
  const { $, esc, api, state, toast, icon, onAfter, readServer, guarded, setupScreen, openModal, closeModal } = ctx;

  function view() {
    onAfter(load);
    return `<div class="settings">
      <div class="card">
        <h3>فحص النظام</h3>
        <p class="muted">يجرّب كل عمليات الحفظ (زبون، بيع، تعديل، قبض، دفع، شراء، مادة، مسح) على ملف البيانات الحقيقي داخل معاملة وحدة،
          وبعدين يلغيها كلها، فالملف يرجع مثل ما جان بالضبط. سوّيه أول مرة تنصّب البرنامج، وكل ما تغيّر الحاسبة أو الملف.</p>
        <button class="btn primary" id="stRun">${icon('check')} شغّل الفحص</button>
        <div id="stResult"></div>
      </div>
      <div class="card">
        <h3>اسم المحل</h3>
        <p class="muted">يطلع بأعلى البرنامج وبوصل الطباعة.</p>
        <div class="row"><input id="setShop" maxlength="60" style="flex:1;min-width:220px" class="search"><button class="btn primary" id="setShopSave">حفظ</button></div>
      </div>
      <div class="card">
        <h3>المستخدمين والصلاحيات</h3>
        <p class="muted">نفس مستخدمين حساباتي وكلمات السر مالتهم. <b>المدير</b> يسوّي كلشي ويدخل للإعدادات.
          الباقين يشوفون ويسوّون بس اللي تأشّره إلهم. اختار قالب جاهز، وبعدين تكدر تزيد أو تنقص.
          أي مستخدم ما أشّرتله شي: بيع نقدي وطباعة بس. إذا ما أشّرت أي أحد مدير، الكل مدراء.</p>
        <div id="setUsers" class="perm-users"><span class="muted">جاري التحميل…</span></div>
        <button class="btn primary" id="setUsersSave">${icon('save')} حفظ الصلاحيات</button>
      </div>
      <div class="card">
        <h3>ملف البيانات</h3>
        <p class="muted">الملف اللي يقرا ويكتب عليه البرنامج. محفوظ، وما ينطلب منك مرة ثانية.</p>
        <p><code id="setPath">…</code></p>
        <div class="row">
          <button class="btn" id="setChoose">${icon('file')} تغيير الملف</button>
          <button class="btn" id="setBackups">${icon('file')} فتح فولدر النسخ الاحتياطية</button>
        </div>
        <p class="muted" style="font-size:13px">قبل أول حفظ بكل يوم تنسوى نسخة من الملف بفولدر <code>backups-lawha</code> يمّه (آخر 30 نسخة).</p>
      </div>
      <div class="card">
        <h3>تنظيف البيانات</h3>
        <p class="muted">يدوّر على سجلات فارغة تماماً (بلا اسم ولا تاريخ ولا مادة) ممكن انكتبت من نسخ قديمة من البرنامج، ويمسحها.
          ما يلمس أي سجل بيه بيانات. تنسوى نسخة احتياطية قبل المسح.</p>
        <button class="btn" id="brCheck">${icon('search')} افحص</button>
        <div id="brResult"></div>
      </div>
      <div class="card">
        <h3>حول البرنامج</h3>
        <p class="muted" id="setAbout"></p>
      </div>
    </div>`;
  }

  async function load() {
    $('#stRun').onclick = run;
    $('#setShopSave').onclick = saveShop;
    $('#setUsersSave').onclick = saveUsers;
    $('#brCheck').onclick = () => broken(false);
    $('#setChoose').onclick = choose;
    $('#setBackups').onclick = async () => {
      try {
        const j = await api('/api/open-backups', { method: 'POST', body: {} });
        toast('الفولدر: ' + j.dir);
      } catch (e) {
        toast(e.message, true);
      }
    };
    try {
      const [s, u] = await Promise.all([api('/api/settings'), api('/api/users')]);
      $('#setShop').value = s.shopName || '';
      $('#setPath').textContent = s.dbPath || '—';
      $('#setAbout').innerHTML = `الإصدار ${esc(s.version)} — محرك الحفظ: ${esc(s.engine || 'يشتغل عند أول حفظ')}<br>الإعدادات والسجل: <code>${esc(s.dataDir)}</code>`;
      drawUsers(u.users || [], s);
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function run(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    $('#stResult').innerHTML = '<p class="muted">جاري الفحص… (ممكن ياخذ كم ثانية)</p>';
    try {
      const j = await api('/api/selftest', { method: 'POST', body: {} });
      const steps = j.steps || [];
      $('#stResult').innerHTML = `
        <p class="notice ${j.passed ? 'good' : 'error'}">${j.passed
          ? '✔ كل شي يشتغل. تكدر تعتمد على البرنامج بالحفظ.'
          : '✘ أكو مشكلة. صوّر هاي النتيجة ودزها.'}</p>
        <ul class="steps">${steps
          .map((s) => `<li class="${s.ok ? 'ok' : 'bad'}"><span class="mark">${s.ok ? '✔' : '✘'}</span><span>${esc(s.name)}</span><small>${esc(s.msg)}</small></li>`)
          .join('')}</ul>`;
    } catch (err) {
      $('#stResult').innerHTML = `<p class="notice error">${esc(err.message)}</p>`;
    } finally {
      btn.disabled = false;
    }
  }

  async function saveShop() {
    try {
      const j = await api('/api/settings', { method: 'POST', body: { shopName: $('#setShop').value.trim() } });
      state.shopName = j.shopName;
      document.title = j.shopName || 'لوحة المحل';
      $('#shopTitle').textContent = j.shopName || 'لوحة المحل';
      toast('انحفظ ✔');
    } catch (e) {
      toast(e.message, true);
    }
  }

  // One card per user: manager switch, a template, and the ticks.
  function drawUsers(users, s) {
    const admins = new Set(asList(s.admins));
    const perms = s.perms || {};
    const def = s.defaultPerms ? asList(s.defaultPerms) : ['pos', 'sale_cash', 'print'];
    const host = $('#setUsers');
    if (!users.length) {
      host.innerHTML = '<span class="muted">ماكو مستخدمين بحساباتي</span>';
      return;
    }
    host.innerHTML = users
      .map((n, k) => {
        const have = new Set(perms[n] ? asList(perms[n]) : def);
        const same = (list) => {
          const a = new Set(list.filter((x) => x !== 'pos'));
          const b = [...have].filter((x) => x !== 'pos');
          return a.size === b.length && b.every((x) => a.has(x));
        };
        const preset = admins.has(n) ? '' : PRESETS.find(([, , list]) => same(list))?.[0] || '';
        return `<details class="perm-user" data-user="${esc(n)}"${preset ? ` data-preset="${preset}"` : ''}${k === 0 ? ' open' : ''}>
          <summary><b>${esc(n)}</b><span class="perm-sum"></span></summary>
          <div class="perm-body">
            <div class="row" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <label class="check"><input type="checkbox" data-admin${admins.has(n) ? ' checked' : ''}> مدير (كلشي)</label>
              <select data-preset>
                <option value="">قالب جاهز…</option>
                ${PRESETS.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}
              </select>
            </div>
            <div class="perm-groups">${PERM_GROUPS.map(([g, list]) => `<fieldset><legend>${esc(g)}</legend>${list
              .map(([id, label]) => `<label class="check"><input type="checkbox" data-perm="${id}"${have.has(id) ? ' checked' : ''}> ${esc(label)}</label>`)
              .join('')}</fieldset>`).join('')}</div>
          </div>
        </details>`;
      })
      .join('');
    host.querySelectorAll('.perm-user').forEach(refreshUser);
    host.onchange = (e) => {
      const box = e.target.closest('.perm-user');
      if (!box) return;
      if (e.target.matches('[data-preset]') && e.target.value) {
        const p = new Set(PRESETS.find(([id]) => id === e.target.value)[2]);
        box.querySelectorAll('[data-perm]').forEach((c) => {
          delete c.dataset.implied;
          c.checked = p.has(c.dataset.perm);
        });
        box.dataset.preset = e.target.value;
        e.target.value = '';
      } else if (e.target.matches('[data-perm]')) {
        delete box.dataset.preset;
      }
      refreshUser(box);
    };
  }

  // The summary line, screens that come with a ticked action (ticked and
  // locked), and everything greyed out for a manager.
  function refreshUser(box) {
    const admin = box.querySelector('[data-admin]').checked;
    box.querySelector('.perm-groups').classList.toggle('off', admin);
    const own = (c) => c.checked && !c.dataset.implied;
    const actions = new Set([...box.querySelectorAll('[data-perm]')].filter(own).map((c) => c.dataset.perm));
    box.querySelectorAll('[data-perm]').forEach((c) => {
      const why = (IMPLIED_BY[c.dataset.perm] || []).filter((a) => actions.has(a));
      if (why.length && !admin) {
        if (!c.checked || c.dataset.implied) c.dataset.implied = '1';
        c.checked = true;
        c.disabled = true;
        c.parentElement.title = 'تنطي تلقائياً لأن عنده صلاحية تحتاج هاي الشاشة';
      } else {
        if (c.dataset.implied) c.checked = false;
        delete c.dataset.implied;
        c.disabled = admin;
        c.parentElement.title = '';
      }
    });
    const ticked = [...box.querySelectorAll('[data-perm]:checked')].map((c) => c.dataset.perm);
    const preset = PRESETS.find(([id]) => id === box.dataset.preset);
    const sells = [ticked.includes('sale_cash') && 'نقدي', ticked.includes('sale_credit') && 'آجل', ticked.includes('sale_wholesale') && 'جملة'].filter(Boolean);
    box.querySelector('.perm-sum').textContent = admin
      ? 'مدير'
      : preset
        ? preset[1]
        : ticked.length
          ? `${sells.length ? 'بيع ' + sells.join(' و') + ' — ' : ''}${ticked.length} صلاحية`
          : '⚠ ما يشوف أي شاشة';
  }

  async function saveUsers() {
    const boxes = [...document.querySelectorAll('#setUsers .perm-user')];
    const empty = boxes.filter((b) => !b.querySelector('[data-admin]').checked && !b.querySelector('[data-perm]:checked')).map((b) => b.dataset.user);
    if (empty.length && !confirm(`${empty.join('، ')} ما راح يشوف أي شاشة. تحفظ هيچ؟`)) return;
    const admins = boxes.filter((b) => b.querySelector('[data-admin]').checked).map((b) => b.dataset.user);
    const perms = {};
    for (const b of boxes) perms[b.dataset.user] = [...b.querySelectorAll('[data-perm]:checked')].map((c) => c.dataset.perm);
    try {
      await api('/api/settings', { method: 'POST', body: { admins, perms } });
      toast(admins.length ? 'انحفظ ✔ المدراء: ' + admins.join('، ') : 'انحفظ ✔ (ما أكو مدير، فالكل مدراء)');
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function broken(clean) {
    const out = $('#brResult');
    out.innerHTML = '<p class="muted">جاري الفحص…</p>';
    try {
      const j = await api('/api/broken', { method: 'POST', body: { clean } });
      const found = (j.rows || []).filter((r) => r.count > 0);
      if (clean) {
        out.innerHTML = `<p class="notice good">✔ انمسحت ${found.reduce((a, r) => a + r.count, 0)} سجلات فارغة.</p>`;
        await guarded(() => readServer());
        return;
      }
      out.innerHTML = found.length
        ? `<ul class="steps">${found.map((r) => `<li class="bad"><span class="mark">!</span><span>${esc(r.label)}</span><small>${r.count}</small></li>`).join('')}</ul>
           <button class="btn danger" id="brClean">${icon('trash')} امسحها</button>`
        : '<p class="notice good">✔ ماكو سجلات فارغة. البيانات نظيفة.</p>';
      if ($('#brClean')) {
        $('#brClean').onclick = () => {
          if (confirm('تمسح هاي السجلات الفارغة؟ (تنسوى نسخة احتياطية قبلها)')) broken(true);
        };
      }
    } catch (e) {
      out.innerHTML = `<p class="notice error">${esc(e.message)}</p>`;
    }
  }

  function choose() {
    openModal('<h2>تغيير ملف البيانات</h2><div id="pickHost"></div>');
    databasePicker({ esc, api, icon }, $('#pickHost'), async (j) => {
      closeModal();
      toast('صار الملف: ' + j.file);
      await guarded(() => readServer());
    });
  }

  return { view, setupScreen };
}
