-- Lets a signed-in player erase their account: the auth user (email) and, by cascade, their save.
-- security definer so it can reach auth.users; it only ever deletes the caller's own id.
create function public.delete_my_account() returns void
language sql security definer set search_path = ''
as $$ delete from auth.users where id = (select auth.uid()); $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
