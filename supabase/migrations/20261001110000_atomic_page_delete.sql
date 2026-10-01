-- Convo: atomic message page deletion + renumbering
-- Deletes any selected page except the only remaining page and compacts
-- subsequent page numbers without transient unique-key collisions.

create or replace function public.delete_channel_page(
  p_channel_id bigint,
  p_page_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_page_id bigint;
  page_count integer;
  remaining_count integer;
begin
  if p_channel_id is null or p_page_number is null or p_page_number < 1 then
    raise exception 'Valid channel and page are required';
  end if;

  select count(*)
    into page_count
  from public.channel_pages
  where channel_id = p_channel_id;

  if page_count = 0 then
    raise exception 'Message page not found';
  end if;

  if page_count <= 1 then
    raise exception 'The only message page cannot be deleted';
  end if;

  select id
    into target_page_id
  from public.channel_pages
  where channel_id = p_channel_id
    and page_number = p_page_number
  for update;

  if target_page_id is null then
    raise exception 'Message page not found';
  end if;

  -- Messages, mentions, notifications, replies and attachments rows linked
  -- by foreign keys cascade with the page/message deletion. The Worker has
  -- already handled external object storage before invoking this function.
  delete from public.channel_pages
  where id = target_page_id
    and channel_id = p_channel_id;

  -- Move later pages into a temporary collision-free range first.
  update public.channel_pages
  set page_number = page_number + 1000000
  where channel_id = p_channel_id
    and page_number > p_page_number;

  -- Compact later pages by one.
  update public.channel_pages
  set page_number = page_number - 1000001
  where channel_id = p_channel_id
    and page_number > 1000000;

  select count(*)
    into remaining_count
  from public.channel_pages
  where channel_id = p_channel_id;

  return jsonb_build_object(
    'deletedPage', p_page_number,
    'lastPage', greatest(1, remaining_count)
  );
end;
$$;

revoke all on function public.delete_channel_page(bigint, integer) from public;
grant execute on function public.delete_channel_page(bigint, integer) to service_role;

notify pgrst, 'reload schema';
