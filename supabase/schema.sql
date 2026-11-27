-- LPTI CSR roster: tables and functions.
-- Run once in the Supabase SQL editor (and again after changes; it is written to be re-runnable).
--
-- Access model:
--   * Tables have row-level security on and NO policies, so the public (anon) key cannot read or write them directly.
--   * The app calls the functions below through the REST API. Each function checks the operator passcode or the CSR's PIN.
--   * PINs and the operator passcode are stored as salted SHA-256 hashes.

create table if not exists csr_members (
  csr_code      text primary key check (csr_code ~ '^[A-Z]{2,4}$'),
  name          text not null,
  language_code text not null,
  airport_pass  text not null default 'N/A',
  availability  text not null default 'Available',
  pin_salt      text not null,
  pin_hash      text not null
);

create table if not exists roster (
  id             bigserial primary key,
  service_date   date not null,
  movement_no    int  not null,
  guest_group    text not null default '',
  file_code      text not null default '',
  pax            text not null default '',
  movement_type  text not null default '',
  mode           text not null default '',
  flight         text not null default '',
  scheduled_time text not null default '',
  pickup         text not null default '',
  dropoff        text not null default '',
  reporting_time text not null default '',
  vehicle        text not null default '',
  report_at      text not null default '',
  language_code  text not null default '',
  airport        boolean not null default false,
  csr_code       text references csr_members(csr_code),
  status         text not null default 'Allocated' check (status in ('Allocated', 'Accepted', 'Reallocated', 'Unassigned')),
  rejected_by    text[] not null default '{}',
  roster_key     text,
  fh             text not null default '',
  unique (service_date, movement_no)
);

create table if not exists operator_auth (
  id           int primary key default 1 check (id = 1),
  passcode_salt text not null,
  passcode_hash text not null
);

alter table csr_members enable row level security;
alter table roster enable row level security;
alter table operator_auth enable row level security;

-- How many bookings each CSR rejected on each service date. One row per CSR per date, counted up on each rejection.
create table if not exists csr_rejection_counts (
  csr_code       text not null references csr_members(csr_code),
  service_date   date not null,
  rejected_count int  not null default 0,
  primary key (csr_code, service_date)
);
alter table csr_rejection_counts enable row level security;

-- Each movement is keyed by its S.No and date, e.g. 1_2026-11-23. Tables created before this column existed
-- are upgraded here. Safe to run again.
alter table roster add column if not exists roster_key text;
update roster set roster_key = to_char(service_date, 'YYYY-MM-DD') || '_' || movement_no where roster_key is null;
create unique index if not exists roster_roster_key_uq on roster (roster_key);
alter table roster add column if not exists fh text not null default '';

-- 'Rejected' is now 'Reallocated': a booking passed on after a CSR rejected it. Existing rows are renamed first,
-- then the status rule is replaced. Safe to run again.
alter table roster drop constraint if exists roster_status_check;
update roster set status = 'Reallocated' where status = 'Rejected';
alter table roster add constraint roster_status_check check (status in ('Allocated', 'Accepted', 'Reallocated', 'Unassigned'));

-- ---------- helpers ----------

create or replace function hash_secret(p_secret text, p_salt text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(p_secret || ':' || p_salt, 'UTF8')), 'hex');
$$;

create or replace function minutes_of(t text)
returns int language sql immutable as $$
  select case when t ~ '^[0-9]{1,2}:[0-9]{2}$'
              then split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int
         end;
$$;

create or replace function is_operator(p_pass text)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from operator_auth a
    where a.id = 1 and a.passcode_hash = hash_secret(p_pass, a.passcode_salt)
  );
$$;

create or replace function check_csr(p_csr text, p_pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from csr_members m
    where m.csr_code = p_csr and m.pin_hash = hash_secret(p_pin, m.pin_salt)
  ) then
    raise exception 'Invalid CSR code or PIN';
  end if;
end;
$$;

-- ---------- operator ----------

