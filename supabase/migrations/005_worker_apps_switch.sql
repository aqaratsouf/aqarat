-- مفتاح تفعيل/إيقاف استقبال طلبات العمل (يتحكم به المدير من الإعدادات)
alter table public.settings add column if not exists worker_apps_open boolean not null default false;
create or replace function public.worker_apps_open() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select worker_apps_open from public.settings where id = 1), false);
$$;
revoke execute on function public.worker_apps_open() from public, anon, authenticated;
grant execute on function public.worker_apps_open() to anon, authenticated;
-- apply_worker يرفض الطلب عند الإيقاف (تم تعديله ببداية الدالة: if not worker_apps_open() then raise ...)
