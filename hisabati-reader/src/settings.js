// Settings (managers only): shop name, who counts as a manager, the data
// file, the system check and the backups folder. Stored by server.ps1 in
// %APPDATA%\LawhatAlMahal\config.json, so every user of this computer shares
// them and they survive updates.

import { databasePicker } from './picker.js';

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
        <h3>المدراء</h3>
        <p class="muted">المدير يكدر يعدّل ويمسح القوائم، ويسجّل مشتريات ومصاريف، ويغيّر المواد والأسعار، ويشوف الأرباح والصندوق.
          الباقين (كاشير) يسوّون قوائم بيع ووصولات قبض ويضيفون زبائن بس. إذا ما أشّرت على أحد، الكل مدراء.</p>
        <div class="user-list" id="setAdmins"><span class="muted">جاري التحميل…</span></div>
        <button class="btn primary" id="setAdminsSave">حفظ المدراء</button>
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
        <h3>حول البرنامج</h3>
        <p class="muted" id="setAbout"></p>
      </div>
    </div>`;
  }

  async function load() {
    $('#stRun').onclick = run;
    $('#setShopSave').onclick = saveShop;
    $('#setAdminsSave').onclick = saveAdmins;
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
      const admins = new Set(s.admins || []);
      $('#setAdmins').innerHTML = (u.users || [])
        .map((n) => `<label><input type="checkbox" value="${esc(n)}"${admins.has(n) ? ' checked' : ''}> ${esc(n)}</label>`)
        .join('') || '<span class="muted">ماكو مستخدمين بحساباتي</span>';
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

  async function saveAdmins() {
    const admins = [...document.querySelectorAll('#setAdmins input:checked')].map((i) => i.value);
    try {
      await api('/api/settings', { method: 'POST', body: { admins } });
      toast(admins.length ? 'انحفظ ✔ المدراء: ' + admins.join('، ') : 'انحفظ ✔ الكل مدراء');
    } catch (e) {
      toast(e.message, true);
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
