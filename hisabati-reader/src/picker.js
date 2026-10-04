// Choosing the حساباتي data file: Windows' own Open window first (opened
// right away when auto is set; it has Network in its side panel), and in
// the app below it the files found automatically, a folder and network
// browser, or a pasted path.

export function databasePicker(ctx, host, onDone, { auto = false } = {}) {
  const { esc, api, icon } = ctx;
  const q = (s) => host.querySelector(s);
  const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
  const folderOf = (p) => p.replace(/[\\/][^\\/]*$/, '');

  host.innerHTML = `
    <div class="picker">
      <button class="btn primary big block" id="pkNative">${icon('file')} اختار الملف من نافذة ويندوز</button>
      <p class="muted pk-hint" id="pkNativeHint">تنفتح نافذة ويندوز العادية. إذا الملف على حاسبة ثانية، دوس <b>Network</b> (الشبكة) بالجانب مالها.</p>
      <h3>أو من الملفات اللي لكيتها</h3>
      <div id="pkFound" class="pk-list"><p class="muted">جاري البحث عن ملفات حساباتي على الجهاز…</p></div>
      <div class="pk-tabs">
        <button class="btn" id="pkBrowseBtn">${icon('file')} تصفح المجلدات</button>
        <button class="btn" id="pkPathBtn">${icon('edit')} أكتب مكان الملف</button>
      </div>
      <div id="pkPath" hidden class="row" style="display:flex;gap:8px;margin-top:10px">
        <input id="pkPathInput" dir="ltr" placeholder="D:\\Units2026\\Units2026.accdb  أو  \\\\PC\\share\\Units2026.accdb" style="flex:1">
        <button class="btn primary" id="pkPathUse">استخدم</button>
      </div>
      <div id="pkBrowse" hidden></div>
      <p class="notice error" id="pkErr" hidden></p>
    </div>`;

  const showErr = (m) => {
    q('#pkErr').textContent = m;
    q('#pkErr').hidden = !m;
  };

  async function choose(path, btn) {
    showErr('');
    if (btn) btn.disabled = true;
    try {
      const j = await api('/api/choose-file', { method: 'POST', body: { path } });
      onDone(j);
    } catch (e) {
      showErr(e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  const fileRow = (f) => `<button class="pk-file" data-path="${esc(f.path)}">
      ${icon('file')}
      <span><b>${esc(f.name)}</b><small dir="ltr">${esc(folderOf(f.path))}</small></span>
      <small class="pk-meta">${esc(f.modified || '')}<br>${f.size ? size(f.size) : ''}</small>
    </button>`;

  host.addEventListener('click', (e) => {
    const f = e.target.closest('.pk-file');
    if (f) return choose(f.dataset.path, f);
    const d = e.target.closest('[data-dir]');
    if (d) return browse(d.dataset.dir);
    if (e.target.closest('#pkPcGo')) return openPc();
  });
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'pkPc') openPc();
  });
  // a computer typed by name or IP: \\NAME
  function openPc() {
    const v = q('#pkPc')?.value.trim().replace(/^\\+/, '').replace(/[\\/]+$/, '');
    if (v) browse('\\\\' + v);
  }

  api('/api/candidates', { method: 'POST', body: {} })
    .then((j) => {
      const files = j.files || [];
      q('#pkFound').innerHTML = files.length
        ? files.map(fileRow).join('')
        : '<p class="muted">ما لكيت ملف حساباتي بالأماكن المعتادة. دوس "تصفح المجلدات" ودوّر عليه.</p>';
    })
    .catch((e) => (q('#pkFound').innerHTML = `<p class="notice error">${esc(e.message)}</p>`));

  const pcBox = `<div class="row" style="display:flex;gap:8px;margin-top:10px">
      <input id="pkPc" dir="ltr" placeholder="اسم الحاسبة أو IP، مثل SHOP-PC أو 192.168.1.10" style="flex:1">
      <button class="btn" id="pkPcGo">افتح</button>
    </div>`;

  async function browse(dir = '') {
    const box = q('#pkBrowse');
    box.hidden = false;
    box.innerHTML = `<p class="muted">${dir === 'net:' ? 'جاري البحث عن الحاسبات بالشبكة… (ممكن ياخذ لحد 15 ثانية)' : /^\\\\[^\\]+$/.test(dir) ? 'جاري فتح الحاسبة…' : 'جاري الفتح…'}</p>`;
    try {
      const j = await api('/api/browse', { method: 'POST', body: { dir } });
      if (!dir) {
        box.innerHTML = `<div class="pk-list">${(j.places || [])
          .map((p) => `<button class="pk-dir" data-dir="${esc(p.path)}">${p.kind === 'network' ? '🖧' : icon(p.kind === 'folder' ? 'file' : 'stock')} <b>${esc(p.name)}</b></button>`)
          .join('')}</div>`;
        return;
      }
      // the network: computers, then a computer's shared folders
      if (j.computers || j.shares) {
        const list = j.computers
          ? j.computers.map((c) => `<button class="pk-dir" data-dir="${esc('\\\\' + c)}">🖥 <b>${esc(c)}</b></button>`)
          : j.shares.map((sh) => `<button class="pk-dir" data-dir="${esc(j.dir + '\\' + sh)}">📁 <b>${esc(sh)}</b></button>`);
        const empty = j.computers
          ? '<p class="muted">ما لكيت حاسبات. إذا الحاسبة الثانية شغّالة، اكتب اسمها أو رقم الـ IP مالها جوّه. (بالويندوز: Network discovery لازم يكون شغّال)</p>'
          : '<p class="muted">ما بيها فولدرات مشاركة. على الحاسبة اللي بيها الملف: كلك يمين على الفولدر ← Properties ← Sharing ← Share.</p>';
        box.innerHTML = `
          <div class="pk-crumb"><button class="btn small" data-dir="${esc(j.parent || '')}">⬆ رجوع</button><code dir="ltr">${esc(j.computers ? 'الشبكة' : j.dir)}</code></div>
          <div class="pk-list">${list.join('') || empty}</div>
          ${j.computers ? pcBox : ''}`;
        return;
      }
      box.innerHTML = `
        <div class="pk-crumb"><button class="btn small" data-dir="${esc(j.parent || '')}">⬆ رجوع</button><code dir="ltr">${esc(j.dir)}</code></div>
        <div class="pk-list">
          ${(j.files || []).map(fileRow).join('')}
          ${(j.folders || []).map((f) => `<button class="pk-dir" data-dir="${esc(j.dir.replace(/[\\/]$/, '') + '\\' + f)}">📁 ${esc(f)}</button>`).join('')}
          ${!(j.files || []).length && !(j.folders || []).length ? '<p class="muted">الفولدر فارغ</p>' : ''}
        </div>`;
    } catch (e) {
      box.innerHTML = `<p class="notice error">${esc(e.message)}</p>
        <button class="btn small" data-dir="">رجوع للبداية</button> <button class="btn small" data-dir="net:">الشبكة</button>
        ${/^\\\\/.test(dir) || dir === 'net:' ? pcBox : ''}`;
    }
  }

  q('#pkBrowseBtn').onclick = () => browse('');
  q('#pkPathBtn').onclick = () => {
    q('#pkPath').hidden = false;
    q('#pkPathInput').focus();
  };
  q('#pkPathUse').onclick = (e) => {
    const p = q('#pkPathInput').value.trim().replace(/^"|"$/g, '');
    if (p) choose(p, e.currentTarget);
  };
  q('#pkPathInput').onkeydown = (e) => e.key === 'Enter' && q('#pkPathUse').click();
  async function nativeWindow() {
    showErr('');
    const btn = q('#pkNative');
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'نافذة ويندوز مفتوحة… اختار الملف منها';
    q('#pkNativeHint').innerHTML = 'إذا ما شفت النافذة، دوس على <b>"اختيار ملف البيانات — لوحة المحل"</b> بشريط المهام (جوّه الشاشة).';
    try {
      const j = await api('/api/choose-file', { method: 'POST', body: {} });
      onDone(j);
    } catch (err) {
      // closing the window without a file is not an error
      if (!/ما اخترت ملف/.test(err.message)) showErr(err.message);
    } finally {
      if (btn.isConnected) {
        btn.disabled = false;
        btn.innerHTML = label;
        q('#pkNativeHint').innerHTML = 'تنفتح نافذة ويندوز العادية. إذا الملف على حاسبة ثانية، دوس <b>Network</b> (الشبكة) بالجانب مالها.';
      }
    }
  }
  q('#pkNative').onclick = nativeWindow;
  if (auto) nativeWindow();
}
