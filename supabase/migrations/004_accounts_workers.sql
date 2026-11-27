-- =====================================================================
-- 004: حسابات الزبائن وأصحاب الشقق والعمال + مهام العمال + طلبات العمل
-- يتطلب 002 و 003. آمن لإعادة التشغيل.
-- =====================================================================
alter table public.listings add column if not exists owner_user uuid references auth.users(id) on delete set null;
alter table public.orders
  add column if not exists client_user uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at timestamptz;
alter table public.workers
  add column if not exists user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists surname text,
  add column if not exists birth_date date;
create index if not exists orders_client_user_idx on public.orders(client_user);
create index if not exists orders_worker_idx on public.orders(worker_id);
create index if not exists listings_owner_user_idx on public.listings(owner_user);

create table if not exists public.worker_applications (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  first_name text not null, last_name text not null,
  birth_date date not null, phone text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(), reviewed_at timestamptz
);
create unique index if not exists one_pending_application on public.worker_applications(user_id) where status = 'pending';
alter table public.worker_applications enable row level security;
revoke all on public.worker_applications from anon, authenticated;
grant select on public.worker_applications to authenticated;
drop policy if exists "admin applications" on public.worker_applications;
create policy "admin applications" on public.worker_applications for select to authenticated using (public.is_admin());
revoke all on sequence public.worker_applications_id_seq from anon, authenticated;

-- ---------- طلب إنشاء الطلبات والعروض يتطلب حساباً ----------
do $$
declare d text; d0 text;
begin
  d0 := pg_get_functiondef('public.create_order(jsonb)'::regprocedure); d := d0;
  d := replace(d, E'begin\n  if coalesce(p->>''listing_id'', '''')', E'begin\n  if auth.uid() is null then raise exception ''سجّل الدخول أولاً''; end if;\n  if coalesce(p->>''listing_id'', '''')');
  d := replace(d, 'units, start_date, end_date, owner_unit, rate_pct,', 'units, start_date, end_date, owner_unit, rate_pct, client_user,');
  d := replace(d, 'v_otot, v_total - v_otot, v_total, v_comp)', 'v_otot, v_total - v_otot, v_total, v_comp)');
  d := replace(d, 'v_units, v_start, v_end, l.price, v_rate,', 'v_units, v_start, v_end, l.price, v_rate, auth.uid(),');
  if d = d0 or position('auth.uid(),' in d) = 0 or position('client_user,' in d) = 0 then raise exception 'create_order patch failed'; end if;
  execute d;

  d0 := pg_get_functiondef('public.submit_listing(jsonb)'::regprocedure); d := d0;
  d := replace(d, E'  v_token uuid;\nbegin\n', E'  v_token uuid;\nbegin\n  if auth.uid() is null then raise exception ''سجّل الدخول أولاً''; end if;\n');
  d := replace(d, 'lat, lng, map_url, price, photos, status)', 'lat, lng, map_url, price, photos, status, owner_user)');
  d := replace(d, E'v_clean, ''pending'')', E'v_clean, ''pending'', auth.uid())');
  if d = d0 or position('owner_user)' in d) = 0 or position('auth.uid())' in d) = 0 then raise exception 'submit_listing patch failed'; end if;
  execute d;
end $$;
revoke execute on function public.create_order(jsonb), public.submit_listing(jsonb) from public, anon;
grant execute on function public.create_order(jsonb), public.submit_listing(jsonb) to authenticated;

