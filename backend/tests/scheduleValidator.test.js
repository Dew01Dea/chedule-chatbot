const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateSchedule,
  normalizeTime,
  entriesNeedingReview,
} = require("../services/scheduleValidator");

const realSchedule = require("../data/schedule.json");

/** A minimal valid schedule that individual tests bend out of shape. */
function baseSchedule(overrides = {}) {
  return {
    teacher: { name: "นายทดสอบ ระบบ" },
    subjects: [{ code: "31901-2007", name: "เทคโนโลยีการจัดการฐานข้อมูล" }],
    sessions: [
      {
        day: "จันทร์",
        timeStart: "09:00",
        timeEnd: "11:00",
        subjectCode: "31901-2007",
        type: "ปฏิบัติ",
        room: "COM602",
        group: "สท.4/2",
        studentCount: 19,
      },
    ],
    ...overrides,
  };
}

test("the existing ไมตรี schedule still validates clean", () => {
  const result = validateSchedule(realSchedule);

  assert.equal(result.status, "ready");
  assert.equal(result.errorCount, 0);
  assert.equal(result.warningCount, 0);
  assert.equal(result.entries.length, 18, "all 18 real sessions survive normalisation");
});

test("back-to-back sessions are not treated as overlapping", () => {
  const result = validateSchedule(
    baseSchedule({
      sessions: [
        { day: "จันทร์", timeStart: "09:00", timeEnd: "11:00", subjectCode: "31901-2007", room: "A", group: "G" },
        { day: "จันทร์", timeStart: "11:00", timeEnd: "12:00", subjectCode: "31901-2007", room: "A", group: "G" },
      ],
    })
  );

  assert.equal(result.status, "ready");
});

test("two sessions at the same time on the same day are an error", () => {
  const result = validateSchedule(
    baseSchedule({
      sessions: [
        { day: "จันทร์", timeStart: "09:00", timeEnd: "11:00", subjectCode: "31901-2007", room: "A", group: "G1" },
        { day: "จันทร์", timeStart: "10:00", timeEnd: "12:00", subjectCode: "31901-2007", room: "B", group: "G2" },
      ],
    })
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((i) => i.ruleCode === "ENTRY_OVERLAP"));
});

test("the same time on a different day does not overlap", () => {
  const result = validateSchedule(
    baseSchedule({
      sessions: [
        { day: "จันทร์", timeStart: "09:00", timeEnd: "11:00", subjectCode: "31901-2007", room: "A", group: "G" },
        { day: "อังคาร", timeStart: "09:00", timeEnd: "11:00", subjectCode: "31901-2007", room: "A", group: "G" },
      ],
    })
  );

  assert.equal(result.status, "ready");
});

test("an identical duplicated row is a warning, not a hard block", () => {
  const row = { day: "จันทร์", timeStart: "09:00", timeEnd: "11:00", subjectCode: "31901-2007", room: "A", group: "G" };
  const result = validateSchedule(baseSchedule({ sessions: [row, { ...row }] }));

  assert.equal(result.status, "needs_review");
  assert.ok(result.issues.some((i) => i.ruleCode === "ENTRY_DUPLICATE"));
  assert.equal(result.errorCount, 0, "a duplicate alone must not block publishing");
});

test("missing time fields are reported rather than guessed", () => {
  const result = validateSchedule(
    baseSchedule({
      sessions: [{ day: "จันทร์", subjectCode: "31901-2007", room: "A", group: "G" }],
    })
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((i) => i.ruleCode === "TIME_START_MISSING"));
  assert.ok(result.issues.some((i) => i.ruleCode === "TIME_END_MISSING"));
});

test("end time before start time is an error", () => {
  const result = validateSchedule(
    baseSchedule({
      sessions: [{ day: "จันทร์", timeStart: "14:00", timeEnd: "09:00", subjectCode: "31901-2007", room: "A", group: "G" }],
    })
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((i) => i.ruleCode === "TIME_RANGE_INVALID"));
});

