/* =========================================================
   نظام طلبات الشراء — إنشاء قاعدة البيانات والجداول يدوياً
   استخدم هذا الملف فقط إذا لم يكن لحساب البرنامج صلاحية إنشاء قاعدة بيانات.
   شغّله مرة واحدة في SQL Server Management Studio. آمن لإعادة التشغيل.
   ========================================================= */

IF DB_ID('PurchaseRequestsDB') IS NULL CREATE DATABASE PurchaseRequestsDB;
GO
USE PurchaseRequestsDB;
GO

IF OBJECT_ID('dbo.users','U') IS NULL CREATE TABLE dbo.users(
    id NVARCHAR(32) NOT NULL PRIMARY KEY,
    name NVARCHAR(80) NOT NULL,
    username NVARCHAR(60) NOT NULL UNIQUE,
    role NVARCHAR(10) NOT NULL DEFAULT 'user',
    department NVARCHAR(80) NULL,
    active BIT NOT NULL DEFAULT 1,
    pass_hash NVARCHAR(128) NOT NULL,
    pass_salt NVARCHAR(32) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
GO

IF OBJECT_ID('dbo.settings','U') IS NULL CREATE TABLE dbo.settings(
    [key] NVARCHAR(50) NOT NULL PRIMARY KEY,
    value NVARCHAR(MAX) NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
GO

IF OBJECT_ID('dbo.number_seq','U') IS NULL CREATE TABLE dbo.number_seq(
    [year] INT NOT NULL PRIMARY KEY,
    last_no INT NOT NULL);
GO

IF OBJECT_ID('dbo.purchase_requests','U') IS NULL CREATE TABLE dbo.purchase_requests(
    id NVARCHAR(32) NOT NULL PRIMARY KEY,
    request_no NVARCHAR(20) NOT NULL UNIQUE,
    title NVARCHAR(150) NULL,
    request_date DATE NOT NULL,
    needed_by DATE NULL,
    department NVARCHAR(80) NULL,
    category NVARCHAR(80) NULL,
    priority NVARCHAR(10) NOT NULL DEFAULT 'normal',
    supplier NVARCHAR(150) NULL,
    currency CHAR(3) NOT NULL DEFAULT 'IQD',
    justification NVARCHAR(MAX) NULL,
    notes NVARCHAR(MAX) NULL,
    total DECIMAL(18,2) NOT NULL DEFAULT 0,
    status NVARCHAR(12) NOT NULL,
    current_step INT NOT NULL DEFAULT 0,
    created_by_id NVARCHAR(32) NOT NULL,
    created_by_name NVARCHAR(80) NOT NULL,
    created_at DATETIME2 NOT NULL,
    submitted_at DATETIME2 NULL,
    approved_at DATETIME2 NULL,
    closed_at DATETIME2 NULL,
    updated_at DATETIME2 NULL,
    po_no NVARCHAR(60) NULL,
    po_supplier NVARCHAR(150) NULL,
    po_amount DECIMAL(18,2) NULL,
    po_date DATE NULL,
    po_expected DATE NULL,
    po_by_id NVARCHAR(32) NULL,
    po_by_name NVARCHAR(80) NULL,
    po_at DATETIME2 NULL);
GO

IF OBJECT_ID('dbo.request_items','U') IS NULL CREATE TABLE dbo.request_items(
    id INT IDENTITY(1,1) PRIMARY KEY,
    request_id NVARCHAR(32) NOT NULL REFERENCES dbo.purchase_requests(id) ON DELETE CASCADE,
    line_no INT NOT NULL,
    name NVARCHAR(200) NOT NULL,
    spec NVARCHAR(300) NULL,
    unit NVARCHAR(30) NULL,
    qty DECIMAL(18,3) NOT NULL DEFAULT 0,
    price DECIMAL(18,2) NOT NULL DEFAULT 0);
GO

IF OBJECT_ID('dbo.approval_steps','U') IS NULL CREATE TABLE dbo.approval_steps(
    id INT IDENTITY(1,1) PRIMARY KEY,
    request_id NVARCHAR(32) NOT NULL REFERENCES dbo.purchase_requests(id) ON DELETE CASCADE,
    step_no INT NOT NULL,
    step_key NVARCHAR(40) NULL,
    title NVARCHAR(80) NOT NULL,
    approvers_json NVARCHAR(MAX) NULL,
    min_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
    status NVARCHAR(10) NOT NULL,
    by_id NVARCHAR(32) NULL,
    by_name NVARCHAR(80) NULL,
    decided_at DATETIME2 NULL,
    comment NVARCHAR(1000) NULL,
    started_at DATETIME2 NULL);
GO

IF OBJECT_ID('dbo.request_history','U') IS NULL CREATE TABLE dbo.request_history(
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    request_id NVARCHAR(32) NOT NULL REFERENCES dbo.purchase_requests(id) ON DELETE CASCADE,
    at DATETIME2 NOT NULL,
    by_id NVARCHAR(32) NOT NULL,
    by_name NVARCHAR(80) NOT NULL,
    action NVARCHAR(20) NOT NULL,
    comment NVARCHAR(2000) NULL);
GO

IF OBJECT_ID('dbo.request_receipts','U') IS NULL CREATE TABLE dbo.request_receipts(
    id INT IDENTITY(1,1) PRIMARY KEY,
    request_id NVARCHAR(32) NOT NULL REFERENCES dbo.purchase_requests(id) ON DELETE CASCADE,
    complete BIT NOT NULL,
    receipt_date DATE NOT NULL,
    invoice NVARCHAR(60) NULL,
    note NVARCHAR(1000) NULL,
    by_id NVARCHAR(32) NOT NULL,
    by_name NVARCHAR(80) NOT NULL,
    at DATETIME2 NOT NULL);
GO

IF OBJECT_ID('dbo.request_attachments','U') IS NULL CREATE TABLE dbo.request_attachments(
    id NVARCHAR(32) NOT NULL PRIMARY KEY,
    request_id NVARCHAR(32) NOT NULL REFERENCES dbo.purchase_requests(id) ON DELETE CASCADE,
    name NVARCHAR(150) NOT NULL,
    mime NVARCHAR(100) NOT NULL,
    size INT NOT NULL,
    content VARBINARY(MAX) NOT NULL,
    by_id NVARCHAR(32) NOT NULL,
    by_name NVARCHAR(80) NOT NULL,
    at DATETIME2 NOT NULL);
GO

IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_items_request') CREATE INDEX IX_items_request ON dbo.request_items(request_id);
GO

IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_steps_request') CREATE INDEX IX_steps_request ON dbo.approval_steps(request_id);
GO

IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_history_request') CREATE INDEX IX_history_request ON dbo.request_history(request_id);
GO

IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_receipts_request') CREATE INDEX IX_receipts_request ON dbo.request_receipts(request_id);
GO

IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_att_request') CREATE INDEX IX_att_request ON dbo.request_attachments(request_id);
GO

/* حساب خاص بالبرنامج (عدّل كلمة المرور، ثم أدخل نفس الاسم وكلمة المرور في شاشة إعدادات قاعدة البيانات داخل المتصفح) */
USE master;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name='purchase_app')
    CREATE LOGIN purchase_app WITH PASSWORD = 'ChangeMe_StrongPassword', CHECK_POLICY = OFF;
GO
USE PurchaseRequestsDB;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name='purchase_app')
    CREATE USER purchase_app FOR LOGIN purchase_app;
GO
ALTER ROLE db_datareader ADD MEMBER purchase_app;
ALTER ROLE db_datawriter ADD MEMBER purchase_app;
ALTER ROLE db_ddladmin ADD MEMBER purchase_app;      -- لإنشاء الجداول الجديدة عند التحديثات
ALTER ROLE db_backupoperator ADD MEMBER purchase_app; -- لزر النسخ الاحتياطي داخل البرنامج
GO
