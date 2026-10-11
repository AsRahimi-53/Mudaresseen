-- Defence in depth: the shared connection settings ("onlineConfig") must never be
-- stored in district_settings, so one district administrator can not push connection
-- settings to the other users of the district. The application already removes the key
-- on push and on pull; this trigger enforces it in the database as well.
-- Safe: adds a trigger only. It does not change or delete any existing row.
begin;

create or replace function public.strip_locked_settings()
returns trigger language plpgsql as $$
begin
  if new.data is not null and jsonb_typeof(new.data) = 'object' then
    new.data := new.data - 'onlineConfig';
  end if;
  return new;
end;
$$;

drop trigger if exists district_settings_strip_locked on public.district_settings;
create trigger district_settings_strip_locked
before insert or update on public.district_settings
for each row execute function public.strip_locked_settings();

commit;

-- OPTIONAL one-time cleanup of values saved by older versions. It modifies existing rows
-- (it only removes the "onlineConfig" key), so run it ONLY after you have approved it:
--   update public.district_settings set data = data - 'onlineConfig' where data ? 'onlineConfig';
-- Check first what would change:
--   select district_id, data ? 'onlineConfig' as has_online_config from public.district_settings;
