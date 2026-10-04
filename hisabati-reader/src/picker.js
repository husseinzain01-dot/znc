// Choosing the حساباتي data file inside the app: files found automatically,
// a folder browser, or a pasted path. (Windows' own file dialog, opened by
// the hidden helper, can end up behind other windows, so it is only offered
// as a last resort.)

export function databasePicker(ctx, host, onDone) {
  const { esc, api, icon } = ctx;
  const q = (s) => host.querySelector(s);
  const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
  const folderOf = (p) => p.replace(/[\\/][^\\/]*$/, '');

  host.innerHTML = `
    <div class="picker">
      <h3>الملفات اللي لكيتها</h3>
      <div id="pkFound" class="pk-list"><p class="muted">جاري البحث عن ملفات حساباتي على الجهاز…</p></div>
      <div class="pk-tabs">
        <button class="btn" id="pkBrowseBtn">${icon('file')} تصفح المجلدات</button>
        <button class="btn" id="pkPathBtn">${icon('edit')} أكتب مكان الملف</button>
        <button class="btn ghost small" id="pkNative">نافذة ويندوز</button>
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
  });

  api('/api/candidates', { method: 'POST', body: {} })
    .then((j) => {
      const files = j.files || [];
      q('#pkFound').innerHTML = files.length
        ? files.map(fileRow).join('')
        : '<p class="muted">ما لكيت ملف حساباتي بالأماكن المعتادة. دوس "تصفح المجلدات" ودوّر عليه.</p>';
    })
    .catch((e) => (q('#pkFound').innerHTML = `<p class="notice error">${esc(e.message)}</p>`));

  async function browse(dir = '') {
    const box = q('#pkBrowse');
    box.hidden = false;
    box.innerHTML = '<p class="muted">جاري الفتح…</p>';
    try {
      const j = await api('/api/browse', { method: 'POST', body: { dir } });
      if (!dir) {
        box.innerHTML = `<div class="pk-list">${(j.places || [])
          .map((p) => `<button class="pk-dir" data-dir="${esc(p.path)}">${icon(p.kind === 'folder' ? 'file' : 'stock')} <b>${esc(p.name)}</b></button>`)
          .join('')}</div>`;
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
      box.innerHTML = `<p class="notice error">${esc(e.message)}</p><button class="btn small" data-dir="">رجوع للبداية</button>`;
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
  q('#pkNative').onclick = async (e) => {
    showErr('');
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'انفتحت نافذة ويندوز — إذا ما بانت، شوف شريط المهام';
    try {
      const j = await api('/api/choose-file', { method: 'POST', body: {} });
      onDone(j);
    } catch (err) {
      showErr(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'نافذة ويندوز';
    }
  };
}
