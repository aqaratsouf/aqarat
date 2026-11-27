-- =====================================================================
-- الإشعارات: رسالة لك عند (عرض جديد / طلب جديد / تأكيد كراء)
-- القنوات: تيليغرام (مجاني ومستقر) وواتساب عبر CallMeBot (إن توفرت له مفاتيح)
-- =====================================================================
create extension if not exists pg_net with schema extensions;

alter table public.settings
  add column if not exists notify_telegram_token text,
  add column if not exists notify_telegram_chat text,
  add column if not exists notify_wa_phone text,
  add column if not exists notify_wa_key text;

create or replace function public._fmt_da(n numeric) returns text
language sql immutable set search_path = public as $$
  select replace(to_char(n, 'FM999,999,999,999'), ',', ' ') || ' DA';
$$;

-- الإرسال الفعلي: لا يوقف أي عملية عند الفشل
create or replace function public._notify(p_text text) returns jsonb
language plpgsql security definer set search_path = public, net as $$
declare s record; ids jsonb := '{}'::jsonb; rid bigint;
begin
  select * into s from public.settings where id = 1;
  if s.notify_telegram_token ~ '^[0-9]{5,12}:[A-Za-z0-9_-]{30,50}$'
     and s.notify_telegram_chat ~ '^-?[0-9]{5,20}$' then
    select net.http_post(
      url := 'https://api.telegram.org/bot' || s.notify_telegram_token || '/sendMessage',
      body := jsonb_build_object('chat_id', s.notify_telegram_chat, 'text', p_text),
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 5000) into rid;
    ids := ids || jsonb_build_object('telegram', rid);
  end if;
  if s.notify_wa_phone ~ '^\+?[0-9]{8,15}$' and s.notify_wa_key ~ '^[0-9A-Za-z]{3,20}$' then
    select net.http_get(
      url := 'https://api.callmebot.com/whatsapp.php',
      params := jsonb_build_object('phone', s.notify_wa_phone, 'text', p_text, 'apikey', s.notify_wa_key),
      timeout_milliseconds := 8000) into rid;
    ids := ids || jsonb_build_object('whatsapp', rid);
  end if;
  return ids;
exception when others then
  return jsonb_build_object('error', sqlerrm);
end $$;

-- ---------- المشغّلات ----------
create or replace function public.trg_notify_listing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._notify(
    '🏠 عرض جديد بانتظار مراجعتك' || E'\n' || new.title || E'\n' ||
    case new.kind when 'furnished' then 'مجهزة (باليوم)' else 'غير مجهزة (بالشهر)' end ||
    ' — ' || public._fmt_da(new.price) || E'\n' ||
    'المالك: ' || new.owner_name || ' ' || new.owner_phone || E'\n' ||
    'افتح لوحتك لنشره.');
  return new;
exception when others then return new;
end $$;

create or replace function public.trg_notify_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._notify(
    '🛎️ طلب حجز جديد #' || new.id || E'\n' ||
    'الزبون: ' || new.client_name || ' ' || new.client_phone || E'\n' ||
    'الشقة: ' || new.listing_title || E'\n' ||
    'المدة: ' || new.units || case new.kind when 'furnished' then ' يوم' else ' شهر' end || E'\n' ||
    'من ' || to_char(new.start_date, 'DD/MM/YYYY') || ' إلى ' || to_char(new.end_date, 'DD/MM/YYYY') || E'\n' ||
    'المجموع: ' || public._fmt_da(new.total) || E'\n' ||
    'عمولتك: ' || public._fmt_da(new.commission) || E'\n' ||
    'اتصل بالزبون وبصاحب الشقة ثم أكّد من لوحتك.');
  return new;
exception when others then return new;
end $$;

create or replace function public.trg_notify_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._notify(
    '✅ تم تأكيد كراء #' || new.id || E'\n' ||
    new.listing_title || E'\n' ||
    'من ' || to_char(new.start_date, 'DD/MM/YYYY') || ' إلى ' || to_char(new.end_date, 'DD/MM/YYYY') || E'\n' ||
    'المجموع: ' || public._fmt_da(new.total) || E'\n' ||
    'فائدتك الصافية: ' || public._fmt_da(coalesce(new.profit, 0)));
  return new;
exception when others then return new;
end $$;

create or replace function public.trg_notify_paid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._notify(
    '💰 تم استلام المبلغ #' || new.id || E'\n' || new.listing_title || E'\n' ||
    'المبلغ: ' || public._fmt_da(new.total) || E'\n' ||
    'للمالك: ' || public._fmt_da(new.owner_total) || E'\n' ||
    'فائدتك الصافية: ' || public._fmt_da(coalesce(new.profit, 0)));
  return new;
exception when others then return new;
end $$;

drop trigger if exists notify_order_paid on public.orders;
create trigger notify_order_paid after update of paid on public.orders
  for each row when (old.paid = false and new.paid = true)
  execute function public.trg_notify_paid();

drop trigger if exists notify_new_listing on public.listings;
create trigger notify_new_listing after insert on public.listings
  for each row execute function public.trg_notify_listing();

drop trigger if exists notify_new_order on public.orders;
create trigger notify_new_order after insert on public.orders
  for each row execute function public.trg_notify_order();

drop trigger if exists notify_order_confirmed on public.orders;
create trigger notify_order_confirmed after update of status on public.orders
  for each row when (old.status = 'new' and new.status = 'confirmed')
  execute function public.trg_notify_confirmed();

-- ---------- رسالة تجريبية من لوحتك (للمدير فقط) مع نتيجة حقيقية ----------
create or replace function public.admin_notify_test() returns jsonb
language plpgsql security definer set search_path = public, net as $$
declare ids jsonb; res jsonb := '{}'::jsonb; k text; r record; tries int := 0; pending boolean;
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  ids := public._notify('🔔 رسالة تجريبية من موقع عقارات: الإشعارات تعمل.');
  if ids ? 'error' then return ids; end if;
  if ids = '{}'::jsonb then return jsonb_build_object('error', 'no_channel'); end if;
  loop
    pending := false; res := '{}'::jsonb;
    for k in select jsonb_object_keys(ids) loop
      select status_code, left(content, 160) as content, error_msg into r
        from net._http_response where id = (ids->>k)::bigint;
      if not found then pending := true;
      else res := res || jsonb_build_object(k, jsonb_build_object('status', r.status_code, 'body', r.content, 'error', r.error_msg));
      end if;
    end loop;
    exit when not pending or tries >= 8;
    perform pg_sleep(0.7); tries := tries + 1;
  end loop;
  return res;
end $$;

revoke execute on function public._fmt_da(numeric), public._notify(text), public.trg_notify_listing(),
  public.trg_notify_order(), public.trg_notify_confirmed(), public.trg_notify_paid(), public.admin_notify_test()
  from public, anon, authenticated;
grant execute on function public.admin_notify_test() to authenticated;
