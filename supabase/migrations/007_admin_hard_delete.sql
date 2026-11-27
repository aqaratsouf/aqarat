-- حذف نهائي للطلبات والعروض من طرف المدير مع إعادة ضبط الترقيم
create or replace function public.admin_delete_order(p_order bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  delete from public.orders where id = p_order;
  if not found then raise exception 'الطلب غير موجود'; end if;
  perform setval('public.orders_id_seq', coalesce((select max(id) from public.orders), 0) + 1, false);
end $$;
create or replace function public.admin_delete_listing(p_listing bigint, p_with_orders boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_photos jsonb;
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  select photos into v_photos from public.listings where id = p_listing;
  if not found then raise exception 'العرض غير موجود'; end if;
  if p_with_orders then
    delete from public.orders where listing_id = p_listing;
    perform setval('public.orders_id_seq', coalesce((select max(id) from public.orders), 0) + 1, false);
  end if;
  delete from public.listings where id = p_listing;
  perform setval('public.listings_id_seq', coalesce((select max(id) from public.listings), 0) + 1, false);
  return v_photos;
end $$;
revoke execute on function public.admin_delete_order(bigint), public.admin_delete_listing(bigint, boolean) from public, anon, authenticated;
grant execute on function public.admin_delete_order(bigint), public.admin_delete_listing(bigint, boolean) to authenticated;
