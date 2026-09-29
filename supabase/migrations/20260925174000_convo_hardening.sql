-- Convo concurrency hardening
-- The page foundation migration is later in the repository because the live
-- project already had the older page migrations applied. On a fresh install,
-- defer this index until channel_pages exists; the foundation migration also
-- creates the same uniqueness invariant.
do $$
begin
  if to_regclass('public.channel_pages') is not null then
    create unique index if not exists idx_channel_pages_channel_page_number
      on public.channel_pages(channel_id, page_number);
  end if;
end
$$;

notify pgrst, 'reload schema';