-- ---------- منطق التأكيد المشترك (المدير أو العامل) ----------
create or replace function public._do_confirm(p_order bigint, p_worker bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  w public.workers%rowtype;
  v_cut bigint := 0;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if o.status <> 'new' then raise exception 'تمت معالجة الطلب مسبقاً'; end if;
  if o.listing_id is not null then
    perform pg_advisory_xact_lock(o.listing_id);
    if exists (select 1 from public.orders x
                where x.listing_id = o.listing_id and x.status = 'confirmed' and x.id <> o.id
                  and daterange(x.start_date, x.end_date, '[)') && daterange(o.start_date, o.end_date, '[)')) then
      raise exception 'هذه التواريخ محجوزة بطلب مؤكد آخر لنفس الشقة.';
    end if;
  end if;
  if p_worker is not null then
    select * into w from public.workers where id = p_worker and active;
    if not found then raise exception 'العامل غير متاح'; end if;
    v_cut := least(floor(o.owner_total * w.rate_pct / 100 + 0.5)::bigint, o.commission);
  end if;
  begin
    update public.orders
       set status = 'confirmed', worker_id = p_worker, worker_cut = v_cut,
           profit = o.commission - v_cut, confirmed_at = now()
     where id = p_order;
  exception when exclusion_violation then
    raise exception 'هذه التواريخ محجوزة بطلب مؤكد آخر لنفس الشقة.';
  end;
end $$;

create or replace function public.admin_confirm_order(p_order bigint, p_worker bigint default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  perform public._do_confirm(p_order, p_worker);
end $$;

-- ---------- المدير يوكل الطلب لعامل ----------
create or replace function public.admin_assign_order(p_order bigint, p_worker bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  if p_worker is not null and not exists (select 1 from public.workers where id = p_worker and active) then
    raise exception 'العامل غير متاح';
  end if;
  update public.orders set worker_id = p_worker, assigned_at = case when p_worker is null then null else now() end
   where id = p_order and status = 'new';
  if not found then raise exception 'لا يمكن تعيين عامل لهذا الطلب'; end if;
end $$;

-- ---------- العامل ----------
create or replace function public._my_worker() returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.workers where user_id = auth.uid() and active;
$$;

create or replace function public.apply_worker(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_birth date;
begin
  if auth.uid() is null then raise exception 'سجّل الدخول أولاً'; end if;
  if exists (select 1 from public.workers where user_id = auth.uid()) then raise exception 'لديك حساب عامل مسبقاً'; end if;
  if exists (select 1 from public.worker_applications where user_id = auth.uid() and status = 'pending') then
    raise exception 'طلبك قيد الدراسة';
  end if;
  if coalesce(p->>'birth_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'تاريخ الميلاد غير صالح'; end if;
  begin v_birth := (p->>'birth_date')::date; exception when others then raise exception 'تاريخ الميلاد غير صالح'; end;
  if v_birth > current_date - 365 * 18 or v_birth < date '1920-01-01' then raise exception 'العمر يجب أن يكون 18 سنة فأكثر'; end if;
  insert into public.worker_applications (user_id, first_name, last_name, birth_date, phone)
  values (auth.uid(), public._req_text(p->>'first_name', 'الاسم', 2, 40), public._req_text(p->>'last_name', 'اللقب', 2, 40),
          v_birth, public._clean_phone(p->>'phone'));
end $$;

create or replace function public.my_worker_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w public.workers%rowtype; a public.worker_applications%rowtype;
begin
  if auth.uid() is null then return jsonb_build_object('state', 'anon'); end if;
  select * into w from public.workers where user_id = auth.uid();
  if found then
    return jsonb_build_object('state', case when w.active then 'approved' else 'inactive' end,
                              'name', w.name, 'rate_pct', w.rate_pct);
  end if;
  select * into a from public.worker_applications where user_id = auth.uid() order by id desc limit 1;
  if found then return jsonb_build_object('state', a.status); end if;
  return jsonb_build_object('state', 'none', 'rate_pct', public.get_rate() / 2);
end $$;

create or replace function public.worker_orders()
returns table (id bigint, status text, paid boolean, kind text, listing_title text, address text, units int,
               start_date date, end_date date, client_name text, client_phone text, owner_name text, owner_phone text,
               total bigint, owner_total bigint, commission bigint, persons int, rate_pct numeric, my_cut bigint,
               created_at timestamptz, assigned_at timestamptz, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.status, o.paid, o.kind, o.listing_title, o.address, o.units, o.start_date, o.end_date,
         o.client_name, o.client_phone, o.owner_name, o.owner_phone, o.total, o.owner_total, o.commission,
         1 + jsonb_array_length(o.companions), w.rate_pct,
         case when o.status = 'new' then least(floor(o.owner_total * w.rate_pct / 100 + 0.5)::bigint, o.commission)
              else o.worker_cut end,
         o.created_at, o.assigned_at, o.paid_at
    from public.orders o join public.workers w on w.id = o.worker_id
   where w.user_id = auth.uid() and w.active
   order by o.id desc;
$$;

create or replace function public.worker_confirm(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_w bigint := public._my_worker();
begin
  if v_w is null then raise exception 'غير مصرح'; end if;
  if not exists (select 1 from public.orders where id = p_order and worker_id = v_w) then raise exception 'هذا الطلب ليس من مهامك'; end if;
  perform public._do_confirm(p_order, v_w);
end $$;

create or replace function public.worker_cancel(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_w bigint := public._my_worker(); o public.orders%rowtype;
begin
  if v_w is null then raise exception 'غير مصرح'; end if;
  select * into o from public.orders where id = p_order and worker_id = v_w for update;
  if not found then raise exception 'هذا الطلب ليس من مهامك'; end if;
  if o.status = 'cancelled' then raise exception 'الطلب ملغى مسبقاً'; end if;
  if o.paid then raise exception 'استُلم مبلغ هذا الطلب ولا يمكن إلغاؤه'; end if;
  update public.orders set status = 'cancelled', worker_cut = 0, profit = null where id = p_order;
end $$;

create or replace function public.worker_set_paid(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_w bigint := public._my_worker();
begin
  if v_w is null then raise exception 'غير مصرح'; end if;
  update public.orders set paid = true, paid_at = now()
   where id = p_order and worker_id = v_w and status = 'confirmed' and not paid;
  if not found then raise exception 'يجب تأكيد الطلب أولاً (أو استُلم مبلغه مسبقاً)'; end if;
end $$;

-- ---------- المدير يدرس طلبات العمل ----------
create or replace function public.admin_review_application(p_app bigint, p_approve boolean, p_rate numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.worker_applications%rowtype; v_rate numeric;
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  select * into a from public.worker_applications where id = p_app for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if a.status <> 'pending' then raise exception 'تمت دراسة الطلب مسبقاً'; end if;
  if p_approve then
    v_rate := coalesce(p_rate, public.get_rate() / 2);
    if v_rate < 0 or v_rate > public.get_rate() then raise exception 'النسبة غير صالحة'; end if;
    insert into public.workers (name, surname, birth_date, phone, rate_pct, active, user_id)
    values (a.first_name || ' ' || a.last_name, a.last_name, a.birth_date, a.phone, v_rate, true, a.user_id)
    on conflict (user_id) do update set active = true, rate_pct = excluded.rate_pct,
      name = excluded.name, phone = excluded.phone;
  end if;
  update public.worker_applications set status = case when p_approve then 'approved' else 'rejected' end, reviewed_at = now()
   where id = p_app;
end $$;

-- ---------- صفحة الزبون ----------
create or replace function public.my_orders()
returns table (id bigint, status text, paid boolean, kind text, listing_title text, address text, units int,
               start_date date, end_date date, total bigint, created_at timestamptz, paid_at timestamptz,
               owner_name text, owner_phone text)
language sql stable security definer set search_path = public as $$
  select o.id, o.status, o.paid, o.kind, o.listing_title, o.address, o.units, o.start_date, o.end_date, o.total,
         o.created_at, o.paid_at,
         case when o.paid then o.owner_name end, case when o.paid then o.owner_phone end
    from public.orders o where o.client_user = auth.uid() order by o.id desc;
$$;

-- ---------- صفحة صاحب الشقة ----------
create or replace function public.my_listings()
returns table (id bigint, kind text, title text, status text, price integer, created_at timestamptz, bookings jsonb)
language sql stable security definer set search_path = public as $$
  select l.id, l.kind, l.title, l.status, l.price, l.created_at,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'start', o.start_date, 'end', o.end_date, 'units', o.units,
                     'persons', 1 + jsonb_array_length(o.companions),
                     'client_name', o.client_name, 'client_phone', o.client_phone,
                     'amount', o.owner_total, 'paid', o.paid, 'paid_at', o.paid_at) order by o.start_date desc)
                     from public.orders o where o.listing_id = l.id and o.status = 'confirmed'), '[]'::jsonb)
    from public.listings l where l.owner_user = auth.uid() order by l.id desc;
$$;

-- ---------- إشعار المدير بطلب عمل جديد ----------
create or replace function public.trg_notify_application() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._notify('👷 طلب عمل جديد' || E'\n' || new.first_name || ' ' || new.last_name || E'\n' || new.phone || E'\nادرسه من لوحتك.');
  return new;
exception when others then return new;
end $$;
drop trigger if exists notify_new_application on public.worker_applications;
create trigger notify_new_application after insert on public.worker_applications
  for each row execute function public.trg_notify_application();

-- ---------- الصلاحيات ----------
revoke execute on function public._do_confirm(bigint, bigint), public.admin_assign_order(bigint, bigint),
  public._my_worker(), public.apply_worker(jsonb), public.my_worker_state(), public.worker_orders(),
  public.worker_confirm(bigint), public.worker_cancel(bigint), public.worker_set_paid(bigint),
  public.admin_review_application(bigint, boolean, numeric), public.my_orders(), public.my_listings(),
  public.trg_notify_application(), public.admin_confirm_order(bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.admin_assign_order(bigint, bigint), public.apply_worker(jsonb),
  public.my_worker_state(), public.worker_orders(), public.worker_confirm(bigint), public.worker_cancel(bigint),
  public.worker_set_paid(bigint), public.admin_review_application(bigint, boolean, numeric),
  public.my_orders(), public.my_listings(), public.admin_confirm_order(bigint, bigint) to authenticated;
