# نظام إدارة حقول الدواجن - تطبيق ويب + Backend API + SQL Server

## نوع المشروع

تطبيق ويب (يعمل من المتصفح، بدون Electron وبدون تطبيق Windows). الواجهة (HTML/CSS/JS) كما هي، ومضافة لها طبقة Backend (Node.js/Express) تتعامل مع قاعدة بيانات SQL Server. **لا يوجد أي اتصال بقاعدة البيانات من داخل ملفات الواجهة.**

## هيكل المشروع

```
/frontend       الواجهة (نفس index.html بدون تغيير في التصميم أو الأسماء)
/backend        Express API
  db.js         الاتصال بـ SQL Server (القراءة من .env)
  logic.js      منطق الكايد/العمر المشترك (نفس منطق الواجهة)
  server.js     تعريف الخادم وربط كل المسارات
  routes/
    state.js        GET/PUT /api/state   (توافق مع التخزين القديم - JSON كامل)
    fields.js       /api/fields
    batches.js      /api/batches
    mortalities.js  /api/mortalities
    weights.js      /api/weights
    medicines.js    /api/medicines
    vaccines.js     /api/vaccines
    marketing.js    /api/marketing
    archive.js      /api/archive
    users.js        /api/users (+ /api/users/login)
/db
  schema.sql    إنشاء القاعدة، الجداول الـ12، ومستخدم SQL محدود الصلاحيات
.env.example    نموذج ملف إعدادات الاتصال (انسخه إلى .env)
index.html      النسخة القديمة (مرجع فقط، غير مستخدمة)
```

## 1) تجهيز قاعدة البيانات

نفّذ `db/schema.sql` مرة واحدة عبر SSMS أو `sqlcmd` على سيرفر SQL Server (محلي أو داخل الشبكة):

- ينشئ قاعدة `ChickenFieldDB`.
- ينشئ الجداول الـ12: `roles, users, fields, batches, mortalities, weights, medicines, vaccines, marketing, archive, settings, audit_logs` (PK/FK، `created_at/updated_at/created_by/updated_by`).
- ينشئ جدول `app_state` (توافق مع التخزين الحالي JSON).
- ينشئ مستخدم SQL محدود الصلاحيات `chicken_app` (بدون sa) بصلاحية قراءة/كتابة فقط.
- **آمن لإعادة التشغيل** - لا يحذف بيانات موجودة (يستخدم `IF NOT EXISTS`)، مناسب أيضاً كآلية تحديث/migration بسيطة: أضف أعمدة/جداول جديدة بنفس الأسلوب (`IF OBJECT_ID(...) IS NULL`) دون مسح القديم.

عدّل كلمة مرور `chicken_app` داخل `schema.sql` قبل التنفيذ.

## 2) إعداد الاتصال (.env)

انسخ `.env.example` إلى `.env` وعدّل القيم:

```
PORT=4790
DB_SERVER=اسم_السيرفر_أو_IP
DB_PORT=1433
DB_DATABASE=ChickenFieldDB
DB_USER=chicken_app
DB_PASSWORD=كلمة_المرور_التي_وضعتها_في_schema.sql
DB_ENCRYPT=false
DB_TRUST_CERT=true
```

`.env` غير مرفوع لأي ملف واجهة، ويُقرأ فقط من Backend (`backend/db.js`).

## 3) التشغيل

```bash
npm install
npm start
```

- يشغّل Express على `http://0.0.0.0:4790` (متاح من أي جهاز على نفس الشبكة عبر IP الجهاز، مثال: `http://192.168.1.10:4790`).
- نفس الخادم يقدّم الواجهة (`/index.html`) ويوفّر الـ API (`/api/...`).
- لتشغيله كخدمة دائمة على سيرفر داخلي: استخدم `pm2` أو `nssm` (Windows Service) لتشغيل `node backend/server.js`.

## 4) نقاط الـ API (Endpoints)

