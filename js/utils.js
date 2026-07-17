// ── UTILS ──
function $(id){return document.getElementById(id)}
function esc(s){if(s==null)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function today(){
  const d=new Date();
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function num(id){return +($(id).value||0)}
function val(id){return ($(id).value||'').trim()}
function isAdmin(){return currentUser&&currentUser.role==='admin'}
function isDeveloperAdmin(){return isAdmin()&&currentUser&&currentUser.name===data.user}
function myFields(){if(isAdmin())return data.fields.map(f=>f.name);return currentUser?currentUser.fields:[];}
function canSeeField(fn){return isAdmin()||myFields().includes(fn)}
function msg(t){let el=$('toast');el.innerHTML='✓ '+t;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),1800)}
