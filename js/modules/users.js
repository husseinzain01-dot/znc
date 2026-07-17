// ── USERS MANAGEMENT ──
function renderUserFieldsList(){
  let el=$('uFieldsList');if(!el)return;
  if(!data.fields.length){el.innerHTML='<p style="font-size:12px;color:var(--ink3)">'+t('noFields')+' مسجلة — أضف حقولاً أولاً من صفحة الحقول.</p>';return}
  let eid=val('uEditId');
  let current=eid?data.subUsers.find(u=>u.id===+eid):null;
  let assigned=current?current.fields||[]:[];
  el.innerHTML=data.fields.map(f=>`
    <label class="fieldCheckItem">
      <input type="checkbox" name="uField" value="${esc(f.name)}" ${assigned.includes(f.name)?'checked':''}>
      ${esc(f.name)} <span style="color:var(--ink3);font-size:10px">(${esc(f.type)})</span>
    </label>`).join('');
}
function getSelectedUserFields(){
  return [...document.querySelectorAll('input[name="uField"]:checked')].map(x=>x.value);
}
// تشفير كلمة المرور بـ SHA-256 (Web Crypto API)
async function hashPassword(pw){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function saveUser(){
  if(!isAdmin())return;
  let nm=val('uName').trim();let pw=val('uPass').trim();
  let role=$('uRole').value;
  let fields=getSelectedUserFields();
  let eid=val('uEditId');
  if(!nm)return msg('⚠ أدخل اسم المستخدم');
  if(eid){
    let u=data.subUsers.find(x=>x.id===+eid);
    if(u){
      u.name=nm;
      if(pw){u.pass=await hashPassword(pw);}
      u.role=role;u.fields=fields;
    }
  }else{
    if(nm===data.user)return msg('⚠ هذا الاسم محجوز للمدير الرئيسي');
    if(data.subUsers.find(u=>u.name===nm))return msg('⚠ يوجد مستخدم بهذا الاسم مسبقاً');
    if(!pw)return msg('⚠ أدخل كلمة المرور');
    data.subUsers.push({id:Date.now(),name:nm,pass:await hashPassword(pw),role,fields});
  }
  clearUserForm();save();renderAll();clearUserForm();msg('تم حفظ المستخدم');
}
function clearUserForm(){if($('uName'))$('uName').value='';if($('uPass'))$('uPass').value='';if($('uRole'))$('uRole').value='user';if($('uEditId'))$('uEditId').value='';renderUserFieldsList()}
function editUser(id){
  if(!isAdmin())return;
  let u=data.subUsers.find(x=>x.id===id);if(!u)return;
  $('uName').value=u.name;$('uPass').value='';$('uRole').value=u.role||'user';$('uEditId').value=u.id;
  renderUserFieldsList();show('users',null);
}
function deleteUser(id){
  if(!isAdmin())return;
  if(confirm('حذف المستخدم نهائياً؟')){data.subUsers=data.subUsers.filter(u=>u.id!==id);save();renderAll()}
}
function renderUsers(){
  let el=$('usersTable');if(!el)return;
  if(!data.subUsers.length){el.innerHTML='<tbody><tr><td colspan="5" style="text-align:center;color:var(--ink3);padding:24px">لا يوجد مستخدمون فرعيون. أضف أول مستخدم من الأعلى.</td></tr></tbody>';return}
  let rows=data.subUsers.map(u=>{
    let roleBdg=u.role==='admin'?'<span class="badge b-indigo">مدير</span>':'<span class="badge b-teal">مستخدم</span>';
    let fieldList=u.role==='admin'?'<span class="badge b-gray">كل الحقول</span>':(u.fields||[]).map(f=>`<span class="badge b-blue" style="margin-left:3px">${f}</span>`).join('')||'—';
    return `<tr><td><b>${u.name}</b></td><td>${roleBdg}</td><td>${fieldList}</td><td><button class="btn btn-secondary btn-sm" onclick="editUser(${u.id})">تعديل</button> <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">حذف</button></td></tr>`;
  }).join('');
  el.innerHTML=`<thead><tr><th>${t('thUsername')}</th><th>${t('thRole')}</th><th>${t('thAssignedFields')}</th><th>${t('thAction')}</th></tr></thead><tbody>${rows}</tbody>`;
}
