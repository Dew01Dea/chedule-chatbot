# ตารางสอน Chatbot — Thai Teacher Schedule Assistant

A chatbot that answers questions about a teacher's class schedule, extracted
from a Thai-language PDF and powered end-to-end by Typhoon — a model family
built specifically for Thai OCR and Thai conversation.

## How it works

```
PDF upload → rendered to page images (poppler) → Typhoon OCR reads the Thai
text/table layout → raw markdown → Typhoon's instruct model structures it
into schema JSON → stored in data/schedule.json → chat endpoint injects that
JSON as context → Typhoon's instruct model answers questions grounded only
in that data
```

Two Typhoon models, two jobs:

- **Typhoon OCR** (`typhoon-ocr`) reads the actual Thai document — it's
  purpose-built for Thai OCR and handles tone marks, stacked vowels, and
  merged table cells more reliably than general OCR engines.
- **Typhoon's instruct model** (`typhoon-v2.5-30b-a3b-instruct`) does two
  things: it structures Typhoon OCR's raw markdown into the schema JSON
  (a one-time step per PDF upload), and it handles live chat — since your
  users mostly type in Thai, it's tuned specifically for natural, fluent
  Thai conversation.

Two backend endpoints do the work:

- `POST /api/schedule/extract` — upload a schedule PDF. It's rasterized to
  page images, each page is OCR'd by Typhoon, and the combined markdown is
  passed to Typhoon's instruct model to produce structured JSON, saved to
  `data/schedule.json`.
- `POST /api/chat` — takes a user's question, loads the stored schedule JSON,
  and asks Typhoon's instruct model to answer using only that data (no
  hallucinated classes), in whichever language the user asked in.

### System requirement: poppler

PDF pages are rendered to images with poppler's `pdftoppm` before OCR. Install it:

- **macOS**: `brew install poppler`
- **Ubuntu/Debian**: `sudo apt-get install poppler-utils`
- **Windows**: download poppler for Windows and add its `bin` folder to your PATH
  (e.g. via [this build](https://github.com/oschwartz10612/poppler-windows/releases))

The repo already ships with `backend/data/schedule.json` pre-filled from your
uploaded `ตารางสอน.pdf`, so the chat works immediately without re-uploading.

## Setup

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# edit .env and add TYPHOON_API_KEY
# (get one from https://playground.opentyphoon.ai/settings/api-key)
npm run dev
```

Runs on `http://localhost:4000`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173` and proxies `/api` calls to the backend.

## Thai date & holiday awareness

The chatbot has no internal clock, so "today" is computed on the **backend**
(`services/dateService.js`) on every request and injected into the prompt —
the model never guesses it. This is what fixes questions like "วันนี้วันอะไร".

For holidays, `backend/data/holidays-2569.json` holds the official Thai
government holiday calendar for B.E. 2569 (2026), including compensatory
("ชดเชย") days. On every chat request, the backend filters this list down to
the semester's date range (if set — see below) and hands it to the model, so
"เทอมนี้หยุดวันไหนบ้าง" is answered from real data instead of hallucination.

**Important caveat**: this is the *national government* holiday calendar
(วันหยุดราชการ), not your college's specific mid-term break or special closure
days — those aren't public data and need to be added by hand. To scope
holiday answers precisely to one semester (rather than "today through Dec
31st"), fill in `semesterStartDate` and `semesterEndDate` (format `YYYY-MM-DD`)
in `backend/data/schedule.json` — pull them from the college's official
academic calendar since vocational college (สอศ.) terms often run on a
different schedule than general schools (สพฐ.).

If you need a future year's holidays too, add another file like
`holidays-2570.json` (same shape) and register it in the `HOLIDAY_FILES` map
at the top of `dateService.js`.

## Uploading a new/different schedule PDF


From the frontend you'd add a small upload button that POSTs to
`/api/schedule/extract` as `multipart/form-data` with field name
`schedulePdf`, e.g.:

```js
const formData = new FormData();
formData.append("schedulePdf", file);
await fetch("/api/schedule/extract", { method: "POST", body: formData });
```

I left this out of the UI since you said the schedule is fixed for now — say
the word and I'll add an upload screen (e.g. for an admin view where the
teacher swaps in a new semester's PDF).

## Notes on accuracy

- Typhoon OCR is trained specifically on Thai documents, so it should handle
  tone marks, stacked vowels, and mixed Thai/English/number cells (like
  "สท.4/1-2 (39)") more reliably than a general-purpose OCR or vision model.
- The structuring step is told to reconcile OCR quirks like duplicated text
  from merged table cells — but for a brand-new PDF, it's worth checking
  `schedule.json` once after extraction to confirm nothing got merged wrong.
- The chat prompt explicitly tells the model to only use the stored schedule
  data and say so if something isn't in it, to avoid invented answers.
- Since `data/schedule.json` is a plain file, it's easy to inspect or hand-edit
  if you ever spot an extraction mistake — no database needed for one teacher's
  schedule.
- If you later want this for multiple teachers, swap `schedule.json` for a
  small per-teacher JSON file or a SQLite table — the two endpoints don't need
  to change much.
- Only one API key is needed now (`TYPHOON_API_KEY`) — the whole pipeline runs
  on Typhoon, no other provider involved.
