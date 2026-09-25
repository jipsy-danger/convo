-- Expiring file shares for Convo message attachments
alter table public.message_attachments
  add column if not exists expires_at timestamptz,
  add column if not exists deleted_at timestamptz;

update public.message_attachments
set expires_at = created_at + interval '5 hours'
where expires_at is null;

alter table public.message_attachments
  alter column expires_at set default (now() + interval '5 hours');

alter table public.message_attachments
  alter column expires_at set not null;

create index if not exists idx_message_attachments_expiry
  on public.message_attachments(expires_at)
  where deleted_at is null;

notify pgrst, 'reload schema';
