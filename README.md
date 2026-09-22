# ตารางสอน Chatbot — Thai Teacher Schedule Assistant

A chatbot that answers questions about teachers' class schedules, extracted
from Thai-language PDFs and powered end-to-end by Typhoon — a model family
built specifically for Thai OCR and Thai conversation.

It supports many teachers. A user picks a teacher, and answers come only from
that teacher's published schedule.

## How it works

```
admin picks a teacher + term
  → uploads a schedule PDF
  → rendered to page images (poppler)
  → Typhoon OCR reads the Thai text/table layout  → raw markdown
  → Typhoon's instruct model structures it        → schema JSON
  → validator checks it                           → errors / warnings
  → stored as a DRAFT (the live schedule keeps serving)
  → admin reviews it beside the original PDF, fixes what OCR got wrong
  → admin publishes  → the previous version is archived, not deleted

user picks a teacher → asks a question
  → backend loads ONLY that teacher's published schedule
  → Typhoon's instruct model answers from that data alone
```

Two Typhoon models, two jobs:

- **Typhoon OCR** (`typhoon-ocr`) reads the actual Thai document — purpose-built
  for Thai OCR, handling tone marks, stacked vowels and merged table cells more
  reliably than general OCR engines.
- **Typhoon's instruct model** (`typhoon-v2.5-30b-a3b-instruct`) structures the
  raw markdown into schema JSON, and handles live chat.

## Requirements

