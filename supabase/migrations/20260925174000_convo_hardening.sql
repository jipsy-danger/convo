-- Convo concurrency hardening
-- Prevent two clients from creating the same page number in one channel.
create unique index if not exists idx_channel_pages_channel_page_number
  on public.channel_pages(channel_id, page_number);

notify pgrst, 'reload schema';
