-- Uruchom w Supabase SQL Editor. Zachowuje wszystkie istniejące wiadomości.
begin;
alter table public.messages
  add column if not exists knowledge_sources jsonb not null default '[]'::jsonb;
notify pgrst, 'reload schema';
commit;
