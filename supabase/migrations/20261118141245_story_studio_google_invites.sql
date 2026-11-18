create table public.story_studio_google_invites (
  email text primary key check (
    email = lower(email)
    and length(email) <= 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ),
  enabled boolean not null default true,
  can_bring_key boolean not null default false
);

alter table public.story_studio_google_invites enable row level security;
revoke all on table public.story_studio_google_invites from public, anon, authenticated;
grant select, insert, update, delete on table public.story_studio_google_invites to service_role;

create schema story_studio_private;
revoke all on schema story_studio_private from public, anon, authenticated;
grant usage on schema story_studio_private to authenticated;

-- Only this function can read the private Auth identity and insert the caller's own account.
-- Keep it outside the schemas exposed by the Data API.
create function story_studio_private.redeem_google_invite()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid := auth.uid();
  claims jsonb := auth.jwt();
  google_email text := lower(claims ->> 'email');
begin
  if account_id is null or google_email is null
    or claims #>> '{app_metadata,provider}' is distinct from 'google'
    or (claims #> '{app_metadata,providers}') is distinct from '["google"]'::jsonb
    or ((claims -> 'amr') @> '[{"method":"oauth"}]'::jsonb) is not true
    or not exists (
      select 1
      from auth.users as account
      join auth.identities as identity on identity.user_id = account.id
      where account.id = account_id
        and account.email_confirmed_at is not null
        and lower(account.email) = google_email
        and identity.provider = 'google'
        and lower(identity.identity_data ->> 'email') = google_email
        and identity.identity_data -> 'email_verified' = 'true'::jsonb
    )
  then
    return false;
  end if;

  insert into public.story_studio_accounts (user_id, can_bring_key)
  select account_id, invite.can_bring_key
  from public.story_studio_google_invites as invite
  where invite.email = google_email and invite.enabled
  on conflict (user_id) do nothing;

  return exists (
    select 1 from public.story_studio_accounts
    where user_id = account_id and enabled
  );
end;
$$;

revoke all on function story_studio_private.redeem_google_invite() from public, anon, authenticated;
grant execute on function story_studio_private.redeem_google_invite() to authenticated;

create function public.story_studio_redeem_google_invite()
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select story_studio_private.redeem_google_invite();
$$;

revoke all on function public.story_studio_redeem_google_invite() from public, anon, authenticated;
grant execute on function public.story_studio_redeem_google_invite() to authenticated;
