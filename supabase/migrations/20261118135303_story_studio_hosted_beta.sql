create table public.story_studio_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  can_bring_key boolean not null default false
);

create table public.story_studio_libraries (
  user_id uuid primary key default auth.uid()
    references public.story_studio_accounts (user_id) on delete cascade,
  library jsonb not null check (
    jsonb_typeof(library) = 'object' and library ? 'projects'
    and jsonb_typeof(library -> 'projects') = 'array'
  ),
  revision text not null check (length(revision) between 1 and 128)
);

create table public.story_studio_records (
  user_id uuid default auth.uid()
    references public.story_studio_accounts (user_id) on delete cascade,
  record_key text check (length(record_key) between 1 and 512),
  value jsonb not null,
  revision text not null check (length(revision) between 1 and 128),
  primary key (user_id, record_key)
);

create table public.story_studio_provider_keys (
  user_id uuid default auth.uid()
    references public.story_studio_accounts (user_id) on delete cascade,
  provider text check (provider in ('openrouter', 'anthropic', 'openai')),
  ciphertext text not null check (length(ciphertext) between 1 and 4096),
  primary key (user_id, provider)
);

alter table public.story_studio_accounts enable row level security;
alter table public.story_studio_libraries enable row level security;
alter table public.story_studio_records enable row level security;
alter table public.story_studio_provider_keys enable row level security;

revoke all on table public.story_studio_accounts, public.story_studio_libraries,
  public.story_studio_records, public.story_studio_provider_keys
  from public, anon, authenticated;

grant select on table public.story_studio_accounts to authenticated;
grant select, insert, update on table public.story_studio_libraries to authenticated;
grant select, insert, update, delete on table public.story_studio_records,
  public.story_studio_provider_keys to authenticated;
grant select, insert, update, delete on table public.story_studio_accounts to service_role;

create policy story_studio_account_owner on public.story_studio_accounts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy story_studio_library_owner on public.story_studio_libraries
  for all to authenticated
  using (user_id = (select auth.uid()) and (select enabled from public.story_studio_accounts
    where user_id = (select auth.uid())))
  with check (user_id = (select auth.uid()) and (select enabled from public.story_studio_accounts
    where user_id = (select auth.uid())));

create policy story_studio_record_owner on public.story_studio_records
  for all to authenticated
  using (user_id = (select auth.uid()) and (select enabled from public.story_studio_accounts
    where user_id = (select auth.uid())))
  with check (user_id = (select auth.uid()) and (select enabled from public.story_studio_accounts
    where user_id = (select auth.uid())));

create policy story_studio_key_owner on public.story_studio_provider_keys
  for all to authenticated
  using (user_id = (select auth.uid()) and (select enabled and can_bring_key
    from public.story_studio_accounts where user_id = (select auth.uid())))
  with check (user_id = (select auth.uid()) and (select enabled and can_bring_key
    from public.story_studio_accounts where user_id = (select auth.uid())));

create function public.story_studio_save_library(
  p_library jsonb, p_expected_revision text, p_revision text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_expected_revision is null then
    insert into public.story_studio_libraries (library, revision)
    values (p_library, p_revision)
    on conflict (user_id) do nothing;
  else
    update public.story_studio_libraries
    set library = p_library, revision = p_revision
    where user_id = (select auth.uid()) and revision = p_expected_revision;
  end if;
  return found;
end;
$$;

create function public.story_studio_save_record(
  p_record_key text, p_value jsonb, p_expected_revision text, p_revision text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_expected_revision is null then
    insert into public.story_studio_records (record_key, value, revision)
    values (p_record_key, p_value, p_revision)
    on conflict (user_id, record_key) do nothing;
  else
    update public.story_studio_records
    set value = p_value, revision = p_revision
    where user_id = (select auth.uid()) and record_key = p_record_key
      and revision = p_expected_revision;
  end if;
  return found;
end;
$$;

create function public.story_studio_update_provider_keys(p_changes jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  change record;
begin
  if not exists (
    select 1 from public.story_studio_accounts
    where user_id = account_id and enabled and can_bring_key
  ) then
    raise insufficient_privilege using message = 'This account cannot manage provider keys.';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise invalid_parameter_value using message = 'Provider key changes must be an object.';
  end if;
  for change in select key, value from jsonb_each(p_changes) order by key loop
    if change.key not in ('openrouter', 'anthropic', 'openai')
      or jsonb_typeof(change.value) not in ('string', 'null') then
      raise invalid_parameter_value using message = 'Invalid provider key change.';
    end if;
    if jsonb_typeof(change.value) = 'null' then
      delete from public.story_studio_provider_keys
      where user_id = account_id and provider = change.key;
    else
      insert into public.story_studio_provider_keys (user_id, provider, ciphertext)
      values (account_id, change.key, change.value #>> '{}')
      on conflict (user_id, provider) do update set ciphertext = excluded.ciphertext;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.story_studio_save_library(jsonb, text, text),
  public.story_studio_save_record(text, jsonb, text, text),
  public.story_studio_update_provider_keys(jsonb) from public, anon, authenticated;
grant execute on function public.story_studio_save_library(jsonb, text, text),
  public.story_studio_save_record(text, jsonb, text, text),
  public.story_studio_update_provider_keys(jsonb) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('story-studio-private', 'story-studio-private', false, 20000000,
  array['image/png', 'image/jpeg', 'image/webp', 'application/gzip']);

create policy story_studio_storage_owner on storage.objects
  for all to authenticated
  using (
    bucket_id = 'story-studio-private' and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select enabled from public.story_studio_accounts where user_id = (select auth.uid()))
  )
  with check (
    bucket_id = 'story-studio-private' and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select enabled from public.story_studio_accounts where user_id = (select auth.uid()))
  );
