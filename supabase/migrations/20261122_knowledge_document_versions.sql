-- Uruchom cały plik w Supabase SQL Editor. Nie zmienia istniejących dokumentów.
begin;
create or replace function public.save_knowledge_document(
  p_title text, p_chunks jsonb, p_pending jsonb, p_expected jsonb
) returns jsonb language plpgsql security invoker set search_path = public, extensions, pg_temp as $$
declare
  actual jsonb;
  new_document_id bigint;
  item jsonb;
begin
  -- Wspólna kolejność blokad dla zapisu i usunięcia, także między instancjami aplikacji.
  lock table public.documents in share row exclusive mode;
  lock table public.chunks in share row exclusive mode;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at) order by id), '[]'::jsonb)
    into actual from public.documents where title = p_title;
  -- Daty porównujemy jako timestamptz: JSON klienta może mieć inny zapis strefy.
  if jsonb_array_length(actual) <> jsonb_array_length(p_expected) or exists (
    select 1 from jsonb_array_elements(actual) a where not exists (
      select 1 from jsonb_array_elements(p_expected) e
      where (e->>'id')::bigint = (a->>'id')::bigint
        and (e->>'created_at')::timestamptz = (a->>'created_at')::timestamptz
    )
  ) then raise exception 'knowledge_version_conflict'; end if;
  if length(btrim(p_title)) = 0 or length(p_title) > 200
    or jsonb_array_length(p_chunks) = 0 then raise exception 'knowledge_invalid_document'; end if;
  for item in select value from jsonb_array_elements(p_pending) loop
    if jsonb_array_length(item->'embedding') <> 1536 then raise exception 'knowledge_invalid_embedding'; end if;
    update public.chunks set embedding = (item->'embedding')::text::vector(1536)
      where id = (item->>'id')::bigint and content = item->>'content' and embedding is null;
  end loop;
  -- Poprzednia wersja znika dopiero wewnątrz transakcji; błąd przywraca ją w całości.
  delete from public.chunks where document_id in (select id from public.documents where title = p_title);
  delete from public.documents where title = p_title;
  if exists (select 1 from public.chunks where embedding is null) then
    raise exception 'knowledge_pending_changed';
  end if;
  insert into public.documents(title) values (p_title) returning id into new_document_id;
  for item in select value from jsonb_array_elements(p_chunks) loop
    if jsonb_array_length(item->'embedding') <> 1536 or length(btrim(item->>'content')) = 0 then
      raise exception 'knowledge_invalid_embedding';
    end if;
    insert into public.chunks(document_id, chunk_index, content, embedding)
      values (new_document_id, (item->>'chunk_index')::integer, item->>'content', (item->'embedding')::text::vector(1536));
  end loop;
  return jsonb_build_object('documentId', new_document_id, 'title', p_title, 'chunks', jsonb_array_length(p_chunks));
end;
$$;

create or replace function public.delete_knowledge_document(p_id bigint, p_created_at timestamptz)
returns boolean language plpgsql security invoker set search_path = public, extensions, pg_temp as $$
begin
  lock table public.documents in share row exclusive mode;
  lock table public.chunks in share row exclusive mode;
  if not exists (select 1 from public.documents where id = p_id and created_at = p_created_at) then
    raise exception 'knowledge_version_conflict';
  end if;
  delete from public.chunks where document_id = p_id;
  delete from public.documents where id = p_id;
  return true;
end;
$$;
revoke all on function public.save_knowledge_document(text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.delete_knowledge_document(bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.save_knowledge_document(text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.delete_knowledge_document(bigint, timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;

