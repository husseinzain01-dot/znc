-- ══════════════════════════════════════════════════════════════
-- Supabase Row Level Security — نظام إدارة الوجبات
-- نفّذ هذا الملف كاملاً في Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════


-- ── 1. تفعيل RLS على جدول app_state ──
ALTER TABLE public.app_state ENABLE ROW LEVEL SECURITY;


-- ── 2. حذف أي سياسات قديمة (تجنب التعارض) ──
DROP POLICY IF EXISTS "allow_read_authenticated"  ON public.app_state;
DROP POLICY IF EXISTS "allow_write_authenticated" ON public.app_state;
DROP POLICY IF EXISTS "allow_upsert_authenticated" ON public.app_state;
DROP POLICY IF EXISTS "deny_delete"               ON public.app_state;


-- ── 3. SELECT: المستخدم المسجّل فقط يقرأ البيانات ──
CREATE POLICY "allow_read_authenticated"
ON public.app_state
FOR SELECT
USING (auth.role() = 'authenticated');


-- ── 4. INSERT: المستخدم المسجّل فقط يضيف صف جديد ──
CREATE POLICY "allow_upsert_authenticated"
ON public.app_state
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');


-- ── 5. UPDATE: المستخدم المسجّل فقط يحدّث البيانات ──
CREATE POLICY "allow_write_authenticated"
ON public.app_state
FOR UPDATE
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');


-- ── 6. DELETE: ممنوع تماماً لأي أحد ──
CREATE POLICY "deny_delete"
ON public.app_state
FOR DELETE
USING (false);


-- ══════════════════════════════════════════════════════════════
-- للتحقق أن السياسات طُبّقت:
-- ══════════════════════════════════════════════════════════════
SELECT
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'app_state';
