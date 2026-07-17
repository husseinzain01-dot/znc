// ── PERMISSIONS ──
const ROLES = {
  ADMIN:  'admin',
  USER:   'user',
  VIEWER: 'viewer'
};

const ACTIONS = {
  ADD_BATCH:       'add_batch',
  EDIT_BATCH:      'edit_batch',
  DELETE_BATCH:    'delete_batch',
  TRANSFER_BATCH:  'transfer_batch',
  ARCHIVE_BATCH:   'archive_batch',
  ADD_WEIGHT:      'add_weight',
  ADD_MORT:        'add_mort',
  ADD_MARKET:      'add_market',
  ADD_FEED:        'add_feed',
  ADD_MEDS:        'add_meds',
  VIEW_REPORTS:    'view_reports',
  EXPORT_DATA:     'export_data',
  MANAGE_USERS:    'manage_users',
  CHANGE_SETTINGS: 'change_settings',
  RECALC_GUIDE:    'recalc_guide',
  RESTORE_BACKUP:  'restore_backup',
  VIEW_ALL_FIELDS: 'view_all_fields'
};

const ROLE_PERMISSIONS = {
  admin: Object.values(ACTIONS),
  user: [
    ACTIONS.ADD_WEIGHT, ACTIONS.ADD_MORT,   ACTIONS.ADD_MARKET,
    ACTIONS.ADD_FEED,   ACTIONS.ADD_MEDS,   ACTIONS.VIEW_REPORTS,
    ACTIONS.TRANSFER_BATCH
  ],
  viewer: [ACTIONS.VIEW_REPORTS]
};

// أقسام تحتاج صلاحية admin
const ADMIN_SECTIONS = ['users', 'settings', 'archive', 'batch'];

// التحقق من صلاحية عمل محدد
function hasPermission(action){
  if(!currentUser)return false;
  const role=currentUser.role||ROLES.USER;
  const perms=ROLE_PERMISSIONS[role]||[];
  return perms.includes(action);
}

// تنفيذ الصلاحية — يُرجع false ويعرض رسالة إن لم تكن مسموحة
function enforcePermission(action){
  if(!hasPermission(action)){
    msg('⛔ ليس لديك صلاحية لتنفيذ هذا الإجراء');
    return false;
  }
  return true;
}

// هل يمكن للمستخدم الوصول لهذا القسم؟
function canAccess(section){
  if(!currentUser)return false;
  if(ADMIN_SECTIONS.includes(section))return isAdmin();
  return true;
}

// إظهار/إخفاء عناصر حسب الدور (تُستدعى بعد تسجيل الدخول)
function applyRoleVisibility(){
  if(!currentUser)return;
  const admin=isAdmin();

  // عناصر تظهر للـ admin فقط
  document.querySelectorAll('[data-admin-only]').forEach(el=>{
    el.style.display=admin?'':'none';
  });

  // عناصر تُخفى للـ admin
  document.querySelectorAll('[data-user-only]').forEach(el=>{
    el.style.display=admin?'none':'';
  });

  // أزرار الحذف والتعديل
  document.querySelectorAll('.admin-action').forEach(el=>{
    el.style.display=admin?'':'none';
  });
}

// الأدوار المتاحة للعرض
function getRoleLabel(role){
  const labels={admin:'مدير النظام',user:'مستخدم',viewer:'مشاهد'};
  return labels[role]||role||'—';
}
