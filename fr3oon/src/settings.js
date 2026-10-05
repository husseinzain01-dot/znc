// Settings (managers only): the shop, its users and what each may see and
// do, backups, updates, the license, other devices, the database, and the
// checks. The shop's own settings and users are kept in the database; this
// computer's (folders, links) by the helper in %APPDATA%\Fr3oon.

import { verifyRun, verifyClean, readerFromTables } from './fulltest.js';
import { loadDatabase } from './load.js';
import * as C from './calc.js';

const APP = 'Fr3oon';

// Same ids as $AllPerms in server.ps1, which checks them on every save.
const PERM_GROUPS = [
  ['الشاشات المتاحة', [
    ['home', 'الرئيسية (ملخص اليوم)'],
    ['sales', 'المبيعات (جميع الفواتير)'],
    ['purchases', 'المشتريات'],
    ['customers', 'العملاء وأرصدتهم'],
    ['suppliers', 'الموردون وأرصدتهم'],
    ['stock', 'المخزون والأسعار'],
    ['cash', 'الصندوق'],
    ['profit', 'الأرباح'],
    ['checks', 'ملاحظات البيانات'],
  ]],
  ['البيع', [
    ['sale_cash', 'البيع النقدي (شاشة البيع السريع)'],
    ['sale_credit', 'البيع الآجل (على حساب عميل)'],
    ['sale_wholesale', 'البيع بالجملة (بالوحدة الكبيرة)'],
    ['edit_price', 'تغيير السعر في الفاتورة'],
    ['print', 'طباعة الإيصال'],
    ['sale_edit', 'تعديل فواتير البيع'],
    ['sale_delete', 'حذف فواتير البيع'],
  ]],
  ['الإدخال', [
    ['purchase', 'فواتير شراء جديدة'],
    ['purchase_edit', 'تعديل فواتير الشراء وحذفها'],
    ['receipt', 'سند قبض'],
    ['payment', 'سند صرف ومصروفات'],
    ['voucher_edit', 'تعديل السندات وحذفها'],
    ['customer_add', 'إضافة عميل'],
    ['customer_edit', 'تعديل العملاء وحذفهم'],
    ['supplier_manage', 'إضافة الموردين وتعديلهم'],
    ['item_manage', 'الأصناف والأسعار (إضافة وتعديل)'],
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
const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : []).map(String).filter(Boolean);

export const PRESETS = [
  ['cashier', 'كاشير نقدي — فاتورة البيع فقط', ['pos', 'sale_cash', 'print']],
  ['cashier2', 'كاشير نقدي وآجل', ['pos', 'sale_cash', 'sale_credit', 'print', 'customers', 'receipt', 'customer_add']],
  ['wholesale', 'بائع جملة', ['pos', 'sale_cash', 'sale_credit', 'sale_wholesale', 'edit_price', 'print', 'customers', 'stock', 'receipt', 'customer_add']],
  ['accountant', 'محاسب', ['home', 'sales', 'purchases', 'customers', 'suppliers', 'stock', 'cash', 'profit', 'checks', 'print',
    'purchase', 'purchase_edit', 'receipt', 'payment', 'voucher_edit', 'customer_add', 'customer_edit', 'supplier_manage']],
];

const SECTIONS = [
  ['shop', 'المحل'], ['users', 'المستخدمون'], ['backup', 'النسخ الاحتياطي'], ['updates', 'التحديثات'],
  ['license', 'الترخيص'], ['devices', 'الأجهزة الأخرى'], ['database', 'قاعدة البيانات'], ['checks', 'الفحص'],
];

export function setupSettings(ctx) {
  const { $, esc, api, state, toast, icon, onAfter, openModal, closeModal, localDay, openDbScreen, signedOut } = ctx;

  const remote = () => !['localhost', '127.0.0.1'].includes(location.hostname);
  const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
  const stepsHtml = (steps) =>
    `<ul class="steps">${steps
      .map((s) => `<li class="${s.ok ? 'ok' : 'bad'}"><span class="mark">${s.ok ? '✔' : '✘'}</span><span>${esc(s.name)}</span><small>${esc(s.msg)}</small></li>`)
      .join('')}</ul>`;

  function view() {
    onAfter(load);
    return `<div class="settings${remote() ? ' remote' : ''}">
      <nav class="chips settings-nav">${SECTIONS.map(([id, label]) => `<a class="chip${['backup', 'updates', 'license', 'devices', 'database', 'checks'].includes(id) ? ' local-only' : ''}" href="#set-${id}">${label}</a>`).join('')}</nav>
      ${remote() ? `<p class="notice info">هذا جهاز متصل بالجهاز الرئيسي. النسخ الاحتياطي والتحديثات والترخيص وقاعدة البيانات والفحوصات تُدار من الجهاز الرئيسي نفسه.</p>` : ''}

      <div class="card" id="set-shop">
        <h3>المحل</h3>
        <p class="muted">يظهر اسم المحل في أعلى البرنامج وعلى الإيصالات المطبوعة.</p>
        <div class="row"><input id="setShop" maxlength="60" style="flex:1;min-width:220px" class="search"><button class="btn primary" id="setShopSave">حفظ</button></div>
      </div>

      <div class="card" id="set-users">
        <h3>المستخدمون والصلاحيات</h3>
        <p class="muted"><b>المدير</b> يملك كل الصلاحيات ويدخل إلى الإعدادات. أما بقية المستخدمين فيرون ويعملون ما تحدّده لهم فقط:
          اختر قالباً جاهزاً، ثم أضف أو أزل ما تريد.</p>
        <details class="perm-user new-user" id="newUser">
          <summary><b>${icon('customers')} إضافة مستخدم</b></summary>
          <div class="perm-body">
            <div class="form-grid">
              <label class="field">اسم المستخدم <input id="nuName" maxlength="45"></label>
              <label class="field">كلمة المرور <input id="nuPass" type="password" minlength="4"></label>
              <label class="field">الصلاحيات
                <select id="nuPreset">${PRESETS.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}<option value="admin">مدير (كل الصلاحيات)</option></select></label>
            </div>
            <button class="btn primary" id="nuSave">${icon('save')} إضافة</button>
          </div>
        </details>
        <div id="setUsers" class="perm-users"><span class="muted">جارٍ التحميل…</span></div>
      </div>

      <div class="card local-only" id="set-backup">
        <h3>النسخ الاحتياطي</h3>
        <p class="muted">تُنسخ قاعدة البيانات تلقائياً كل يوم إلى المجلد المحدّد أدناه (عند تشغيل البرنامج، وبعد منتصف الليل إن بقي يعمل).
          يُفضّل أن يكون المجلد على قرص آخر أو ذاكرة خارجية أو مجلد متزامن مع السحابة.</p>
        <label class="field">مجلد النسخ الاحتياطي
          <span class="row path-row"><input id="bkDir" dir="ltr"><button class="btn" id="bkPick">اختيار…</button></span></label>
        <div class="row">
          <label>الاحتفاظ بآخر <select id="bkKeep">${[7, 14, 30, 60, 90, 180, 365].map((n) => `<option value="${n}">${n}</option>`).join('')}</select> نسخة</label>
          <button class="btn primary" id="bkSave">حفظ</button>
        </div>
        <p id="bkStatus" class="muted"></p>
        <div class="row">
          <button class="btn" id="bkNow">${icon('save')} نسخ احتياطي الآن</button>
          <button class="btn" id="bkOpen">${icon('file')} فتح المجلد</button>
        </div>
        <div id="bkList"></div>
      </div>

      <div class="card local-only" id="set-updates">
        <h3>التحديثات</h3>
        <p class="muted">يبحث البرنامج عن إصدار أحدث عبر الإنترنت. لا يُثبَّت أي تحديث إلا إذا كان موقّعاً من الناشر، وتُؤخذ نسخة احتياطية قبل التثبيت.</p>
        <p>الإصدار الحالي: <b id="upCurrent" dir="ltr"></b></p>
        <button class="btn" id="upCheck">${icon('refresh')} البحث عن تحديث</button>
        <div id="upResult"></div>
      </div>

      <div class="card local-only" id="set-license">
        <h3>الترخيص</h3>
        <div id="licInfo" class="muted">جارٍ التحميل…</div>
        <button class="btn" id="licChange" style="margin-top:8px">${icon('edit')} إدخال مفتاح تفعيل جديد</button>
      </div>

      <div class="card local-only" id="set-devices">
        <h3>الأجهزة الأخرى (شبكة أو VPN)</h3>
        <p class="muted">لتشغيل البرنامج على أجهزة أخرى بالبيانات نفسها: اسمح لها بالاتصال بهذا الجهاز. يتم الحفظ هنا بسرعة، ولا يُنقل إليها إلا قدر قليل من البيانات المضغوطة.
          في المرة الأولى يطلب Windows موافقة (حساب مدير Windows) لفتح المنفذ 8770.</p>
        <div id="rmStatus"><span class="muted">جارٍ التحميل…</span></div>
      </div>

      <div class="card local-only" id="set-database">
        <h3>قاعدة البيانات</h3>
        <p class="muted">الملف الذي يحفظ فيه البرنامج كل البيانات.</p>
        <p><code id="setPath" dir="ltr">…</code></p>
        <button class="btn" id="setChoose">${icon('file')} فتح قاعدة بيانات أخرى</button>
      </div>

      <div class="card local-only" id="set-checks">
        <h3>فحص النظام</h3>
        <p class="muted">يجرّب جميع عمليات الحفظ (عميل، بيع، تعديل، قبض، صرف، شراء، صنف، حذف) على قاعدة البيانات داخل معاملة واحدة،
          ثم يلغيها كلها، فتعود البيانات كما كانت تماماً. أجرِه بعد التثبيت وكلما تغيّر الجهاز.</p>
        <button class="btn primary" id="stRun">${icon('check')} تشغيل الفحص</button>
        <div id="stResult"></div>
        <h3 style="margin-top:22px">الفحص الشامل</h3>
        <p class="muted">يأخذ <b>نسخة</b> من قاعدة البيانات، ويُجري عليها بمحرّك Access الفعلي جميع العمليات واحدة واحدة ويحفظها:
          مورد وعميل وصنف، فاتورة شراء وتعديلها، بيع نقدي، بيع آجل وتعديله، قبض وصرف ومصروف وتعديلها، تغيير اسم عميل، وصلاحيات الكاشير.
          ثم يقرأ النسخة ويتحقق من صحة الأرصدة والمخزون والصندوق والأرباح وأن شيئاً آخر لم يتغيّر، ثم يحذف كل ذلك ويتحقق من عودتها كما كانت.
          <b>قاعدة البيانات الأصلية لا تُمسّ.</b></p>
        <div class="row">
          <button class="btn primary" id="ftRun">${icon('check')} تشغيل الفحص الشامل</button>
          <button class="btn" id="ftPrint" hidden>${icon('print')} طباعة النتيجة</button>
        </div>
        <div id="ftResult"></div>
      </div>

      <div class="card">
        <h3>حول البرنامج</h3>
        <p class="muted" id="setAbout"></p>
      </div>
    </div>`;
  }

  async function load() {
    $('#setShopSave').onclick = saveShop;
    $('#nuSave').onclick = addUser;
    try {
      const s = await api('/api/settings');
      $('#setShop').value = s.shopName || '';
      $('#setAbout').innerHTML = `${APP} — الإصدار <span dir="ltr">${esc(s.version)}</span> — محرّك قاعدة البيانات: ${esc(s.engine || 'يعمل عند أول استخدام')}${s.dataDir ? `<br>الإعدادات والسجل: <code dir="ltr">${esc(s.dataDir)}</code>` : ''}`;
      if (!remote()) {
        $('#setPath').textContent = s.dbPath || '—';
        $('#upCurrent').textContent = s.version;
        $('#licInfo').innerHTML = `مرخّص لـ: <b>${esc(s.licenseName || '—')}</b><br>الصلاحية: <b>${s.licenseExpiry ? 'حتى ' + esc(s.licenseExpiry) : 'دائمة'}</b><br>رمز هذا الجهاز: <code dir="ltr">${esc(s.machine)}</code>`;
        $('#bkDir').value = s.backupDir || '';
        $('#bkKeep').value = String(s.keepBackups || 30);
        bindLocal();
      }
    } catch (e) {
      toast(e.message, true);
    }
    loadUsers();
    if (!remote()) {
      loadBackups();
      remoteCard();
    }
  }

  function bindLocal() {
    $('#stRun').onclick = run;
    $('#ftRun').onclick = fullTest;
    $('#ftPrint').onclick = printFullTest;
    $('#setChoose').onclick = () => {
      if (confirm('سيُطلب من جميع المستخدمين تسجيل الدخول من جديد بعد فتح قاعدة بيانات أخرى. متابعة؟')) openDbScreen();
    };
    $('#bkPick').onclick = async () => {
      try {
        $('#bkDir').value = (await api('/api/choose-folder', { method: 'POST', body: {} })).dir;
      } catch (e) {
        toast(e.message, true);
      }
    };
    $('#bkSave').onclick = async () => {
      try {
        await api('/api/settings', { method: 'POST', body: { backupDir: $('#bkDir').value.trim(), keepBackups: Number($('#bkKeep').value) } });
        toast('حُفظت إعدادات النسخ الاحتياطي ✔');
        loadBackups();
      } catch (e) {
        toast(e.message, true);
      }
    };
    $('#bkNow').onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        await api('/api/backup-now', { method: 'POST', body: {} });
        toast('تم النسخ الاحتياطي ✔');
        loadBackups();
      } catch (err) {
        toast(err.message, true);
      } finally {
        b.disabled = false;
      }
    };
    $('#bkOpen').onclick = async () => {
      try {
        await api('/api/open-backups', { method: 'POST', body: {} });
      } catch (e) {
        toast(e.message, true);
      }
    };
    $('#upCheck').onclick = checkUpdate;
    $('#licChange').onclick = changeLicense;
  }

  async function saveShop() {
    try {
      const j = await api('/api/settings', { method: 'POST', body: { shopName: $('#setShop').value.trim() } });
      state.shopName = j.shopName;
      document.title = `${j.shopName} — ${APP}`;
      $('#shopTitle').textContent = j.shopName || APP;
      toast('تم الحفظ ✔');
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ------------------------------------------------------------ users
  async function loadUsers() {
    try {
      const j = await api('/api/users-list');
      drawUsers(j);
    } catch (e) {
      $('#setUsers').innerHTML = `<p class="notice error">${esc(e.message)}</p>`;
    }
  }

  // One card per user: name, password, manager, active, a template and the
  // ticks; saved on its own.
  function drawUsers(j) {
    const def = asList(j.defaultPerms);
    const host = $('#setUsers');
    host.innerHTML = j.users
      .map((u) => {
        const have = new Set(u.perms != null ? asList(u.perms) : def);
        const same = (list) => {
          const a = new Set(list.filter((x) => x !== 'pos'));
          const b = [...have].filter((x) => x !== 'pos');
          return a.size === b.length && b.every((x) => a.has(x));
        };
        const preset = u.admin ? '' : PRESETS.find(([, , list]) => same(list))?.[0] || '';
        const me = u.name === j.me;
        return `<details class="perm-user" data-user="${esc(u.name)}"${preset ? ` data-preset="${preset}"` : ''}>
          <summary><b>${esc(u.name)}</b>${me ? ' <small class="muted">(أنت)</small>' : ''}${u.active ? '' : ' <small class="neg">موقوف</small>'}<span class="perm-sum"></span></summary>
          <div class="perm-body">
            <div class="form-grid">
              <label class="field">الاسم <input data-name maxlength="45" value="${esc(u.name)}"></label>
              <label class="field">كلمة مرور جديدة <input data-pass type="password" placeholder="اتركها فارغة لعدم التغيير"></label>
            </div>
            <div class="row" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
              <label class="check"><input type="checkbox" data-admin${u.admin ? ' checked' : ''}${me ? ' disabled' : ''}> مدير (كل الصلاحيات)</label>
              <label class="check"><input type="checkbox" data-active${u.active ? ' checked' : ''}${me ? ' disabled' : ''}> الحساب فعّال</label>
              <select data-preset>
                <option value="">قالب جاهز…</option>
                ${PRESETS.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}
              </select>
            </div>
            <div class="perm-groups">${PERM_GROUPS.map(([g, list]) => `<fieldset><legend>${esc(g)}</legend>${list
              .map(([id, label]) => `<label class="check"><input type="checkbox" data-perm="${id}"${have.has(id) ? ' checked' : ''}> ${esc(label)}</label>`)
              .join('')}</fieldset>`).join('')}</div>
            <div class="row">
              <button class="btn primary" data-save>${icon('save')} حفظ</button>
              ${me ? '' : `<button class="btn danger" data-del>${icon('trash')} حذف المستخدم</button>`}
            </div>
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
    host.onclick = (e) => {
      const box = e.target.closest('.perm-user');
      if (!box) return;
      if (e.target.closest('[data-save]')) saveUser(box);
      if (e.target.closest('[data-del]')) deleteUser(box);
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
        c.parentElement.title = 'تُمنح تلقائياً لأن لديه صلاحية تحتاج هذه الشاشة';
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
          : '⚠ لا يرى أي شاشة';
  }

  async function saveUser(box) {
    const ticked = [...box.querySelectorAll('[data-perm]:checked')].map((c) => c.dataset.perm);
    const admin = box.querySelector('[data-admin]').checked;
    if (!admin && !ticked.length && !confirm('هذا المستخدم لن يرى أي شاشة. هل تريد الحفظ؟')) return;
    try {
      await api('/api/user-save', {
        method: 'POST',
        body: {
          oldName: box.dataset.user, name: box.querySelector('[data-name]').value.trim(), password: box.querySelector('[data-pass]').value,
          isAdmin: admin, active: box.querySelector('[data-active]').checked, perms: ticked.join(','),
        },
      });
      toast('حُفظ المستخدم ✔');
      loadUsers();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function deleteUser(box) {
    if (!confirm(`حذف المستخدم «${box.dataset.user}»؟ تبقى فواتيره وسنداته كما هي.`)) return;
    try {
      await api('/api/user-delete', { method: 'POST', body: { name: box.dataset.user } });
      toast('حُذف المستخدم');
      loadUsers();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function addUser() {
    const preset = $('#nuPreset').value;
    const list = preset === 'admin' ? [] : PRESETS.find(([id]) => id === preset)[2];
    try {
      await api('/api/user-save', {
        method: 'POST',
        body: { name: $('#nuName').value.trim(), password: $('#nuPass').value, isAdmin: preset === 'admin', active: true, perms: list.join(',') },
      });
      toast('أُضيف المستخدم ✔');
      $('#nuName').value = '';
      $('#nuPass').value = '';
      $('#newUser').open = false;
      loadUsers();
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ------------------------------------------------------------ backups
  async function loadBackups() {
    try {
      const j = await api('/api/backups');
      $('#bkStatus').innerHTML = `${j.running ? 'يجري النسخ الآن… ' : ''}${j.error ? `<span class="neg">آخر محاولة فشلت: ${esc(j.error)}</span>` : ''}
        ${j.backups.length ? `آخر نسخة: <b>${esc(j.backups.find((b) => !b.beforeRestore)?.date || j.backups[0].date)}</b> — عدد النسخ: ${j.backups.length}` : 'لا توجد نسخ بعد.'}`;
      $('#bkList').innerHTML = j.backups.length
        ? `<details class="bk-list"><summary>النسخ المحفوظة (${j.backups.length})</summary><ul class="steps">${j.backups
          .map((b) => `<li><span>${esc(b.date)}${b.beforeRestore ? ' <small class="muted">(قبل استعادة)</small>' : ''}</span><small>${size(b.size)}</small>
              <button class="btn small" data-restore="${esc(b.name)}">استعادة</button></li>`)
          .join('')}</ul></details>`
        : '';
      $('#bkList').onclick = (e) => {
        const b = e.target.closest('[data-restore]');
        if (b) restore(b.dataset.restore);
      };
    } catch (e) {
      $('#bkStatus').innerHTML = `<span class="neg">${esc(e.message)}</span>`;
    }
  }

  async function restore(name) {
    if (!confirm(`ستُستبدل جميع البيانات الحالية بهذه النسخة (${name}).\nتُحفظ نسخة من البيانات الحالية أولاً، ويُطلب من الجميع تسجيل الدخول من جديد.\nمتابعة؟`)) return;
    try {
      const j = await api('/api/restore', { method: 'POST', body: { name } });
      alert(`تمت الاستعادة ✔\nحُفظت البيانات السابقة باسم:\n${j.safety}`);
      signedOut();
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ------------------------------------------------------------ updates
  async function checkUpdate(e) {
    const b = e.currentTarget;
    b.disabled = true;
    $('#upResult').innerHTML = '<p class="muted">جارٍ البحث…</p>';
    try {
      const j = await api('/api/update-check');
      $('#upResult').innerHTML = j.available
        ? `<p class="notice info">يتوفر إصدار جديد: <b dir="ltr">${esc(j.latest)}</b>${j.date ? ` (${esc(j.date)})` : ''}</p>
           ${j.notes ? `<p class="update-notes">${esc(j.notes)}</p>` : ''}
           <button class="btn primary" id="upInstall">${icon('save')} تثبيت التحديث الآن</button>`
        : `<p class="notice good">✔ أنت تستخدم أحدث إصدار (${esc(j.current)}).</p>`;
      if ($('#upInstall')) $('#upInstall').onclick = () => installUpdate(j.latest);
    } catch (err) {
      $('#upResult').innerHTML = `<p class="notice error">${esc(err.message)}</p>`;
    } finally {
      b.disabled = false;
    }
  }

  async function installUpdate(version) {
    if (!confirm(`تثبيت الإصدار ${version}؟\nسيُغلق البرنامج ويُعاد فتحه تلقائياً خلال دقيقة تقريباً. تُؤخذ نسخة احتياطية قبل التثبيت.`)) return;
    $('#upResult').innerHTML = '<p class="notice info">جارٍ تنزيل التحديث والتحقق منه…</p>';
    try {
      await api('/api/update-install', { method: 'POST', body: {} });
      $('#upResult').innerHTML = '<p class="notice info">جارٍ التثبيت… سيُعاد فتح البرنامج تلقائياً.</p>';
      // wait for the new version to answer, then load it
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const st = await (await fetch('/api/state', { cache: 'no-store' })).json();
          if (st.version === version) return location.reload();
        } catch {
          /* still installing */
        }
      }
    } catch (e) {
      $('#upResult').innerHTML = `<p class="notice error">${esc(e.message)}</p>`;
    }
  }

  // ------------------------------------------------------------ license
  function changeLicense() {
    openModal(`<h2>مفتاح تفعيل جديد</h2>
      <p class="muted">لتجديد الترخيص أو تغييره: الصق المفتاح الجديد الذي أرسله مزوّد البرنامج لهذا الجهاز.</p>
      <textarea id="licKey" dir="ltr" rows="4" style="width:100%"></textarea>
      <p class="notice error" id="licErr" hidden></p>
      <div class="form-actions"><button class="btn primary" id="licSave">تفعيل</button><button class="btn" id="licCancel">إلغاء</button></div>`);
    $('#licCancel').onclick = closeModal;
    $('#licSave').onclick = async () => {
      try {
        const j = await api('/api/activate', { method: 'POST', body: { key: $('#licKey').value.trim() } });
        closeModal();
        toast(`تم التفعيل ✔ ${j.name || ''}`);
        load();
      } catch (e) {
        $('#licErr').textContent = e.message;
        $('#licErr').hidden = false;
      }
    };
  }

  // ------------------------------------------------------------ other devices
  async function remoteCard() {
    const box = $('#rmStatus');
    const draw = (j) => {
      const addr = (j.addresses || []).map((a) => `<li><code dir="ltr">${esc(a.value)}</code>${a.via ? ` <small class="muted">${esc(a.via)}</small>` : ''}</li>`).join('');
      box.innerHTML = j.allowRemote
        ? `${j.listening === 'network-refused'
            ? '<p class="notice error">الاتصال مفعّل، لكن Windows لم يسمح للبرنامج بالاستقبال من الشبكة. اضغط «تفعيل» مرة أخرى ووافق على رسالة Windows.</p>'
            : '<p class="notice good">✔ يمكن للأجهزة الأخرى الاتصال بهذا الجهاز.</p>'}
           <p>على الجهاز الآخر: افتح ${APP} ← <b>جهاز إضافي</b> (أو «الاتصال بالجهاز الرئيسي»)، واكتب أحد هذه العناوين:</p>
           <ul class="addr-list">${addr}</ul>
           <p class="muted" style="font-size:13px">إذا كان الجهاز الآخر متصلاً عبر VPN، فاستخدم عنوان VPN (المكتوب بجانبه اسم VPN).</p>
           <div class="row"><button class="btn" id="rmOn">${icon('check')} تفعيل مرة أخرى</button><button class="btn danger" id="rmOff">إيقاف اتصال الأجهزة الأخرى</button></div>`
        : `<p class="muted">غير مفعّل: هذا الجهاز وحده يستخدم البرنامج.</p>
           <button class="btn primary" id="rmOn">${icon('check')} السماح للأجهزة الأخرى بالاتصال</button>`;
      $('#rmOn').onclick = () => setRemote(true);
      if ($('#rmOff')) $('#rmOff').onclick = () => setRemote(false);
    };
    const setRemote = async (enable) => {
      box.insertAdjacentHTML('afterbegin', `<p class="muted" id="rmWait">${enable ? 'وافق على رسالة Windows التي ستظهر («هل تريد السماح لهذا التطبيق…»)' : 'جارٍ الإيقاف…'}</p>`);
      try {
        const j = await api('/api/remote-access', { method: 'POST', body: { enable } });
        // the program restarts its listening right after answering
        await new Promise((r) => setTimeout(r, 1200));
        const k = await api('/api/addresses').catch(() => j);
        draw({ ...j, ...k });
        toast(enable ? 'سُمح للأجهزة الأخرى بالاتصال ✔' : 'أُوقف اتصال الأجهزة الأخرى');
      } catch (e) {
        $('#rmWait')?.remove();
        toast(e.message, true);
      }
    };
    try {
      draw(await api('/api/addresses'));
    } catch (e) {
      box.innerHTML = `<p class="notice error">${esc(e.message)}</p>`;
    }
  }

  // ------------------------------------------------------------ checks
  async function run(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    $('#stResult').innerHTML = '<p class="muted">جارٍ الفحص… (قد يستغرق بضع ثوانٍ)</p>';
    try {
      const j = await api('/api/selftest', { method: 'POST', body: {} });
      $('#stResult').innerHTML = `
        <p class="notice ${j.passed ? 'good' : 'error'}">${j.passed
          ? '✔ كل العمليات تعمل. يمكنك الاعتماد على البرنامج في الحفظ.'
          : '✘ توجد مشكلة. صوّر هذه النتيجة وأرسلها إلى الدعم.'}</p>
        ${stepsHtml(j.steps || [])}`;
    } catch (err) {
      $('#stResult').innerHTML = `<p class="notice error">${esc(err.message)}</p>`;
    } finally {
      btn.disabled = false;
    }
  }

  let ftReport = null;

  async function readCopy() {
    const j = await api('/api/fulltest-data');
    return C.prepare(loadDatabase(readerFromTables(j.tables)));
  }

  async function fullTest(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    $('#ftPrint').hidden = true;
    const parts = [];
    const out = $('#ftResult');
    const draw = (status) => {
      out.innerHTML = `${status ? `<p class="muted">${esc(status)}</p>` : ''}${parts.map(([t, s]) => `<h4 style="margin:14px 0 4px">${esc(t)}</h4>${stepsHtml(s)}`).join('')}`;
    };
    const started = new Date();
    try {
      draw('جارٍ نسخ قاعدة البيانات…');
      const start = await api('/api/fulltest', { method: 'POST', body: { phase: 'start' } });
      draw('جارٍ قراءة النسخة…');
      const P0 = await readCopy();
      parts.push(['1) النسخة', [{ name: 'نسخة من قاعدة البيانات', ok: true, msg: start.file }, { name: 'قراءة النسخة', ok: true, msg: `${P0.sales.length} فاتورة بيع، ${P0.items.length} صنف، ${P0.customers.length} عميل` }]]);
      draw('جارٍ الحفظ والتعديل على النسخة بمحرّك Access…');
      const runR = await api('/api/fulltest', { method: 'POST', body: { phase: 'run' } });
      parts.push(['2) الحفظ والتعديل والصلاحيات (بمحرّك Access)', runR.steps]);
      draw('جارٍ قراءة النسخة بعد الحفظ وفحص التقارير…');
      const P1 = await readCopy();
      parts.push(['3) التقارير بعد الحفظ', verifyRun(P0, P1, runR.expect, localDay())]);
      draw('جارٍ الحذف…');
      const clean = await api('/api/fulltest', { method: 'POST', body: { phase: 'clean' } });
      parts.push(['4) الحذف (بمحرّك Access)', clean.steps]);
      draw('جارٍ قراءة النسخة بعد الحذف…');
      const P2 = await readCopy();
      parts.push(['5) هل عادت كما كانت؟', verifyClean(P0, P2, runR.expect)]);
    } catch (err) {
      parts.push(['توقّف الفحص', [{ name: 'خطأ', ok: false, msg: err.message }]]);
    } finally {
      await api('/api/fulltest', { method: 'POST', body: { phase: 'stop' } }).catch(() => {});
      btn.disabled = false;
    }
    const all = parts.flatMap(([, s]) => s);
    const bad = all.filter((s) => !s.ok).length;
    ftReport = { parts, bad, total: all.length, started, engine: '' };
    try {
      ftReport.engine = (await api('/api/settings')).engine || '';
    } catch {
      /* only for the printout */
    }
    draw('');
    out.insertAdjacentHTML('afterbegin', `<p class="notice ${bad ? 'error' : 'good'}">${bad
      ? `✘ لم ينجح ${bad} من ${all.length} فحصاً. اطبع النتيجة أو صوّرها وأرسلها إلى الدعم.`
      : `✔ نجحت جميع الفحوصات (${all.length}). الحفظ والتعديل والحذف والتقارير والصلاحيات كلها صحيحة على هذا الجهاز.`}</p>`);
    $('#ftPrint').hidden = false;
  }

  function printFullTest() {
    if (!ftReport) return;
    const r = ftReport;
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return toast('منع المتصفح نافذة الطباعة', true);
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>نتيجة الفحص الشامل</title>
      <style>body{font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 4px}
      .meta{color:#555;font-size:13px;margin-bottom:14px}.verdict{padding:10px 14px;border-radius:8px;font-weight:700;margin:12px 0}
      .good{background:#e7f6ec;color:#11612d}.bad{background:#fdecec;color:#9b1c1c}h2{font-size:15px;margin:16px 0 6px}
      table{width:100%;border-collapse:collapse;font-size:13px}td{border-bottom:1px solid #ddd;padding:5px 6px;vertical-align:top}
      td.m{width:24px;font-weight:700}td.ok{color:#11612d}td.x{color:#9b1c1c}td.msg{color:#555}</style></head><body>
      <h1>نتيجة الفحص الشامل — ${esc(state.shopName || APP)}</h1>
      <div class="meta">${esc(r.started.toLocaleString('ar'))} — ${APP} ${esc(state.version)} — ${esc(r.engine)} — المستخدم ${esc(state.user)}</div>
      <div class="verdict ${r.bad ? 'bad' : 'good'}">${r.bad ? `✘ لم ينجح ${r.bad} من ${r.total} فحصاً` : `✔ نجحت جميع الفحوصات (${r.total})`}</div>
      ${r.parts.map(([t, s]) => `<h2>${esc(t)}</h2><table>${s.map((x) => `<tr><td class="m ${x.ok ? 'ok' : 'x'}">${x.ok ? '✔' : '✘'}</td><td>${esc(x.name)}</td><td class="msg">${esc(x.msg)}</td></tr>`).join('')}</table>`).join('')}
      <script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

  return { view };
}
