-- =====================================================================
-- 002: تواريخ الحجز + منع التداخل + حالة الدفع + العمال بدون بطاقة هوية
-- شغّله بعد schema.sql (آمن لإعادة التشغيل)
-- =====================================================================
set local search_path = public, extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------- أعمدة جديدة ----------
alter table public.orders
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists paid boolean not null default false,
  add column if not exists paid_at timestamptz;

-- طلبات قديمة بلا تواريخ: نبدأ من يوم إنشائها
update public.orders
   set start_date = created_at::date,
       end_date = case when kind = 'furnished' then created_at::date + units
                       else (created_at::date + (units || ' months')::interval)::date end
 where start_date is null;
alter table public.orders alter column start_date set not null, alter column end_date set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_dates_ok') then
    alter table public.orders add constraint orders_dates_ok check (end_date > start_date);
  end if;
  -- لا يمكن تأكيد حجزين متداخلين لنفس الشقة (حماية نهائية في قاعدة البيانات)
  if not exists (select 1 from pg_constraint where conname = 'orders_no_overlap') then
    alter table public.orders add constraint orders_no_overlap
      exclude using gist (listing_id with =, daterange(start_date, end_date, '[)') with &&)
      where (status = 'confirmed');
  end if;
end $$;

-- العامل لا يرفع بطاقة هوية بعد الآن
alter table public.workers alter column id_card_path drop not null;

-- ---------- إنشاء طلب بالتواريخ ----------
create or replace function public.create_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.listings%rowtype;
  o public.orders%rowtype;
  v_today date := (now() at time zone 'Africa/Algiers')::date;
  v_start date; v_end date; v_units int;
  v_rate numeric; v_cu int; v_total bigint; v_otot bigint;
  v_comp jsonb := '[]'::jsonb; c jsonb;
  v_phone text; v_name text; v_id bigint;
begin
  if coalesce(p->>'listing_id', '') !~ '^[0-9]{1,18}$' then raise exception 'العرض غير متاح'; end if;
  select * into l from public.listings where id = (p->>'listing_id')::bigint and status = 'active';
  if not found then raise exception 'العرض غير متاح'; end if;

  if coalesce(p->>'start_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'اختر تاريخ بداية الحجز';
  end if;
  begin v_start := (p->>'start_date')::date;
  exception when others then raise exception 'تاريخ البداية غير صالح'; end;
  if v_start < v_today then raise exception 'تاريخ البداية لا يمكن أن يكون في الماضي'; end if;
  if v_start > v_today + 730 then raise exception 'تاريخ البداية بعيد جداً'; end if;

  if l.kind = 'furnished' then
    if coalesce(p->>'end_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'اختر تاريخ نهاية الحجز';
    end if;
    begin v_end := (p->>'end_date')::date;
    exception when others then raise exception 'تاريخ النهاية غير صالح'; end;
    if v_end <= v_start then raise exception 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية'; end if;
    v_units := v_end - v_start;
    if v_units > 365 then raise exception 'المدة غير صالحة (أقصاها 365 يوماً)'; end if;
  else
    if coalesce(p->>'units', '') !~ '^[0-9]{1,2}$' then raise exception 'المدة غير صالحة'; end if;
    v_units := (p->>'units')::int;
    if v_units < 1 or v_units > 24 then raise exception 'المدة غير صالحة (من 1 إلى 24 شهراً)'; end if;
    v_end := (v_start + (v_units || ' months')::interval)::date;
  end if;

  -- تداخل مع حجز مؤكد؟
  select * into o from public.orders
   where listing_id = l.id and status = 'confirmed'
     and daterange(start_date, end_date, '[)') && daterange(v_start, v_end, '[)')
   order by start_date limit 1;
  if found then
    raise exception 'هذه التواريخ محجوزة للأسف (من % إلى %). يرجى تغيير التاريخ.',
      to_char(o.start_date, 'DD/MM/YYYY'), to_char(o.end_date, 'DD/MM/YYYY');
  end if;

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
                             client_name, client_phone, units, start_date, end_date, owner_unit, rate_pct,
                             client_unit, owner_total, commission, total, companions)
  values (l.id, l.title, l.kind, l.owner_name, l.owner_phone, l.address,
          v_name, v_phone, v_units, v_start, v_end, l.price, v_rate,
          v_cu, v_otot, v_total - v_otot, v_total, v_comp)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'total', v_total, 'units', v_units,
                            'start_date', v_start, 'end_date', v_end);
end $$;

-- ---------- التواريخ المحجوزة لشقة (بدون أي بيانات شخصية) ----------
create or replace function public.public_booked_ranges(p_listing bigint)
returns table (start_date date, end_date date)
language sql stable security definer set search_path = public as $$
  select o.start_date, o.end_date from public.orders o
   where o.listing_id = p_listing and o.status = 'confirmed'
     and o.end_date > (now() at time zone 'Africa/Algiers')::date
   order by o.start_date;
$$;

-- ---------- تأكيد الطلب مع منع التداخل ----------
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
  if o.listing_id is not null then
    perform pg_advisory_xact_lock(o.listing_id);
    if exists (select 1 from public.orders x
                where x.listing_id = o.listing_id and x.status = 'confirmed' and x.id <> o.id
                  and daterange(x.start_date, x.end_date, '[)') && daterange(o.start_date, o.end_date, '[)')) then
      raise exception 'هذه التواريخ محجوزة بطلب مؤكد آخر لنفس الشقة. ألغِ هذا الطلب أو اتفق مع الزبون على تاريخ آخر.';
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

-- إلغاء طلب جديد، أو حجز مؤكد لم يُستلم مبلغه (لتحرير التواريخ)
create or replace function public.admin_cancel_order(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if o.status = 'cancelled' then raise exception 'الطلب ملغى مسبقاً'; end if;
  if o.paid then raise exception 'استُلم مبلغ هذا الطلب؛ ألغِ حالة الاستلام أولاً'; end if;
  update public.orders set status = 'cancelled', worker_id = null, worker_cut = 0, profit = null where id = p_order;
end $$;

-- ---------- حالة الدفع: «الزبون سلّم المبلغ» ----------
create or replace function public.admin_set_paid(p_order bigint, p_paid boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  update public.orders
     set paid = p_paid, paid_at = case when p_paid then now() else null end
   where id = p_order and status = 'confirmed';
  if not found then raise exception 'يجب تأكيد الطلب أولاً'; end if;
end $$;

-- ---------- ما يراه صاحب الشقة عبر رابطه: الحالة + الحجوزات المؤكدة (تواريخ فقط) ----------
drop function if exists public.get_listing_status(uuid);
create function public.get_listing_status(p_token uuid)
returns table (title text, kind text, status text, bookings jsonb)
language sql stable security definer set search_path = public as $$
  select l.title, l.kind, l.status,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'start', o.start_date, 'end', o.end_date, 'units', o.units,
                     'persons', 1 + jsonb_array_length(o.companions)) order by o.start_date)
                     from public.orders o
                    where o.listing_id = l.id and o.status = 'confirmed'
                      and o.end_date >= (now() at time zone 'Africa/Algiers')::date), '[]'::jsonb)
    from public.listings l where l.track_token = p_token;
$$;

-- ---------- الصلاحيات ----------
revoke execute on function public.public_booked_ranges(bigint), public.admin_set_paid(bigint, boolean),
  public.get_listing_status(uuid) from public, anon, authenticated;
grant execute on function public.public_booked_ranges(bigint), public.get_listing_status(uuid) to anon, authenticated;
grant execute on function public.admin_set_paid(bigint, boolean) to authenticated;
