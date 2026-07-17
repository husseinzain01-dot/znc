/* =========================================================
   نظام إدارة حقول الدواجن - SQL Server schema
   تشغيل هذا الملف مرة واحدة لإنشاء القاعدة والجداول.
   آمن لإعادة التشغيل: لا يحذف أي بيانات (يستخدم IF NOT EXISTS).
   ========================================================= */

IF DB_ID('ChickenFieldDB') IS NULL
BEGIN
    CREATE DATABASE ChickenFieldDB;
END
GO

USE ChickenFieldDB;
GO

/* ---------- roles ---------- */
IF OBJECT_ID('dbo.roles','U') IS NULL
CREATE TABLE dbo.roles(
    id          INT IDENTITY(1,1) PRIMARY KEY,
    name        NVARCHAR(50) NOT NULL UNIQUE,   -- admin / user / ...
    created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS(SELECT 1 FROM dbo.roles WHERE name='admin')
    INSERT INTO dbo.roles(name) VALUES ('admin'),('user');
GO

/* ---------- users ---------- */
IF OBJECT_ID('dbo.users','U') IS NULL
CREATE TABLE dbo.users(
    id          INT IDENTITY(1,1) PRIMARY KEY,
    username    NVARCHAR(100) NOT NULL UNIQUE,
    password    NVARCHAR(200) NOT NULL,         -- bcrypt hash (يُولَّد عبر API: POST /api/users)
    role_id     INT NULL REFERENCES dbo.roles(id),
    fields_json NVARCHAR(MAX) NULL,             -- قائمة أسماء الحقول المسموحة للمستخدم الفرعي (JSON)
    created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by  NVARCHAR(100) NULL
);
GO

/* ---------- fields (الحقول) ---------- */
IF OBJECT_ID('dbo.fields','U') IS NULL
CREATE TABLE dbo.fields(
    id          INT IDENTITY(1,1) PRIMARY KEY,
    name        NVARCHAR(150) NOT NULL UNIQUE,
    created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by  NVARCHAR(100) NULL
);
GO

/* ---------- batches (الوجبات) ---------- */
IF OBJECT_ID('dbo.batches','U') IS NULL
CREATE TABLE dbo.batches(
    id              BIGINT PRIMARY KEY,         -- نفس المعرّف المستخدم في الواجهة (Date.now())
    name            NVARCHAR(150) NULL,
    type            NVARCHAR(20)  NULL,         -- 'بياض' أو لحم
    field_id        INT NULL REFERENCES dbo.fields(id),
    field_name      NVARCHAR(150) NULL,         -- نسخة احتياطية من اسم الحقل كما في الواجهة
    hall            NVARCHAR(150) NULL,
    hatch_date      DATE NULL,
    transfer_date   DATE NULL,
    field_entry_date DATE NULL,
    bird_strain     NVARCHAR(100) NULL,
    eggs            INT NULL,
    set_eggs        INT NULL,
    bad_eggs        INT NULL,
    hatched         INT NULL,
    vaccine_deaths  INT NULL,
    isolated_birds  INT NULL,
    net_hatch       INT NULL,
    field_birds     INT NULL,
    fixed_hatch_rate DECIMAL(6,2) NULL,
    layer_init_weeks INT NULL,
    layer_init_days  INT NULL,
    layer_source    NVARCHAR(20) NULL,
    alert_age       INT NULL,
    market_age      INT NULL,
    transfer_bird_weight DECIMAL(10,2) NULL,
    extra_json      NVARCHAR(MAX) NULL,         -- أي حقول إضافية مستقبلية دون تعديل الجدول
    created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    created_by      NVARCHAR(100) NULL,
    updated_by      NVARCHAR(100) NULL
);
GO

/* ---------- mortalities (الهلاكات) ---------- */
IF OBJECT_ID('dbo.mortalities','U') IS NULL
CREATE TABLE dbo.mortalities(
    id          BIGINT PRIMARY KEY,
    batch_id    BIGINT NULL REFERENCES dbo.batches(id),
    field_name  NVARCHAR(150) NULL,
    hall        NVARCHAR(150) NULL,
    date        DATE NULL,
    count       INT NOT NULL DEFAULT 0,
    reason      NVARCHAR(200) NULL,
    note        NVARCHAR(500) NULL,
    created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    created_by  NVARCHAR(100) NULL
);
GO

/* ---------- weights (الأوزان - بالغرام فقط) ---------- */
IF OBJECT_ID('dbo.weights','U') IS NULL
CREATE TABLE dbo.weights(
    id                  BIGINT PRIMARY KEY,
    batch_id            BIGINT NULL REFERENCES dbo.batches(id),
    field_name          NVARCHAR(150) NULL,
    hall_id             INT NULL,
    hall                NVARCHAR(150) NULL,
    date                DATE NULL,
    age_days            INT NULL,                  -- عمر الطير بالأيام (أول يوم دخول = 0)
    actual_weight_grams INT NOT NULL DEFAULT 0,     -- الوزن الفعلي بالغرام
    guide_weight_grams  INT NULL,                   -- كايد الوزن حسب العمر بالغرام
    achievement_pct     DECIMAL(6,2) NULL,          -- نسبة تحقيق الكايد %
    alive               INT NULL,
    total_weight_grams  INT NULL,
    note                NVARCHAR(500) NULL,
    created_at          DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    created_by          NVARCHAR(100) NULL
);
GO

/* ---------- medicines (الأدوية) ---------- */
IF OBJECT_ID('dbo.medicines','U') IS NULL
CREATE TABLE dbo.medicines(
    id          BIGINT PRIMARY KEY,
    batch_id    BIGINT NULL REFERENCES dbo.batches(id),
    field_name  NVARCHAR(150) NULL,
    date        DATE NULL,
    name        NVARCHAR(200) NULL,
    dose        NVARCHAR(100) NULL,
    note        NVARCHAR(500) NULL,
    created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    created_by  NVARCHAR(100) NULL
);
GO

/* ---------- vaccines (اللقاحات) ---------- */
IF OBJECT_ID('dbo.vaccines','U') IS NULL
CREATE TABLE dbo.vaccines(
    id          BIGINT PRIMARY KEY,
    batch_id    BIGINT NULL REFERENCES dbo.batches(id),
    field_name  NVARCHAR(150) NULL,
    date        DATE NULL,
    name        NVARCHAR(200) NULL,
    note        NVARCHAR(500) NULL,
    created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    created_by  NVARCHAR(100) NULL
);
GO

/* ---------- marketing (التسويق) ---------- */
IF OBJECT_ID('dbo.marketing','U') IS NULL
CREATE TABLE dbo.marketing(
    id          BIGINT PRIMARY KEY,
    batch_id    BIGINT NULL REFERENCES dbo.batches(id),
    field_name  NVARCHAR(150) NULL,
    date        DATE NULL,
    quantity    INT NULL,
    weight_grams BIGINT NULL,
    price       DECIMAL(14,2) NULL,
    buyer       NVARCHAR(200) NULL,
    note        NVARCHAR(500) NULL,
    created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    created_by  NVARCHAR(100) NULL
);
GO

/* ---------- archive (الأرشيف) ---------- */
IF OBJECT_ID('dbo.archive','U') IS NULL
CREATE TABLE dbo.archive(
    id          BIGINT PRIMARY KEY,
    batch_id    BIGINT NULL,
    field_name  NVARCHAR(150) NULL,
    data_json   NVARCHAR(MAX) NULL,   -- نسخة كاملة من بيانات الوجبة وقت الأرشفة
    created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    created_by  NVARCHAR(100) NULL
);
GO

/* ---------- settings (إعدادات عامة) ---------- */
IF OBJECT_ID('dbo.settings','U') IS NULL
CREATE TABLE dbo.settings(
    id          INT IDENTITY(1,1) PRIMARY KEY,
    [key]       NVARCHAR(100) NOT NULL UNIQUE,
    value       NVARCHAR(MAX) NULL,
    updated_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by  NVARCHAR(100) NULL
);
GO

/* ---------- audit_logs (سجل العمليات) ---------- */
IF OBJECT_ID('dbo.audit_logs','U') IS NULL
CREATE TABLE dbo.audit_logs(
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    username    NVARCHAR(100) NULL,
    action      NVARCHAR(50)  NOT NULL,   -- save / login / ...
    entity      NVARCHAR(50)  NULL,
    entity_id   NVARCHAR(50)  NULL,
    details     NVARCHAR(MAX) NULL,
    created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* ---------- app_state (تخزين متوافق مع البنية الحالية للواجهة) ----------
   الواجهة الحالية تخزن كل البيانات (batches, weights, mortalities ...)
   كـ JSON واحد (نفس أسلوب localStorage / Supabase السابق).
   هذا الجدول يحل محل جدول Supabase app_state بدون أي تعديل في منطق
   الواجهة، ويبقى مصدر الحقيقة الحالي. الجداول أعلاه (12 جدولاً) جاهزة
   لمرحلة التطبيع المستقبلية دون الحاجة لإعادة كتابة الواجهة الآن. */
IF OBJECT_ID('dbo.app_state','U') IS NULL
CREATE TABLE dbo.app_state(
    id          NVARCHAR(50) PRIMARY KEY,   -- 'main'
    data_json   NVARCHAR(MAX) NOT NULL,
    updated_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by  NVARCHAR(100) NULL
);
GO

IF NOT EXISTS(SELECT 1 FROM dbo.app_state WHERE id='main')
    INSERT INTO dbo.app_state(id, data_json) VALUES ('main', N'{}');
GO

/* =========================================================
   مستخدم SQL محدود الصلاحيات للتطبيق (بدلاً من sa)
   عدّل كلمة المرور هنا، ثم استخدم نفس البيانات في ملف .env
   ========================================================= */
USE master;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name='chicken_app')
    CREATE LOGIN chicken_app WITH PASSWORD = 'ChangeMe_StrongPassword';
GO

USE ChickenFieldDB;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='chicken_app')
    CREATE USER chicken_app FOR LOGIN chicken_app;
GO
-- صلاحيات قراءة/كتابة فقط على جداول النظام (بدون db_owner / sa)
ALTER ROLE db_datareader ADD MEMBER chicken_app;
ALTER ROLE db_datawriter ADD MEMBER chicken_app;
GO
