-- Schedule chatbot: multi-teacher schema.
--
-- Shape follows how the data is actually used:
--   * the chatbot only ever reads ONE published schedule for ONE teacher,
--   * the admin flow builds a schedule up privately and publishes it later,
--   * every OCR'd row has to be reviewable on its own.
--
-- All writes go through the backend using the service role key. Anonymous
-- clients get read access to published data only, enforced by RLS below.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- teachers
-- ---------------------------------------------------------------------------
create table if not exists public.teachers (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  full_name    text not null,
  nickname     text,
  education    text,
  duty         text,
  department   text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.teachers.code is
  'Stable human-readable key (e.g. "maitri"). Used so re-running the JSON import does not duplicate teachers.';

-- ---------------------------------------------------------------------------
-- schedules: one teacher's timetable for one academic year + semester.
-- ---------------------------------------------------------------------------
-- create type has no IF NOT EXISTS, so guard it to keep the whole file re-runnable.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'schedule_status') then
    create type schedule_status as enum ('draft', 'needs_review', 'published', 'archived');
  end if;
end
$$;

create table if not exists public.schedules (
  id                   uuid primary key default gen_random_uuid(),
  teacher_id           uuid not null references public.teachers(id) on delete cascade,
  academic_year        integer not null,
  semester             integer not null,
  college              text,
  department           text,
  week_range           text,
  semester_start_date  date,
  semester_end_date    date,
  status               schedule_status not null default 'draft',
  version              integer not null default 1,
  source_file_name     text,
  reviewed_by          text,
  reviewed_at          timestamptz,
  published_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint schedules_semester_valid check (semester between 1 and 3),
  constraint schedules_year_valid check (academic_year between 2500 and 2700),
  constraint schedules_dates_ordered check (
    semester_start_date is null
    or semester_end_date is null
    or semester_end_date >= semester_start_date
  )
);

-- The core guarantee behind "a new upload must not corrupt anyone else's data":
-- at most ONE published schedule per teacher per term. Older ones must be
-- archived first, which is what publishSchedule() does in a single call.
create unique index if not exists schedules_one_published_per_term
  on public.schedules (teacher_id, academic_year, semester)
  where status = 'published';

create index if not exists schedules_teacher_idx on public.schedules (teacher_id);
create index if not exists schedules_status_idx on public.schedules (status);

-- ---------------------------------------------------------------------------
-- subjects: the subject list printed on the schedule document.
-- Scoped to a schedule, not global, because hours/credits are per-term.
-- ---------------------------------------------------------------------------
create table if not exists public.subjects (
  id                    uuid primary key default gen_random_uuid(),
  schedule_id           uuid not null references public.schedules(id) on delete cascade,
  code                  text not null,
  name                  text not null,
  theory_hours          integer,
  practice_hours        integer,
  credit_units          integer,
  total_hours_per_week  integer,
  created_at            timestamptz not null default now(),

  unique (schedule_id, code)
);

-- ---------------------------------------------------------------------------
-- schedule_entries: one teaching session (a block in the timetable grid).
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_entries (
  id             uuid primary key default gen_random_uuid(),
  schedule_id    uuid not null references public.schedules(id) on delete cascade,
  day_th         text not null,
  day_en         text,
  time_start     text not null,
  time_end       text not null,
  subject_code   text not null,
  session_type   text,
  room           text,
  student_group  text,
  student_count  integer,
  note           text,

  -- Review bookkeeping. needs_review is set by the validator, never by OCR
  -- confidence alone: a confident wrong reading is still wrong.
  needs_review   boolean not null default false,
  source_page    integer,
  edited_by      text,
  edited_at      timestamptz,

  created_at     timestamptz not null default now(),

  constraint entries_time_format check (
    time_start ~ '^[0-2][0-9]:[0-5][0-9]$' and time_end ~ '^[0-2][0-9]:[0-5][0-9]$'
  ),
  constraint entries_time_ordered check (time_end > time_start),
  constraint entries_day_valid check (
    day_th in ('อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์')
  )
);

