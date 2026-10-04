-- Dailies: shared team boards.
-- Run this once in your Supabase project: SQL Editor > New query > paste all of this > Run.
-- It is safe to run again: it only creates what is missing and replaces the functions and policies.
--
-- Who can see what (enforced by the database, not the app):
--   * You only see teams you belong to, and only the people and tasks in those teams.
--   * You join a team only with its invite link. Anyone can create a new team.
--   * Any member can add tasks and update a task's status, priority, sector or next step.
--   * A task can be deleted by the person who added it, or by the team owner.

-- ---------- tables ----------
create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_by  uuid not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  team_id   uuid not null references public.teams(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  name      text not null check (char_length(name) between 1 and 60),
  sector    text not null default '' check (char_length(sector) <= 30),
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists members_user_idx on public.members (user_id);

create table if not exists public.entries (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  owner      text not null default '' check (char_length(owner) <= 60),
  task       text not null check (char_length(task) between 1 and 120),
  sector     text not null default '' check (char_length(sector) <= 30),
  status     text not null check (status in ('Not started', 'In progress', 'In review', 'Blocked', 'Done')),
  priority   text not null check (priority in ('High', 'Medium', 'Low')),
  round      int check (round between 1 and 999),
  next       text not null default '' check (char_length(next) <= 300),
  summary    text not null default '' check (char_length(summary) <= 600),
  blocker    text not null default '' check (char_length(blocker) <= 300),
  day        date not null default current_date,
  raw        text not null default '' check (char_length(raw) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists entries_team_idx on public.entries (team_id, created_at);

-- ---------- helpers (security definer so policies don't recurse) ----------
create or replace function public.is_member(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.team_id = t and m.user_id = auth.uid());
$$;

create or replace function public.is_owner(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.team_id = t and m.user_id = auth.uid() and m.role = 'owner');
$$;

-- New tasks are always stamped with the signed-in person and their name in that team.
create or replace function public.entries_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.owner := coalesce((select m.name from public.members m where m.team_id = new.team_id and m.user_id = auth.uid()), '');
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists entries_stamp on public.entries;
create trigger entries_stamp before insert or update on public.entries
  for each row execute function public.entries_stamp();

-- ---------- actions the app calls ----------
create or replace function public.create_team(p_team text, p_name text, p_sector text default '')
returns public.teams language plpgsql security definer set search_path = '' as $$
declare t public.teams;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if (select count(*) from public.members where user_id = auth.uid() and role = 'owner') >= 20 then
    raise exception 'You already own 20 teams';
  end if;
  insert into public.teams (name, created_by) values (left(trim(p_team), 60), auth.uid()) returning * into t;
  insert into public.members (team_id, user_id, name, sector, role)
    values (t.id, auth.uid(), left(trim(p_name), 60), left(trim(coalesce(p_sector, '')), 30), 'owner');
  return t;
end $$;

create or replace function public.join_team(p_code text, p_name text, p_sector text default '')
returns public.teams language plpgsql security definer set search_path = '' as $$
declare t public.teams;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into t from public.teams where invite_code = lower(trim(p_code));
  if t.id is null then raise exception 'That invite link isn''t valid any more. Ask your team for a new one.'; end if;
  if not exists (select 1 from public.members where team_id = t.id and user_id = auth.uid()) then
    if (select count(*) from public.members where team_id = t.id) >= 200 then raise exception 'This team is full'; end if;
    insert into public.members (team_id, user_id, name, sector)
      values (t.id, auth.uid(), left(trim(p_name), 60), left(trim(coalesce(p_sector, '')), 30));
  end if;
  return t;
end $$;

create or replace function public.new_invite(p_team uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_owner(p_team) then raise exception 'Only the team owner can reset the invite link'; end if;
  update public.teams set invite_code = c where id = p_team;
  return c;
end $$;

-- Keeps the owner's name on their tasks in step when they rename themselves.
create or replace function public.members_rename() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name then
    update public.entries set owner = new.name where team_id = new.team_id and user_id = new.user_id;
  end if;
  return new;
end $$;
drop trigger if exists members_rename on public.members;
create trigger members_rename after update of name on public.members
  for each row execute function public.members_rename();

-- ---------- row-level security ----------
alter table public.teams   enable row level security;
alter table public.members enable row level security;
alter table public.entries enable row level security;

drop policy if exists teams_read on public.teams;
create policy teams_read on public.teams for select to authenticated using (public.is_member(id));
drop policy if exists teams_rename on public.teams;
create policy teams_rename on public.teams for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (public.is_member(team_id));
drop policy if exists members_edit_self on public.members;
create policy members_edit_self on public.members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists members_leave on public.members;
create policy members_leave on public.members for delete to authenticated
  using (user_id = auth.uid() or (public.is_owner(team_id) and role <> 'owner'));

drop policy if exists entries_read on public.entries;
create policy entries_read on public.entries for select to authenticated using (public.is_member(team_id));
drop policy if exists entries_add on public.entries;
create policy entries_add on public.entries for insert to authenticated with check (public.is_member(team_id));
drop policy if exists entries_edit on public.entries;
create policy entries_edit on public.entries for update to authenticated using (public.is_member(team_id)) with check (public.is_member(team_id));
drop policy if exists entries_remove on public.entries;
create policy entries_remove on public.entries for delete to authenticated
  using (user_id = auth.uid() or public.is_owner(team_id));

-- ---------- what the app is allowed to touch ----------
revoke all on public.teams, public.members, public.entries from anon, authenticated;
grant select on public.teams to authenticated;
grant update (name) on public.teams to authenticated;
grant select, delete on public.members to authenticated;
grant update (name, sector) on public.members to authenticated;
grant select, delete on public.entries to authenticated;
grant insert (team_id, task, sector, status, priority, round, next, summary, blocker, day, raw) on public.entries to authenticated;
grant update (task, sector, status, priority, next, blocker) on public.entries to authenticated;

revoke all on function public.create_team(text, text, text), public.join_team(text, text, text), public.new_invite(uuid),
  public.is_member(uuid), public.is_owner(uuid), public.entries_stamp(), public.members_rename() from public, anon;
grant execute on function public.create_team(text, text, text), public.join_team(text, text, text), public.new_invite(uuid),
  public.is_member(uuid), public.is_owner(uuid) to authenticated;

-- ---------- live updates ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'entries') then
      alter publication supabase_realtime add table public.entries;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'members') then
      alter publication supabase_realtime add table public.members;
    end if;
  end if;
end $$;
