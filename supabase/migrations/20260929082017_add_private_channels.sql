-- Convo private channels
alter table public.channels
  add column if not exists is_private boolean not null default false;

create index if not exists idx_channels_private
  on public.channels(is_private);

notify pgrst, 'reload schema';
