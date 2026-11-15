-- Areas are shown as names only ("Electronics City"), never with a PIN code. Older app versions saved
-- "Electronics City · 560100"; strip the trailing PIN from profiles and bookings, and keep it off for good.
create or replace function private.area_name(a text) returns text language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(coalesce(a, ''), '\s*[·•,\-–(]?\s*(PIN\s*)?\d{6}\)?\s*$', '', 'i')), '')
$$;

update public.profiles set area = private.area_name(area) where area ~ '\d{6}';
update public.bookings set area = private.area_name(area) where area ~ '\d{6}';

create or replace function private.clean_area() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.area ~ '\d{6}' then new.area := private.area_name(new.area); end if;
  return new;
end $$;
drop trigger if exists profiles_clean_area on public.profiles;
create trigger profiles_clean_area before insert or update of area on public.profiles for each row execute function private.clean_area();
drop trigger if exists bookings_clean_area on public.bookings;
create trigger bookings_clean_area before insert or update of area on public.bookings for each row execute function private.clean_area();