| المسار | الوصف |
|---|---|
| `GET /api/health` | فحص الاتصال بقاعدة البيانات |
| `GET/PUT /api/state` | التخزين الكامل المتوافق مع الواجهة الحالية (JSON) |
| `GET/POST/PUT/DELETE /api/fields[/:id]` | الحقول |
| `GET/POST/PUT/DELETE /api/batches[/:id]` | الوجبات (فلاتر: `field_id`, `field_name`, `type`) |
| `GET/POST/PUT/DELETE /api/mortalities[/:id]` | الهلاكات (فلتر: `batch_id`, `field_name`) |
| `GET/POST/DELETE /api/weights[/:id]`, `GET /api/weights/guide?ageDays=` | الأوزان (بالغرام، كايد محسوب من العمر فقط) |
| `GET/POST/PUT/DELETE /api/medicines[/:id]` | الأدوية |
| `GET/POST/PUT/DELETE /api/vaccines[/:id]` | اللقاحات |
| `GET/POST/PUT/DELETE /api/marketing[/:id]` | التسويق |
| `GET/POST/PUT/DELETE /api/archive[/:id]` | الأرشيف |
| `GET/POST/PUT/DELETE /api/users[/:id]`, `POST /api/users/login` | المستخدمين والصلاحيات (كلمات مرور مشفّرة bcrypt) |

كل الأخطاء (تحقق فاشل، فشل اتصال، فشل حفظ) تُرجع `{ "error": "رسالة عربية واضحة" }` برمز HTTP مناسب (400/401/404/500)، دون كشف تفاصيل SQL الداخلية (تُسجَّل في console الخادم فقط).

## 5) تعديل اتصال SQL Server لاحقاً

عدّل القيم في `.env` فقط وأعد تشغيل `npm start` - لا حاجة لأي تعديل بالكود أو الواجهة.

## 6) النشر على جهاز/سيرفر داخل الشبكة

1. انسخ المشروع كاملاً إلى السيرفر الداخلي.
2. ثبّت Node.js وSQL Server (أو استخدم سيرفر SQL Server موجود في الشبكة عبر تعديل `DB_SERVER`).
3. نفّذ `db/schema.sql`، اضبط `.env`، ثم `npm install && npm start`.
4. من أي جهاز في نفس الشبكة، افتح المتصفح على `http://IP-السيرفر:4790`.

## 7) النسخ الاحتياطي (Backup) لقاعدة البيانات

عبر SSMS: `Right-click ChickenFieldDB → Tasks → Back Up...`، أو عبر `sqlcmd`:

```sql
BACKUP DATABASE ChickenFieldDB TO DISK = 'C:\Backups\ChickenFieldDB.bak';
```

يُنصح بجدولة هذه العملية يومياً عبر SQL Server Agent.

## ملاحظات / نقاط تحتاج مراجعة

1. **التوافق مع التخزين الحالي:** الواجهة لا تزال تعمل عبر `/api/state` (نفس أسلوب JSON السابق عبر `app_state`)، لتجنّب أي تخريب في منطق آلاف الأسطر الحالي. الجداول الـ12 المُطبَّعة جاهزة بالكامل (CRUD + validation) ويمكن ربط كل صفحة بها تدريجياً (Phase 2) كأي تحديث مستقبلي دون مسح البيانات.
2. **تسجيل الدخول:** أضيف `POST /api/users/login` مع تشفير bcrypt كخيار جاهز، لكن منطق الدخول الحالي في الواجهة (`data.user/pass` و`data.subUsers` ضمن `app_state`) لم يُمس - الانتقال الكامل لجدول `users` المشفّر يحتاج تعديل دالة `loginNow()` في الواجهة، وهذا تغيير حسّاس يُفضَّل تنفيذه كخطوة منفصلة بعد الاتفاق.
3. **منطق الأوزان/العمر/الكايد** مطابق للواجهة: العمر بالأيام (أول يوم دخول = 0)، الأوزان بالغرام فقط، الكايد من `getGuideWeightByAge(ageDays)` في `backend/logic.js` (لا يتأثر بالوزن الفعلي)، نسبة التحقيق = فعلي/كايد×100.
4. **الهلاكات/التسويق/الأدوية/اللقاحات/الأرشيف:** أُنشئت لها APIs مرتبطة بـ `batch_id` و`field_name` كما هو موجود حالياً في منطق الواجهة، دون تغيير أي حساب.
5. تأكد من تغيير كلمة مرور `chicken_app` في `schema.sql` و`.env` قبل النشر، وعدم استخدام `sa`.