-- Set or change the operator passcode. Run once from the SQL editor, with your own value:
--   select set_operator_passcode('your-passcode');
create or replace function set_operator_passcode(p_pass text)
returns void language plpgsql security definer set search_path = public as $$
declare s text := md5(random()::text || clock_timestamp()::text);
begin
  insert into operator_auth (id, passcode_salt, passcode_hash)
  values (1, s, hash_secret(p_pass, s))
  on conflict (id) do update
    set passcode_salt = excluded.passcode_salt, passcode_hash = excluded.passcode_hash;
end;
$$;

-- Publish one day's roster. p_csrs: [{csr_code,name,language_code,airport_pass,availability,pin}]
-- p_rows: [{movement_no,guest_group,file_code,pax,movement_type,mode,flight,scheduled_time,pickup,dropoff,
--           reporting_time,vehicle,report_at,language_code,airport,csr_code,status}]
-- Brings the day's roster in line with the chart, movement by movement (key = S.No and date).
-- Unchanged bookings keep their CSR, accept/reject responses and rejections; changed bookings are reset to
-- the new allocation; movements no longer on the chart are removed.
create or replace function publish_roster(p_pass text, p_date date, p_csrs jsonb, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare c jsonb; r jsonb; n int := 0; s text; v_key text; v_manual boolean; lv text;
begin
  if not is_operator(p_pass) then raise exception 'Operator passcode is wrong'; end if;

  for c in select * from jsonb_array_elements(p_csrs) loop
    s := md5(random()::text || clock_timestamp()::text || (c->>'csr_code'));
    insert into csr_members (csr_code, name, language_code, airport_pass, availability, pin_salt, pin_hash)
    values (c->>'csr_code', c->>'name', coalesce(c->>'language_code', ''), coalesce(c->>'airport_pass', 'N/A'),
            coalesce(c->>'availability', 'Available'), s, hash_secret(c->>'pin', s))
    on conflict (csr_code) do update
      set name = excluded.name,
          language_code = excluded.language_code,
          airport_pass = excluded.airport_pass,
          availability = excluded.availability,
          pin_salt = excluded.pin_salt,
          pin_hash = excluded.pin_hash;
  end loop;

  delete from roster
  where service_date = p_date
    and not exists (
      select 1 from jsonb_array_elements(p_rows) x
      where (x->>'movement_no')::int = roster.movement_no
    );

  for r in select * from jsonb_array_elements(p_rows) loop
    v_key := p_date::text || '_' || ((r->>'movement_no')::int)::text;
    v_manual := coalesce((r->>'csr_manual')::boolean, false); -- CSR was set by hand on the chart
    insert into roster (roster_key, service_date, movement_no, guest_group, file_code, pax, movement_type, mode, flight,
                        scheduled_time, pickup, dropoff, reporting_time, vehicle, report_at, language_code,
                        airport, csr_code, status, fh)
    values (v_key, p_date, (r->>'movement_no')::int, coalesce(r->>'guest_group', ''), coalesce(r->>'file_code', ''),
            coalesce(r->>'pax', ''), coalesce(r->>'movement_type', ''), coalesce(r->>'mode', ''),
            coalesce(r->>'flight', ''), coalesce(r->>'scheduled_time', ''), coalesce(r->>'pickup', ''),
            coalesce(r->>'dropoff', ''), coalesce(r->>'reporting_time', ''), coalesce(r->>'vehicle', ''),
            coalesce(r->>'report_at', ''), coalesce(r->>'language_code', ''),
            coalesce((r->>'airport')::boolean, false), nullif(r->>'csr_code', ''),
            coalesce(r->>'status', 'Allocated'), coalesce(r->>'fh', ''))
    on conflict (roster_key) do update set
      guest_group    = excluded.guest_group,
      fh             = excluded.fh,
      file_code      = excluded.file_code,
      pax            = excluded.pax,
      movement_type  = excluded.movement_type,
      mode           = excluded.mode,
      flight         = excluded.flight,
      scheduled_time = excluded.scheduled_time,
      pickup         = excluded.pickup,
      dropoff        = excluded.dropoff,
      reporting_time = excluded.reporting_time,
      vehicle        = excluded.vehicle,
      report_at      = excluded.report_at,
      language_code  = excluded.language_code,
      airport        = excluded.airport,
      csr_code = case when v_manual then excluded.csr_code
                 when roster.scheduled_time = excluded.scheduled_time
                       and roster.file_code = excluded.file_code and roster.flight = excluded.flight
                       and roster.movement_type = excluded.movement_type
                       and roster.pickup = excluded.pickup and roster.dropoff = excluded.dropoff
                 then roster.csr_code else excluded.csr_code end,
      status = case when v_manual then (case when excluded.csr_code is null then 'Unassigned' when roster.csr_code is distinct from excluded.csr_code then 'Allocated' else roster.status end)
                 when roster.scheduled_time = excluded.scheduled_time
                     and roster.file_code = excluded.file_code and roster.flight = excluded.flight
                     and roster.movement_type = excluded.movement_type
                     and roster.pickup = excluded.pickup and roster.dropoff = excluded.dropoff
                 then roster.status else excluded.status end,
      rejected_by = case when v_manual then roster.rejected_by
                         when roster.scheduled_time = excluded.scheduled_time
                          and roster.file_code = excluded.file_code and roster.flight = excluded.flight
                          and roster.movement_type = excluded.movement_type
                          and roster.pickup = excluded.pickup and roster.dropoff = excluded.dropoff
                    then roster.rejected_by else '{}'::text[] end;
    n := n + 1;
  end loop;

  -- A CSR on leave for this date never keeps a booking from the chart, whatever the chart says.
  for lv in select s.csr_code from csr_day_status s where s.service_date = p_date and s.status = 'On leave' loop
    perform reallocate_leave_bookings(lv, p_date);
  end loop;

  return n;
end;
$$;

-- ---------- CSR side ----------

-- Names for the CSR's name dropdown. No PINs or contact details are returned.
create or replace function list_csrs()
returns table (csr_code text, name text) language sql security definer set search_path = public as $$
  select m.csr_code, m.name from csr_members m order by m.name;
$$;

-- The CSR's bookings for a date, in ascending time order (blank times last).
create or replace function my_roster(p_csr text, p_pin text, p_date date)
returns setof roster language plpgsql security definer set search_path = public as $$
begin
  perform check_csr(p_csr, p_pin);
  return query
    select * from roster r
    where r.service_date = p_date and r.csr_code = p_csr
    order by (r.scheduled_time = '') , minutes_of(r.scheduled_time), r.movement_no;
end;
$$;

-- ---------- CSR availability for the next 3 days ----------

-- A CSR's own status for a service date. No row means Available. Only changes are stored.
create table if not exists csr_day_status (
  csr_code     text not null references csr_members(csr_code),
  service_date date not null,
  status       text not null default 'Available' check (status in ('Available', 'On leave')),
  primary key (csr_code, service_date)
);
alter table csr_day_status enable row level security;

-- Today in India (Asia/Kolkata), whatever the device's time zone. The availability window starts here.
create or replace function ist_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- Locked once the CSR has accepted any booking on that date: their status for it can no longer change.
create or replace function day_locked(p_csr text, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from roster r
    where r.service_date = p_date and r.csr_code = p_csr and r.status = 'Accepted'
  );
$$;

-- The next CSR for a booking: must be Available overall, not on leave that date, not in the excluded list,
-- with no booking within 90 minutes. Ordered by language, then airport pass, then lightest workload.
-- Returns null when nobody is free.
create or replace function pick_next_csr(p_booking roster, p_excluded text[])
returns text language sql stable security definer set search_path = public as $$
  select m.csr_code
  from csr_members m
  where m.availability = 'Available'
    and not (m.csr_code = any (p_excluded))
    and not exists (
      select 1 from csr_day_status s
      where s.csr_code = m.csr_code and s.service_date = p_booking.service_date and s.status = 'On leave'
    )
    and not exists (
      select 1 from roster o
      where o.service_date = p_booking.service_date
        and o.csr_code = m.csr_code
        and o.id <> p_booking.id
        and minutes_of(o.scheduled_time) is not null
        and minutes_of(p_booking.scheduled_time) is not null
        and abs(minutes_of(o.scheduled_time) - minutes_of(p_booking.scheduled_time)) < 90
    )
  order by
    (case when p_booking.language_code <> '' and m.language_code <> p_booking.language_code then 1 else 0 end),
    (case when p_booking.airport and m.airport_pass <> 'YES' then 1 else 0 end),
    (select count(*) from roster o where o.service_date = p_booking.service_date and o.csr_code = m.csr_code),
    m.name
  limit 1;
$$;

-- The CSR's status for each date in the window (today and the next 2 days, India time).
create or replace function my_availability(p_csr text, p_pin text)
returns table (day_date date, day_status text, is_locked boolean)
language plpgsql security definer set search_path = public as $$
begin
  perform check_csr(p_csr, p_pin);
  return query
    select d.day::date,
           coalesce(s.status, 'Available'),
           day_locked(p_csr, d.day::date)
    from generate_series(ist_today(), ist_today() + 2, interval '1 day') as d(day)
    left join csr_day_status s on s.csr_code = p_csr and s.service_date = d.day::date
    order by d.day;
end;
$$;

-- Moves every booking a CSR holds on a date to the next free CSR (Unassigned if none). Used when a CSR goes on leave.
-- Accepted bookings never reach here, because a date with an accepted booking is locked. Returns the number moved.
create or replace function reallocate_leave_bookings(p_csr text, p_date date)
returns int language plpgsql security definer set search_path = public as $$
declare b roster; v_new text; n int := 0;
begin
  for b in
    select * from roster r where r.service_date = p_date and r.csr_code = p_csr order by r.id for update
  loop
    v_new := pick_next_csr(b, b.rejected_by);
    if v_new is null then
      update roster set csr_code = null, status = 'Unassigned' where id = b.id;
    else
      update roster set csr_code = v_new, status = 'Reallocated' where id = b.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- CSR codes that are On leave for a date. Public: the names are already public, and no bookings are shown.
create or replace function list_csr_leave(p_date date)
returns setof text language sql stable security definer set search_path = public as $$
  select s.csr_code from csr_day_status s where s.service_date = p_date and s.status = 'On leave';
$$;

-- Set Available or On leave for one date in the window. Refused once the date is locked.
-- Setting On leave moves the CSR's bookings for that date to the next free CSR (Unassigned if none).
-- Returns how many bookings were moved or left unassigned.
create or replace function set_my_availability(p_csr text, p_pin text, p_date date, p_status text)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  perform check_csr(p_csr, p_pin);
  if p_status not in ('Available', 'On leave') then raise exception 'Status must be Available or On leave'; end if;
  if p_date < ist_today() or p_date > ist_today() + 2 then
    raise exception 'Availability can be set only for today and the next 2 days';
  end if;
  if day_locked(p_csr, p_date) then
    raise exception 'You have accepted a booking on % so this status is locked', p_date;
  end if;

  insert into csr_day_status (csr_code, service_date, status) values (p_csr, p_date, p_status)
  on conflict (csr_code, service_date) do update set status = excluded.status;

  if p_status = 'On leave' then
    n := reallocate_leave_bookings(p_csr, p_date);
  end if;

  return n;
end;
$$;

-- Accept a booking, or reject it. A rejected booking moves to the next best available CSR who has not rejected it,
-- preferring language, then airport pass, then lightest workload. No free CSR leaves it Unassigned.
create or replace function respond_booking(p_csr text, p_pin text, p_id bigint, p_action text)
returns text language plpgsql security definer set search_path = public as $$
declare b roster; v_new text; v_rejected text[];
begin
  perform check_csr(p_csr, p_pin);

  select * into b from roster where id = p_id and csr_code = p_csr for update;
  if not found then raise exception 'Booking not found for this CSR'; end if;

  if p_action = 'accept' then
    update roster set status = 'Accepted' where id = p_id;
    return 'Accepted';
  elsif p_action <> 'reject' then
    raise exception 'Action must be accept or reject';
  end if;

  v_rejected := b.rejected_by || p_csr;

  insert into csr_rejection_counts (csr_code, service_date, rejected_count)
  values (p_csr, b.service_date, 1)
  on conflict (csr_code, service_date)
    do update set rejected_count = csr_rejection_counts.rejected_count + 1;

  v_new := pick_next_csr(b, v_rejected);

  if v_new is null then
    update roster set csr_code = null, status = 'Unassigned', rejected_by = v_rejected where id = p_id;
    return 'Unassigned';
  end if;

  -- 'Reallocated' means it was passed on after a rejection and the new CSR has not yet responded.
  update roster set csr_code = v_new, status = 'Reallocated', rejected_by = v_rejected where id = p_id;
  return 'Reassigned';
end;
$$;

-- Allow the public key to call the functions. Tables stay closed.
grant execute on function publish_roster(text, date, jsonb, jsonb) to anon, authenticated;
grant execute on function list_csrs() to anon, authenticated;
grant execute on function my_roster(text, text, date) to anon, authenticated;
grant execute on function respond_booking(text, text, bigint, text) to anon, authenticated;
grant execute on function my_availability(text, text) to anon, authenticated;
grant execute on function set_my_availability(text, text, date, text) to anon, authenticated;
grant execute on function list_csr_leave(date) to anon, authenticated;

-- ---------- Operator side: unassigned bookings ----------

-- Bookings every eligible CSR has rejected (or no CSR was free for), for the operator to assign by hand.
create or replace function list_unassigned(p_pass text, p_date date)
returns setof roster language plpgsql security definer set search_path = public as $$
begin
  if not is_operator(p_pass) then raise exception 'Operator passcode is wrong'; end if;
  return query
    select * from roster r
    where r.service_date = p_date and r.status = 'Unassigned'
    order by minutes_of(r.scheduled_time) nulls last, r.movement_no;
end;
$$;

-- The operator gives an unassigned booking to a CSR. The CSR sees it as Allocated.
create or replace function assign_booking(p_pass text, p_id bigint, p_csr text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not is_operator(p_pass) then raise exception 'Operator passcode is wrong'; end if;
  if not exists (select 1 from csr_members where csr_code = p_csr) then raise exception 'Unknown CSR'; end if;
  update roster set csr_code = p_csr, status = 'Allocated' where id = p_id and status = 'Unassigned';
  if not found then raise exception 'Booking is not unassigned'; end if;
  return 'Allocated';
end;
$$;

-- Every booking for the date with its current CSR Response status, for the operator's table.
create or replace function list_roster(p_pass text, p_date date)
returns setof roster language plpgsql security definer set search_path = public as $$
begin
  if not is_operator(p_pass) then raise exception 'Operator passcode is wrong'; end if;
  return query select * from roster r where r.service_date = p_date order by r.movement_no;
end;
$$;

-- Operator view: rejections per CSR for a date (CSRs with none are shown as 0).
create or replace function list_rejection_counts(p_pass text, p_date date)
returns table (csr_code text, name text, rejected_count int)
language plpgsql security definer set search_path = public as $$
begin
  if not is_operator(p_pass) then raise exception 'Operator passcode is wrong'; end if;
  return query
    select m.csr_code, m.name, coalesce(c.rejected_count, 0)
    from csr_members m
    left join csr_rejection_counts c on c.csr_code = m.csr_code and c.service_date = p_date
    order by coalesce(c.rejected_count, 0) desc, m.name;
end;
$$;

grant execute on function list_rejection_counts(text, date) to anon, authenticated;
grant execute on function list_roster(text, date) to anon, authenticated;
grant execute on function list_unassigned(text, date) to anon, authenticated;
grant execute on function assign_booking(text, bigint, text) to anon, authenticated;