- **Node.js 20+** (the tests use the built-in test runner).
- **poppler** — PDF pages are rasterised with `pdftoppm` before OCR.
  - macOS: `brew install poppler`
  - Ubuntu/Debian: `sudo apt-get install poppler-utils`
  - Windows: install poppler and add its `bin` folder to PATH
    ([builds here](https://github.com/oschwartz10612/poppler-windows/releases))
- **A Supabase project** for multi-teacher support (see below).

## Setup

### 1. Supabase

Create a project, then open
`supabase/migrations/20260922120000_schedule_chatbot_schema.sql` from this
repo, copy its **entire contents**, paste them into the Supabase SQL editor
and run. (Paste the SQL itself, not the file path — the editor has no access
to your filesystem.)

If you have the Supabase CLI linked to the project, you can instead run:

```bash
supabase db push
```

Either way this creates the tables, constraints, RLS policies and the private
`schedule-pdfs` storage bucket. It is safe to run more than once.

From **Project Settings → API** you need the project URL and the
**service_role** key. The service role key bypasses Row Level Security, so it
belongs only in the backend's environment — never in frontend code, and never
committed.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env
# fill in the values described below
npm run dev
```

Runs on `http://localhost:4000`.

| Variable | Purpose |
| --- | --- |
| `TYPHOON_API_KEY` | OCR and chat. Get one at [playground.opentyphoon.ai](https://playground.opentyphoon.ai/settings/api-key) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Bypasses RLS |
| `ADMIN_TOKENS` | `name:token` pairs, comma separated. Admin routes refuse everything while empty |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed in production |
| `APP_TIMEZONE` | Defaults to `Asia/Bangkok` |
| `PORT` | Defaults to 4000 |

Generate an admin token with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then set e.g. `ADMIN_TOKENS=somchai:<token>`. The name is recorded against
schedules that person publishes and rows they correct.

**Without Supabase configured** the server still starts, in a read-only
fallback mode serving the single schedule in `backend/data/schedule.json`. That
keeps an existing checkout working, but multiple teachers, uploads and the
review flow all need the database.

### 3. Importing the existing schedule

`backend/data/schedule.json` holds one teacher's real timetable. To bring it
into Supabase:

```bash
cd backend
node scripts/migrate-schedule-json.js --dry-run   # check first, no DB needed
node scripts/migrate-schedule-json.js
```

The script never writes to or deletes `schedule.json` — it stays as a backup —
and running it twice reports "already migrated" rather than duplicating
anything.

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173` and proxies `/api` to the backend.

- `/` — pick a teacher, then chat
- `/#admin` — the admin console (asks for an admin token)

## Tests

```bash
cd backend
npm test
```

47 tests covering validation rules, teacher naming, API scoping, admin
authorisation and upload handling. They use stubs for the database and for
Typhoon, so no network or API key is needed.

There is also a SQL test of the publish/replace flow, run against a database
with the schema applied:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/publish_flow.sql
```

It rolls back, so it is safe against a database with data in it.

## How multiple teachers stay separated

- `/api/chat` requires a `teacherId` and resolves it server-side. The query
  filters on that teacher and `status = 'published'`, so a draft or another
  teacher's timetable cannot come back. The model is never asked to work out
  who is meant.
- A partial unique index allows at most one *published* schedule per teacher
  per term. Drafts for the same term are allowed, which is what lets a
  replacement be prepared and reviewed while the current one keeps serving.
- Publishing archives the schedule it replaces rather than deleting it.
- Uploads are keyed by a SHA-256 of the file, so the same PDF cannot be
  processed twice for one teacher.
- PDFs live in a private bucket namespaced by teacher, reached through
  short-lived signed URLs.

## Validation before anything is published

`backend/services/scheduleValidator.js` first repairs what OCR reliably gets
almost right — Thai numerals, `09.00` for `09:00`, a stray `วัน` prefix, `ป.`
for `ปฏิบัติ` — and records each repair for the reviewer. What is left is
checked, and findings are split by what they imply:

- **Errors block publishing**: unreadable output, no sessions at all, a
  malformed or reversed time, an unknown weekday, a subject code absent from
  the document's own subject list, or two sessions overlapping on one day.
- **Warnings route the row to a reviewer**: a missing room or group, a
  duplicated row, an implausible hour, an unusually long session.

OCR confidence is deliberately not an input — a confidently misread room is
still wrong — so rows are judged on the data's internal consistency.

## Thai date & holiday awareness

The chatbot has no clock, so "today" is computed on the backend
(`services/dateService.js`) on every request and injected into the prompt.
Everything is derived from one timezone-aware breakdown, defaulting to
`Asia/Bangkok`.

`backend/data/holidays-2569.json` holds the official Thai government holiday
calendar for B.E. 2569 (2026), including compensatory ("ชดเชย") days. On each
chat request the backend filters it to the semester's date range and hands it
to the model.

**Caveat**: this is the *national government* calendar (วันหยุดราชการ), not a
college's own mid-term break or special closures. To scope holiday answers to
one semester, set `semester_start_date` and `semester_end_date` on the
schedule row from the college's official academic calendar — vocational
(สอศ.) terms often differ from general school (สพฐ.) terms.

For a future year, add e.g. `holidays-2570.json` in the same shape and register
it in the `HOLIDAY_FILES` map in `dateService.js`.

## API

### Public

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/teachers` | Teachers with a published schedule |
| `POST` | `/api/chat` | `{ message, teacherId, academicYear?, semester? }` |
| `GET` | `/api/schedule?teacherId=` | One teacher's published schedule |
| `GET` | `/api/health` | Status and which store is active |

### Admin (require `Authorization: Bearer <token>`)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/teachers/all` | Every teacher, including unpublished |
| `POST` | `/api/teachers` | Add a teacher |
| `PATCH` | `/api/teachers/:id` | Edit a teacher |
| `POST` | `/api/admin/schedules/upload` | Upload a PDF (multipart `schedulePdf`) |
| `GET` | `/api/admin/teachers/:id/schedules` | All versions, any status |
| `GET` | `/api/admin/schedules/:id` | A draft plus outstanding issues |
| `PATCH` | `/api/admin/schedules/:id/entries/:entryId` | Correct one row |
| `POST` | `/api/admin/schedules/:id/publish` | Publish, archiving what it replaces |

`POST /api/schedule/extract` from the previous version is gone. It accepted a
PDF from anyone and overwrote the live schedule; it now answers `410` pointing
at the authenticated replacement.