test("a subject code not in the document's subject list is an error", () => {
  const result = validateSchedule(
    baseSchedule({
      sessions: [{ day: "จันทร์", timeStart: "09:00", timeEnd: "11:00", subjectCode: "99999-9999", room: "A", group: "G" }],
    })
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((i) => i.ruleCode === "SUBJECT_CODE_UNKNOWN"));
});

test("an empty extraction is blocked, never published as an empty schedule", () => {
  const result = validateSchedule(baseSchedule({ sessions: [] }));

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((i) => i.ruleCode === "ENTRIES_EMPTY"));
});

test("output that is not a schedule at all is blocked", () => {
  for (const bad of [null, undefined, "ขอโทษครับ ผมอ่านไม่ออก", 42]) {
    const result = validateSchedule(bad);
    assert.equal(result.status, "blocked", `${JSON.stringify(bad)} must be blocked`);
  }
});

test("a schedule with no sessions key at all is blocked", () => {
  const result = validateSchedule({ teacher: { name: "x" }, subjects: [] });

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((i) => i.ruleCode === "ENTRIES_UNREADABLE"));
});

test("missing room/group flags the row for review without blocking", () => {
  const result = validateSchedule(
    baseSchedule({
      sessions: [{ day: "จันทร์", timeStart: "09:00", timeEnd: "11:00", subjectCode: "31901-2007" }],
    })
  );

  assert.equal(result.status, "needs_review");
  assert.equal(result.errorCount, 0);
  assert.deepEqual(entriesNeedingReview(result), [0]);
});

test("common OCR time spellings are repaired instead of sent to a human", () => {
  assert.equal(normalizeTime("9:00"), "09:00");
  assert.equal(normalizeTime("09.00"), "09:00");
  assert.equal(normalizeTime("๐๙:๐๐"), "09:00", "Thai numerals");
  assert.equal(normalizeTime(" 9 00 "), "09:00");
  assert.equal(normalizeTime("24:00"), null, "unsalvageable values are not invented");
  assert.equal(normalizeTime("ไม่มี"), null);
});

test("repaired rows validate clean and the repairs are reported", () => {
  const result = validateSchedule(
    baseSchedule({
      sessions: [
        { day: "วันจันทร์", timeStart: "9.00", timeEnd: "๑๑:๐๐", subjectCode: " 31901-2007 ", type: "ป.", room: "COM602", group: "สท.4/2" },
      ],
    })
  );

  assert.equal(result.status, "ready");
  assert.equal(result.entries[0].day, "จันทร์", "the 'วัน' prefix is stripped");
  assert.equal(result.entries[0].timeStart, "09:00");
  assert.equal(result.entries[0].timeEnd, "11:00");
  assert.equal(result.entries[0].type, "ปฏิบัติ", "'ป.' is expanded");
  assert.equal(result.entries[0].subjectCode, "31901-2007", "whitespace trimmed so the code matches");
  assert.ok(result.fixes.length >= 4, "every repair is recorded for the reviewer");
});

test("an unsalvageable time is surfaced, not silently dropped", () => {
  const result = validateSchedule(
    baseSchedule({
      sessions: [{ day: "จันทร์", timeStart: "๙:๙๙", timeEnd: "11:00", subjectCode: "31901-2007", room: "A", group: "G" }],
    })
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((i) => i.ruleCode === "TIME_START_INVALID"));
});

test("an implausible hour is flagged for review", () => {
  const result = validateSchedule(
    baseSchedule({
      sessions: [{ day: "จันทร์", timeStart: "03:00", timeEnd: "04:00", subjectCode: "31901-2007", room: "A", group: "G" }],
    })
  );

  assert.equal(result.status, "needs_review");
  assert.ok(result.issues.some((i) => i.ruleCode === "TIME_IMPLAUSIBLE"));
});

test("an invalid weekday is an error", () => {
  const result = validateSchedule(
    baseSchedule({
      sessions: [{ day: "วันเสาร์อาทิตย์", timeStart: "09:00", timeEnd: "10:00", subjectCode: "31901-2007", room: "A", group: "G" }],
    })
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((i) => i.ruleCode === "DAY_INVALID"));
});
