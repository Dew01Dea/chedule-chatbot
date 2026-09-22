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
- **poppler** — PDF pages are rasterised with `pdftoppm` before OCR. If the
  server cannot find it, set `POPPLER_PATH` in `backend/.env` to poppler's bin
  directory (e.g. `C:\poppler\Library\bin`) and PATH stops mattering. That is
  the reliable option on Windows, where a process inherits PATH at launch and
  an editor's integrated terminal inherits it from the editor — so poppler can
  work in a new shell while the server still cannot see it.
  - macOS: `brew install poppler`
  - Ubuntu/Debian: `sudo apt-get install poppler-utils`
  - Windows: install poppler and add its `bin` folder to PATH
    ([builds here](https://github.com/oschwartz10612/poppler-windows/releases))
- **A Supabase project** for multi-teacher support (see below).

## Setup

### 1. Supabase

Create a project, then open
each file in `supabase/migrations/` **in filename order**, copy its entire
contents, paste them into the Supabase SQL editor and run. (Paste the SQL
itself, not the file path — the editor has no access to your filesystem.)

If you set the database up before, re-running only the newer files is enough;
each one is safe to run more than once.

If you have the Supabase CLI linked to the project, you can instead run:

```bash
supabase db push
```

Either way this creates the tables, constraints, RLS policies and the private
`schedule-pdfs` storage bucket. It is safe to run more than once.

From **Project Settings → API** you need the project URL and the server-side
key. Supabase labels that key **service_role** in older projects and **Secret
key** in newer ones — it is the same thing, and it is *not* the anon /
publishable key. The backend accepts it under either
`SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`; set whichever you
prefer, just one of them.

This key bypasses Row Level Security, so it belongs only in the backend's
environment — never in frontend code, and never committed.

If it is missing or misspelled the server does not fail loudly: it starts in
read-only JSON mode instead. The startup log names exactly which variable it
could not find, so check there first if uploads or the teacher list look
empty.

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
| `SUPABASE_SERVICE_ROLE_KEY`<br>(or `SUPABASE_SECRET_KEY`) | The server-side key. Bypasses RLS — server-only. Set one or the other |
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

### 3b. Checking the setup

If something is not working — the teacher list is empty, or the admin console
refuses your token — run:

```bash
cd backend
node scripts/check-setup.js
```

It reports what is configured and what is not, and what to do about each. It
prints no secret values.

It inspects the shell you run it from, which is not necessarily what the
server sees — a process inherits `PATH` when it starts, so installing poppler
without restarting the server leaves this script reporting success while
uploads keep failing. To ask the running server itself:

```
GET /api/admin/diagnostics     (needs the admin token)
```

If that reports poppler unavailable while the script says it is installed,
restart the server from a new terminal. The two failures it exists for are both quiet ones: a
missing Supabase key leaves the server in read-only mode rather than erroring,
and an unreadable `ADMIN_TOKENS` refuses every admin request while the startup
log still looks healthy.

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173` and proxies `/api` to the backend.

- `/` — pick a teacher, then chat
- `/#admin` — the admin console (asks for an admin token)

## Deployment

The two halves are deployed separately, because they need different things from
a host.

The **frontend** is a static bundle, so it goes to Vercel. The **backend** does
not: the OCR pipeline shells out to poppler's `pdftoppm` to rasterize each PDF
page, and that binary cannot be installed into a Vercel serverless function.
Uploads also run one Typhoon OCR call per page in sequence, which for a
multi-page PDF comfortably exceeds Vercel's function time limit. So the backend
runs as a container on a host that gives it a real filesystem and no request
deadline — Render, Railway and Fly.io all work; `backend/Dockerfile` is what
they build.

### 1. Backend

On Render, point a new Blueprint at this repository and it reads `render.yaml`,
which builds `backend/Dockerfile` and prompts for each secret. By hand, on any
Docker host, the settings are:

| Setting | Value |
| --- | --- |
| Dockerfile | `backend/Dockerfile` |
| Build context | `backend` |
| Health check | `/api/health` |

Set the same variables described in [Backend](#2-backend) above —
`TYPHOON_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_TOKENS`
and `APP_TIMEZONE`. Two behave differently in production:

- `ALLOWED_ORIGINS` — set this to the deployed frontend's origin, e.g.
  `https://your-app.vercel.app`. While it is empty the server accepts every
  origin and says so in a boot warning.
- `POPPLER_PATH` — leave it unset. The image installs `poppler-utils` into the
  normal location, so `pdftoppm` is already on `PATH`.

`PORT` is supplied by the host and read by `server.js`; there is no need to set
it yourself.

Confirm the deployment before moving on:

```bash
curl https://your-api-host/api/health
# {"status":"ok","store":"supabase","multiTeacher":true}
```

A `store` of `json` there means Supabase did not configure — check the URL and
that the key is the server-side one, not the anon key.

### 2. Frontend

Import the repository into Vercel. The root `vercel.json` already describes the
build — it installs and builds inside `frontend/` and serves `frontend/dist` —
so the Build & Development Settings in the dashboard should be left **empty**:

| Setting | Value |
| --- | --- |
| Root Directory | `./` |
| Build Command | *(empty)* |
| Output Directory | *(empty)* |
| Install Command | *(empty)* |

Both halves are worth stating plainly, because each one fails in a way that
does not name its cause:

- A value typed into one of those fields **overrides** `vercel.json`. Vercel's
  own placeholder text suggests `vite build`, and typing that in produces
  `vite: command not found`, because the repository root has no `package.json`
  — vite is installed under `frontend/`.
- Root Directory has to stay `./`. Vercel reads `vercel.json` from whatever the
  Root Directory is, so pointing it at `frontend` means the file is never read
  at all, and `--prefix frontend` would then resolve against the wrong
  directory.

`vercel.json` is validated against a strict schema that rejects unknown keys,
so it cannot carry JSON comments — anything worth explaining about the build
belongs here instead.

The one thing to add is an environment variable:

| Name | Value |
| --- | --- |
| `VITE_API_BASE_URL` | `https://your-api-host` (no trailing path) |

Vite inlines `VITE_*` variables **at build time**, so this ships inside the
public bundle and changing it needs a redeploy rather than a restart. Nothing
secret belongs in it. Left unset, the frontend requests `/api/...` relative to
itself, which is correct in local development — where Vite proxies to
`localhost:4000` — and broken once deployed.

Routing is done on the URL hash, so `/#admin` needs no rewrite rules.

### 3. Connecting them

The two origins differ, so the browser preflights every admin call. Once both
are deployed, set `ALLOWED_ORIGINS` on the backend to the Vercel origin and
redeploy it; until then the admin console will fail with
`ต้นทางนี้ไม่ได้รับอนุญาต`. Vercel preview deployments each get their own
origin, so add any you intend to use to the same comma-separated list.

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
  A draft still *stores* these rows — that is what the reviewer is there to
  correct — and the database enforces the same rules at publish time, so a
  schedule with an uncorrected row cannot go live even if the application
  layer is bypassed.
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
