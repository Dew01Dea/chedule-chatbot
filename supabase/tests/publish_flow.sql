-- Exercises the publish/replace flow against the real schema.
--
-- Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/publish_flow.sql
--
-- It rolls back at the end, so it is safe against a database with data in it.

begin;

\echo ''
\echo '=== setup: two teachers, each with a published 1/2569 schedule ==='

insert into teachers (code, full_name) values
  ('t_a', 'ครูทดสอบ เอ'),
  ('t_b', 'ครูทดสอบ บี');

insert into schedules (teacher_id, academic_year, semester, status, version)
  select id, 2569, 1, 'published', 1 from teachers where code = 't_a';
insert into schedules (teacher_id, academic_year, semester, status, version)
  select id, 2569, 1, 'published', 1 from teachers where code = 't_b';

insert into schedule_entries (schedule_id, day_th, time_start, time_end, subject_code, room)
  select s.id, 'จันทร์', '09:00', '11:00', 'A-101', 'ROOM-A'
  from schedules s join teachers t on t.id = s.teacher_id
  where t.code = 't_a' and s.status = 'published';

\echo ''
\echo '=== a replacement upload lands as a draft; the live schedule keeps serving ==='

insert into schedules (teacher_id, academic_year, semester, status, version)
  select id, 2569, 1, 'draft', 2 from teachers where code = 't_a';

select
  (select count(*) from schedules s join teachers t on t.id = s.teacher_id
    where t.code = 't_a' and s.status = 'published') as a_published,
  (select count(*) from schedules s join teachers t on t.id = s.teacher_id
    where t.code = 't_a' and s.status = 'draft') as a_draft;
\echo 'expected: a_published = 1, a_draft = 1'

\echo ''
\echo '=== publishing WITHOUT archiving first must fail ==='
savepoint before_naive_publish;
\set ON_ERROR_STOP off
update schedules set status = 'published'
 where version = 2
   and teacher_id = (select id from teachers where code = 't_a');
\set ON_ERROR_STOP on
rollback to savepoint before_naive_publish;
\echo 'expected: rejected by schedules_one_published_per_term'

\echo ''
\echo '=== archive-then-publish, which is what publishSchedule() does ==='

update schedules set status = 'archived'
 where teacher_id = (select id from teachers where code = 't_a')
   and academic_year = 2569 and semester = 1 and status = 'published';

update schedules set status = 'published', published_at = now()
 where teacher_id = (select id from teachers where code = 't_a')
   and academic_year = 2569 and semester = 1 and version = 2;

select s.version, s.status
  from schedules s join teachers t on t.id = s.teacher_id
 where t.code = 't_a' order by s.version;
\echo 'expected: version 1 archived, version 2 published'

\echo ''
\echo '=== the archived schedule keeps its rows; history is not destroyed ==='
select count(*) as archived_entries_kept
  from schedule_entries e
  join schedules s on s.id = e.schedule_id
  join teachers t on t.id = s.teacher_id
 where t.code = 't_a' and s.status = 'archived';
\echo 'expected: 1'

\echo ''
\echo '=== teacher B is entirely unaffected ==='
select s.version, s.status
  from schedules s join teachers t on t.id = s.teacher_id
 where t.code = 't_b';
\echo 'expected: version 1 still published'

rollback;