create index if not exists entries_schedule_idx on public.schedule_entries (schedule_id);
create index if not exists entries_schedule_day_idx on public.schedule_entries (schedule_id, day_th);

-- ---------------------------------------------------------------------------
-- documents: the uploaded PDF behind a schedule.
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid not null references public.teachers(id) on delete cascade,
  schedule_id    uuid references public.schedules(id) on delete set null,
  storage_path   text not null,
  file_name      text not null,
  file_size      integer,
  -- SHA-256 of the PDF bytes. Unique per teacher so re-uploading the same file
  -- is rejected instead of silently creating a second schedule.
  checksum       text not null,
  page_count     integer,
  ocr_status     text not null default 'pending',
  ocr_error      text,
  uploaded_by    text,
  uploaded_at    timestamptz not null default now(),

  constraint documents_ocr_status_valid check (ocr_status in ('pending', 'processing', 'done', 'failed')),
  unique (teacher_id, checksum)
);

create index if not exists documents_schedule_idx on public.documents (schedule_id);

-- ---------------------------------------------------------------------------
-- validation_issues: what the validator found, so the review UI can show
-- exactly which rows need a human and why.
-- ---------------------------------------------------------------------------
create table if not exists public.validation_issues (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid not null references public.schedules(id) on delete cascade,
  entry_id     uuid references public.schedule_entries(id) on delete cascade,
  severity     text not null,
  rule_code    text not null,
  message      text not null,
  resolved     boolean not null default false,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),

  constraint issues_severity_valid check (severity in ('error', 'warning'))
);

create index if not exists issues_schedule_idx on public.validation_issues (schedule_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists teachers_touch_updated_at on public.teachers;
create trigger teachers_touch_updated_at
  before update on public.teachers
  for each row execute function public.touch_updated_at();

drop trigger if exists schedules_touch_updated_at on public.schedules;
create trigger schedules_touch_updated_at
  before update on public.schedules
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- The service role bypasses RLS entirely, so these policies describe what an
-- anonymous/authenticated client may see if it ever talks to Supabase
-- directly. The rule is: published data only, nothing in review.
-- ---------------------------------------------------------------------------
alter table public.teachers          enable row level security;
alter table public.schedules         enable row level security;
alter table public.subjects          enable row level security;
alter table public.schedule_entries  enable row level security;
alter table public.documents         enable row level security;
alter table public.validation_issues enable row level security;

-- Teachers are listable only when they are active AND actually have something
-- published, so the picker cannot advertise an empty teacher.
drop policy if exists teachers_public_read on public.teachers;
create policy teachers_public_read on public.teachers
  for select using (
    is_active
    and exists (
      select 1 from public.schedules s
      where s.teacher_id = teachers.id and s.status = 'published'
    )
  );

drop policy if exists schedules_public_read on public.schedules;
create policy schedules_public_read on public.schedules
  for select using (status = 'published');

drop policy if exists subjects_public_read on public.subjects;
create policy subjects_public_read on public.subjects
  for select using (
    exists (
      select 1 from public.schedules s
      where s.id = subjects.schedule_id and s.status = 'published'
    )
  );

drop policy if exists entries_public_read on public.schedule_entries;
create policy entries_public_read on public.schedule_entries
  for select using (
    exists (
      select 1 from public.schedules s
      where s.id = schedule_entries.schedule_id and s.status = 'published'
    )
  );

-- documents and validation_issues carry PDFs and reviewer notes. No public
-- policy at all: only the backend's service role can reach them.

-- ---------------------------------------------------------------------------
-- Storage bucket for the uploaded PDFs. Private; the backend hands out
-- short-lived signed URLs to reviewers instead of exposing the bucket.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('schedule-pdfs', 'schedule-pdfs', false)
on conflict (id) do nothing;
