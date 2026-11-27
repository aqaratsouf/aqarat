-- اسم الموقع وصورة الواجهة يعدّلهما المدير فقط (bucket عام للقراءة، الكتابة للمدير)
alter table public.settings add column if not exists site_name text not null default 'عقارات سوف',
  add column if not exists banner_path text;
create or replace function public.site_info() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', site_name, 'banner', banner_path) from public.settings where id = 1; $$;
revoke execute on function public.site_info() from public, anon, authenticated;
grant execute on function public.site_info() to anon, authenticated;
-- + bucket site-assets وسياساته (انظر الهجرة المطبّقة)
