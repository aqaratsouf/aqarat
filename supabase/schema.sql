-- =====================================================================
-- عقارات — مخطط قاعدة البيانات لـ Supabase (يمكن تشغيله أكثر من مرة بأمان)
-- الصق الملف كاملاً في: Supabase ← SQL Editor ← New query ← Run
-- =====================================================================

-- ---------- الجداول ----------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  rate_pct numeric not null default 10 check (rate_pct >= 0 and rate_pct <= 50)
);
insert into public.settings (id, rate_pct) values (1, 10) on conflict (id) do nothing;

-- المديرون (أنت فقط). لا يُقرأ من الموقع مباشرة.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.listings (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('furnished', 'unfurnished')),
  title text not null,
  description text not null default '',
  owner_name text not null,
  owner_phone text not null,
  address text not null,
  lat double precision,
  lng double precision,
  map_url text,
  price integer not null check (price > 0),
  photos jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'active', 'hidden')),
  created_at timestamptz not null default now(),
  track_token uuid not null default gen_random_uuid()
);
create unique index if not exists listings_track_token_key on public.listings (track_token);

create table if not exists public.workers (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null,
  id_card_path text not null,
  rate_pct numeric not null check (rate_pct >= 0 and rate_pct <= 50),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  listing_id bigint references public.listings (id) on delete set null,
  listing_title text not null,
  kind text not null,
  owner_name text not null,
  owner_phone text not null,
  address text not null,
  client_name text not null,
  client_phone text not null,
  units integer not null check (units > 0),
  owner_unit integer not null,
  rate_pct numeric not null,
  client_unit integer not null,
  owner_total bigint not null,
  commission bigint not null,
  total bigint not null,
  companions jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new', 'confirmed', 'cancelled')),
  worker_id bigint references public.workers (id) on delete set null,
  worker_cut bigint not null default 0,
  profit bigint,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

alter table public.settings enable row level security;
alter table public.admins   enable row level security;
alter table public.listings enable row level security;
alter table public.workers  enable row level security;
alter table public.orders   enable row level security;

-- ---------- دوال مساعدة ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.am_i_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin();
$$;

create or replace function public.get_rate() returns numeric
language sql stable security definer set search_path = public as $$
  select rate_pct from public.settings where id = 1;
$$;

create or replace function public._clean_phone(p text) returns text
language plpgsql immutable set search_path = public as $$
declare v text := regexp_replace(coalesce(p, ''), '[\s\-]', '', 'g');
begin
  if v !~ '^\+?[0-9]{8,15}$' then raise exception 'رقم الهاتف غير صالح'; end if;
  return v;
end $$;

create or replace function public._req_text(p text, lbl text, lo int, hi int) returns text
language plpgsql immutable set search_path = public as $$
declare v text := btrim(coalesce(p, ''));
begin
  if char_length(v) < lo or char_length(v) > hi then
    raise exception 'الحقل غير صالح: %', lbl;
  end if;
  return v;
end $$;

-- ---------- عرض العروض للزبائن (بدون رقم المالك ولا سعره الأصلي) ----------
create or replace function public.public_listings(p_kind text default null)
returns table (id bigint, kind text, title text, description text, address text,
               lat double precision, lng double precision, map_url text,
               client_price integer, photos jsonb)
language sql stable security definer set search_path = public as $$
  select l.id, l.kind, l.title, l.description, l.address, l.lat, l.lng, l.map_url,
         l.price + floor(l.price * (select rate_pct from public.settings where id = 1) / 100 + 0.5)::int,
         l.photos
  from public.listings l
  where l.status = 'active' and (p_kind is null or l.kind = p_kind)
  order by l.id desc;
$$;

-- ---------- إرسال عرض من صاحب شقة (يبقى "بانتظار المراجعة") ----------
drop function if exists public.submit_listing(jsonb);
create function public.submit_listing(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := p->>'kind';
  v_price bigint;
  v_photos jsonb := p->'photos';
  v_clean jsonb := '[]'::jsonb;
  v_phone text;
  ph jsonb;
  v_lat double precision;
  v_lng double precision;
  v_map text;
  v_id bigint;
  v_token uuid;
begin
  if v_kind is null or v_kind not in ('furnished', 'unfurnished') then
    raise exception 'نوع الشقة غير صالح';
  end if;
  if coalesce(p->>'price', '') !~ '^[0-9]{1,10}$' then raise exception 'السعر غير صالح'; end if;
  v_price := (p->>'price')::bigint;
  if v_price < 1 or v_price > 1000000000 then raise exception 'السعر غير صالح'; end if;

  if coalesce(jsonb_typeof(v_photos), '') <> 'array'
     or jsonb_array_length(v_photos) < 1 or jsonb_array_length(v_photos) > 20 then
    raise exception 'أضف صورة واحدة على الأقل (حتى 20)';
  end if;
  for ph in select value from jsonb_array_elements(v_photos) loop
    if coalesce(ph->>'label', '') not in ('غرفة نوم', 'صالون', 'مطبخ', 'حمام', 'مدخل / واجهة', 'أخرى') then
      raise exception 'تصنيف الصورة غير صالح';
    end if;
    if coalesce(ph->>'file', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$' then
      raise exception 'ملف الصورة غير صالح';
    end if;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('file', ph->>'file', 'label', ph->>'label'));
  end loop;

  if jsonb_typeof(p->'lat') = 'number' and jsonb_typeof(p->'lng') = 'number' then
    v_lat := (p->>'lat')::double precision;
    v_lng := (p->>'lng')::double precision;
    if v_lat < -90 or v_lat > 90 or v_lng < -180 or v_lng > 180 then
      raise exception 'الإحداثيات غير صالحة';
    end if;
  end if;

  v_map := nullif(btrim(coalesce(p->>'map_url', '')), '');
  if v_map is not null and (v_map !~ '^https://' or char_length(v_map) > 500) then
    raise exception 'رابط الخريطة غير صالح';
  end if;

  v_phone := public._clean_phone(p->>'owner_phone');
  if (select count(*) from public.listings
       where owner_phone = v_phone and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'محاولات كثيرة، حاول لاحقاً';
  end if;

  insert into public.listings (kind, title, description, owner_name, owner_phone, address,
                               lat, lng, map_url, price, photos, status)
  values (v_kind,
          public._req_text(p->>'title', 'العنوان', 3, 80),
          public._req_text(p->>'description', 'الوصف', 0, 1000),
          public._req_text(p->>'owner_name', 'الاسم', 3, 80),
          v_phone,
          public._req_text(p->>'address', 'الموقع', 3, 200),
          v_lat, v_lng, v_map, v_price::int, v_clean, 'pending')
  returning id, track_token into v_id, v_token;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

-- ---------- حالة عرض واحد عبر رمزه السري (لا تُرجع هاتفاً ولا سعراً) ----------
create or replace function public.get_listing_status(p_token uuid)
returns table (title text, kind text, status text)
language sql stable security definer set search_path = public as $$
  select l.title, l.kind, l.status from public.listings l where l.track_token = p_token;
$$;

-- ---------- طلب حجز من زبون (الأسعار تُحسب هنا في الخادم) ----------
create or replace function public.create_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.listings%rowtype;
  v_units int;
  v_max int;
  v_rate numeric;
  v_cu int;
  v_total bigint;
  v_otot bigint;
  v_comp jsonb := '[]'::jsonb;
  c jsonb;
  v_phone text;
  v_name text;
  v_id bigint;
begin
  if coalesce(p->>'listing_id', '') !~ '^[0-9]{1,18}$' then raise exception 'العرض غير متاح'; end if;
  select * into l from public.listings where id = (p->>'listing_id')::bigint and status = 'active';
  if not found then raise exception 'العرض غير متاح'; end if;

  if coalesce(p->>'units', '') !~ '^[0-9]{1,4}$' then raise exception 'المدة غير صالحة'; end if;
  v_units := (p->>'units')::int;
  v_max := case when l.kind = 'furnished' then 365 else 24 end;
  if v_units < 1 or v_units > v_max then raise exception 'المدة غير صالحة'; end if;

  if jsonb_typeof(p->'companions') = 'array' then
    if jsonb_array_length(p->'companions') > 10 then raise exception 'عدد المرافقين غير صالح'; end if;
    for c in select value from jsonb_array_elements(p->'companions') loop
      v_comp := v_comp || jsonb_build_array(jsonb_build_object(
        'name', public._req_text(c->>'name', 'اسم المرافق', 2, 40),
        'surname', public._req_text(c->>'surname', 'لقب المرافق', 2, 40),
        'relation', public._req_text(c->>'relation', 'صفة القرابة', 2, 40)));
    end loop;
  end if;

  v_name := public._req_text(p->>'client_name', 'الاسم', 3, 80);
  v_phone := public._clean_phone(p->>'client_phone');
  if (select count(*) from public.orders
       where client_phone = v_phone and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'محاولات كثيرة، حاول لاحقاً';
  end if;

  v_rate := public.get_rate();
  v_cu := l.price + floor(l.price * v_rate / 100 + 0.5)::int;
  v_total := v_cu::bigint * v_units;
  v_otot := l.price::bigint * v_units;

  insert into public.orders (listing_id, listing_title, kind, owner_name, owner_phone, address,
                             client_name, client_phone, units, owner_unit, rate_pct, client_unit,
                             owner_total, commission, total, companions)
  values (l.id, l.title, l.kind, l.owner_name, l.owner_phone, l.address,
          v_name, v_phone, v_units, l.price, v_rate, v_cu,
          v_otot, v_total - v_otot, v_total, v_comp)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'total', v_total);
end $$;

-- ---------- تأكيد / إلغاء الطلب (للمدير فقط) ----------
create or replace function public.admin_confirm_order(p_order bigint, p_worker bigint default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  w public.workers%rowtype;
  v_cut bigint := 0;
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if o.status <> 'new' then raise exception 'تمت معالجة الطلب مسبقاً'; end if;
  if p_worker is not null then
    select * into w from public.workers where id = p_worker and active;
    if not found then raise exception 'العامل غير متاح'; end if;
    v_cut := least(floor(o.owner_total * w.rate_pct / 100 + 0.5)::bigint, o.commission);
  end if;
  update public.orders
     set status = 'confirmed', worker_id = p_worker, worker_cut = v_cut,
         profit = o.commission - v_cut, confirmed_at = now()
   where id = p_order;
end $$;

create or replace function public.admin_cancel_order(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  update public.orders set status = 'cancelled' where id = p_order and status = 'new';
  if not found then raise exception 'تمت معالجة الطلب مسبقاً'; end if;
end $$;

-- ---------- الصلاحيات ----------
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.listings, public.workers, public.settings to authenticated;
grant select on public.orders to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- الزبائن وأصحاب الشقق (بدون حساب) لا يصلون للجداول إلا عبر هذه الدوال فقط
grant execute on function public.get_rate(), public.public_listings(text),
  public.submit_listing(jsonb), public.create_order(jsonb), public.am_i_admin(), public.get_listing_status(uuid)
  to anon, authenticated;
-- للمدير فقط
grant execute on function public.is_admin(),
  public.admin_confirm_order(bigint, bigint), public.admin_cancel_order(bigint)
  to authenticated;

-- ---------- سياسات الصفوف (RLS): المدير فقط ----------
drop policy if exists "admin listings" on public.listings;
create policy "admin listings" on public.listings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin workers" on public.workers;
create policy "admin workers" on public.workers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin settings" on public.settings;
create policy "admin settings" on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin orders" on public.orders;
create policy "admin orders" on public.orders for select to authenticated
  using (public.is_admin());

-- ---------- التخزين (الصور) ----------
-- صور الشقق: عامة للقراءة، والرفع مسموح للجميع بحدود الحجم والنوع.
-- بطاقات العمال: خاصة بالمدير فقط.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
       ('worker-docs', 'worker-docs', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "aq photos upload" on storage.objects;
create policy "aq photos upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'listing-photos');

drop policy if exists "aq photos read" on storage.objects;
create policy "aq photos read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'listing-photos');

drop policy if exists "aq photos admin delete" on storage.objects;
create policy "aq photos admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and public.is_admin());

drop policy if exists "aq docs admin" on storage.objects;
create policy "aq docs admin" on storage.objects for all to authenticated
  using (bucket_id = 'worker-docs' and public.is_admin())
  with check (bucket_id = 'worker-docs' and public.is_admin());
