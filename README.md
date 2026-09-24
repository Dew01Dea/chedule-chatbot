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

The repository is an npm workspace, so one install at the root covers both
halves:

```bash
npm install                       # from the repository root, installs both
cp backend/.env.example backend/.env
# fill in the values described below
npm run dev:backend
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

Already installed by the root `npm install` above, so this only needs starting:

```bash
npm run dev:frontend
```

Runs on `http://localhost:5173` and proxies `/api` to `localhost:4000`. That
proxy is configured in `frontend/vite.config.js` and applies to `npm run dev`
only — it is not part of a production build, where the frontend instead uses a
relative `/api` path against whatever origin serves it.

- `/` — pick a teacher, then chat
- `/#admin` — the admin console (asks for an admin token)

## Deployment

Both halves deploy to Vercel from one project: the frontend as the static
bundle, the backend as a single serverless function. The repository is an npm
workspace, so `npm ci` at the root installs both and `vercel.json` describes the
rest.

### What does not work on Vercel

Uploading a schedule PDF. `POST /api/admin/schedules/upload` rasterizes each
page with poppler's `pdftoppm`, and that binary cannot be installed into a
serverless function, so the route answers **`503 POPPLER_UNAVAILABLE`**. That
is the route working as designed, not a broken deployment: the status line is
all a browser console prints, and the response body carries a Thai message
naming what to do instead. Two smaller limits sit behind the same route: Vercel
caps a request body at 4.5MB where the route itself allows 15MB, and a function
at 60s where OCR runs one Typhoon call per page in sequence.

Everything else — the teacher list, chat, publishing, manual editing and
deleting — only talks to Supabase and Typhoon over HTTP and runs here fine.

To upload a new schedule, run the backend somewhere with poppler: locally with
`npm run dev --workspace backend`, or as a container from `backend/Dockerfile`
(`render.yaml` wires that up on Render). Both write to the same Supabase
project, so a schedule published from either one is immediately live on the
deployed site.

### Setting it up

Import the repository into Vercel. `vercel.json` already describes the build, so
the Build & Development Settings in the dashboard should be left **empty**:

| Setting | Value |
| --- | --- |
| Root Directory | `./` |
| Build Command | *(empty)* |
| Output Directory | *(empty)* |
| Install Command | *(empty)* |

Both are worth stating plainly, because each fails in a way that does not name
its cause:

- A value typed into one of those fields **overrides** `vercel.json`. Vercel's
  placeholder text suggests `vite build`, and typing that in produces
  `vite: command not found`, because the root has no vite of its own.
- Root Directory has to stay `./`. Vercel reads `vercel.json` from whatever the
  Root Directory is, so pointing it at `frontend` means the file is never read.

`vercel.json` is validated against a strict schema that rejects unknown keys, so
it cannot carry JSON comments — anything worth explaining about the build
belongs here instead.

Then set the environment variables, which are the same server-side ones
described in [Backend](#2-backend) above:

| Name | Notes |
| --- | --- |
| `TYPHOON_API_KEY` | |
| `SUPABASE_URL` | |
| `SUPABASE_SERVICE_ROLE_KEY` | The server-side key, never the anon one |
| `ADMIN_TOKENS` | Generate fresh tokens rather than reusing local ones |
| `APP_TIMEZONE` | `Asia/Bangkok` |

Three variables are deliberately **not** set here:

- `VITE_API_BASE_URL` — leave it unset. Frontend and backend share an origin, so
  the relative `/api/...` paths already reach the function. Setting it is only
  for pointing the frontend at a backend on another host.
- `ALLOWED_ORIGINS` — same reason. One origin means no cross-origin request to
  allow.
- `POPPLER_PATH` — there is no poppler here to point at.

These are read at request time by the function, so changing one takes effect
without a rebuild. `VITE_API_BASE_URL` is the exception: Vite inlines `VITE_*`
variables at **build** time, so were you to set it, it would ship inside the
public bundle and need a redeploy to change.

Confirm the deployment:

```bash
curl https://your-app.vercel.app/api/health
# {"status":"ok","store":"supabase","multiTeacher":true}
```

A `store` of `json` means Supabase did not configure, and the site is serving
the single teacher in `backend/data/schedule.json` read-only — check the URL and
that the key is the server-side one.

Routing is done on the URL hash, so `/#admin` needs no rewrite rules.

### Running the backend as a container instead

`backend/Dockerfile` installs `poppler-utils`, so a container has the full
pipeline including uploads. On Render, point a new Blueprint at this repository
and it reads `render.yaml`; by hand, on any Docker host:

| Setting | Value |
| --- | --- |
| Dockerfile | `backend/Dockerfile` |
| Build context | `backend` |
| Health check | `/api/health` |

The build context is `backend`, so the container is built from
`backend/package.json` and its own lockfile — the root workspace is not involved,
and `PORT` comes from the host.

Set the same variables as above, plus `ALLOWED_ORIGINS` if a browser on another
origin will call it. If the deployed frontend should talk to this container
rather than to the Vercel function, set `VITE_API_BASE_URL` to its URL on Vercel
and redeploy the frontend.

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
