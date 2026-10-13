-- Telegram conversation state: survives gateway restarts (mode/step/draft).
-- Photo bytes stay ephemeral in process memory; only the flow position persists.
create table public.telegram_chat_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  mode text not null default '' check (mode in ('', 'diagnose', 'market')),
  step text not null default '',
  draft jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create trigger telegram_chat_state_set_updated_at before update on public.telegram_chat_state
for each row execute function private.set_updated_at();

alter table public.telegram_chat_state enable row level security;

create policy telegram_chat_state_select_own on public.telegram_chat_state for select to authenticated
using ((select auth.uid()) = user_id);
create policy telegram_chat_state_insert_own on public.telegram_chat_state for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy telegram_chat_state_update_own on public.telegram_chat_state for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy telegram_chat_state_delete_own on public.telegram_chat_state for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.telegram_chat_state from anon, authenticated;
grant select, insert, update, delete on public.telegram_chat_state to authenticated;
