-- Let a draft hold what OCR actually read, and enforce correctness at publish.
--
-- The first migration put CHECK constraints on schedule_entries so a bad
-- reading could never reach the table. That turned out to defeat the review
-- flow it was meant to protect: the whole point of a draft is to hold what OCR
-- produced so a human can correct it, and a row the database refuses is a row
-- nobody can fix. An upload containing one misread weekday failed entirely,
-- with nothing stored and nothing to review.
--
-- So the guarantee moves rather than disappears. Drafts accept anything;
-- publishing is what requires valid data, enforced by triggers below so it
-- holds even if the application layer is bypassed.

-- ---------------------------------------------------------------------------
-- 1. Let drafts hold imperfect readings.
-- ---------------------------------------------------------------------------
alter table public.schedule_entries drop constraint if exists entries_time_format;
alter table public.schedule_entries drop constraint if exists entries_time_ordered;
alter table public.schedule_entries drop constraint if exists entries_day_valid;

alter table public.schedule_entries alter column day_th       drop not null;
alter table public.schedule_entries alter column time_start   drop not null;
alter table public.schedule_entries alter column time_end     drop not null;
alter table public.schedule_entries alter column subject_code drop not null;

-- ---------------------------------------------------------------------------
-- 2. The rules a published entry must satisfy — the old constraints, kept
--    verbatim, just applied at a different moment.
-- ---------------------------------------------------------------------------
create or replace function public.schedule_entry_problem(entry public.schedule_entries)
returns text
language plpgsql
immutable
as $$
begin
  if entry.day_th is null then
    return 'ไม่มีวันสอน';
  end if;

  if entry.day_th not in ('อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์') then
    return format('วันสอน "%s" ไม่ใช่วันในสัปดาห์', entry.day_th);
  end if;

  if entry.time_start is null or entry.time_end is null then
    return 'ไม่มีเวลาเริ่มหรือเวลาสิ้นสุด';
  end if;

  if entry.time_start !~ '^[0-2][0-9]:[0-5][0-9]$' or entry.time_end !~ '^[0-2][0-9]:[0-5][0-9]$' then
    return format('เวลา "%s–%s" ไม่ใช่รูปแบบ HH:MM', entry.time_start, entry.time_end);
  end if;

  if entry.time_end <= entry.time_start then
    return format('เวลาสิ้นสุด (%s) ไม่ได้อยู่หลังเวลาเริ่ม (%s)', entry.time_end, entry.time_start);
  end if;

  if entry.subject_code is null or btrim(entry.subject_code) = '' then
    return 'ไม่มีรหัสวิชา';
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Publishing a schedule requires every one of its entries to be valid.
-- ---------------------------------------------------------------------------
create or replace function public.check_entries_before_publish()
returns trigger
language plpgsql
as $$
declare
  bad_row public.schedule_entries;
  problem text;
  entry_count integer;
begin
  if new.status <> 'published' then
    return new;
  end if;

  if old.status = 'published' then
    return new;
  end if;

  select count(*) into entry_count
    from public.schedule_entries where schedule_id = new.id;

  if entry_count = 0 then
    raise exception 'ตารางสอนนี้ไม่มีคาบเรียนเลย จึงเผยแพร่ไม่ได้'
      using errcode = 'check_violation';
  end if;

  for bad_row in select * from public.schedule_entries where schedule_id = new.id loop
    problem := public.schedule_entry_problem(bad_row);
    if problem is not null then
      raise exception 'ยังมีคาบเรียนที่ข้อมูลไม่ถูกต้อง จึงเผยแพร่ไม่ได้: %', problem
        using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists schedules_check_entries_before_publish on public.schedules;
create trigger schedules_check_entries_before_publish
  before update on public.schedules
  for each row execute function public.check_entries_before_publish();

-- ---------------------------------------------------------------------------
-- 4. And an entry cannot be added to, or left invalid in, a schedule that is
--    already published — otherwise step 3 could be walked around by editing
--    after the fact.
-- ---------------------------------------------------------------------------
create or replace function public.check_entry_against_published()
returns trigger
language plpgsql
as $$
declare
  parent_status schedule_status;
  problem text;
begin
  select status into parent_status
    from public.schedules where id = new.schedule_id;

  if parent_status is distinct from 'published' then
    return new;
  end if;

  problem := public.schedule_entry_problem(new);
  if problem is not null then
    raise exception 'ตารางสอนนี้เผยแพร่แล้ว จึงบันทึกคาบเรียนที่ข้อมูลไม่ถูกต้องไม่ได้: %', problem
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists entries_check_against_published on public.schedule_entries;
create trigger entries_check_against_published
  before insert or update on public.schedule_entries
  for each row execute function public.check_entry_against_published();
