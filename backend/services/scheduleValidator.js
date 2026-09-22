/**
 * Validation for OCR-extracted schedules.
 *
 * The goal is to keep a human out of the loop for rows that are obviously
 * fine, and to point them straight at the rows that are not. So this module
 * does two things, in order:
 *
 *   1. Normalises the shapes OCR reliably gets *almost* right (Thai digits,
 *      "9.00" instead of "09:00", stray whitespace). These are recorded as
 *      applied fixes, not as problems, because leaving them for a human to
 *      retype is exactly the busywork this is meant to remove.
 *   2. Validates what is left, splitting findings into errors, which block
 *      publishing outright, and warnings, which need a human to look but do
 *      not by themselves mean the data is wrong.
 *
 * Deliberately NOT used as a signal: the OCR model's own confidence. A
 * confidently misread room number is still a wrong room number, so
 * correctness here is judged only against the data's internal consistency.
 */

const THAI_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const SESSION_TYPES = ["ทฤษฎี", "ปฏิบัติ"];

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

// Outside this window a session is more likely an OCR artifact than a real
// class, so it is flagged for review rather than accepted or rejected outright.
const PLAUSIBLE_DAY_START = "06:00";
const PLAUSIBLE_DAY_END = "22:00";
const MAX_SESSION_MINUTES = 8 * 60;

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

function thaiDigitsToArabic(value) {
  return String(value).replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Coerces the near-miss time formats OCR produces into strict HH:MM.
 * Returns null when the value cannot be salvaged, so the caller reports it
 * rather than guessing.
 */
function normalizeTime(raw) {
  if (raw === null || raw === undefined) return null;

  let value = thaiDigitsToArabic(raw).trim();
  // "09.00", "09 00" and "09:00" all mean the same thing on a printed timetable.
  value = value.replace(/[.\s]/g, ":").replace(/:+/g, ":");

  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeText(raw) {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).replace(/\s+/g, " ").trim();
  return value === "" ? null : value;
}

function normalizeDay(raw) {
  const value = normalizeText(raw);
  if (!value) return null;
  // OCR often keeps the "วัน" prefix from the header cell.
  const stripped = value.replace(/^วัน/, "");
  return THAI_WEEKDAYS.includes(stripped) ? stripped : value;
}

function normalizeCount(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(thaiDigitsToArabic(raw).replace(/[^\d-]/g, ""));
  return Number.isFinite(value) ? value : null;
}

/**
 * Normalises one entry. Returns the cleaned entry plus the list of changes
 * made, so the review UI can show what was auto-corrected.
 */
function normalizeEntry(entry, index) {
  const fixes = [];
  const out = { ...entry };

  const record = (field, before, after) => {
    if (before !== after && before !== undefined) {
      fixes.push({ entryIndex: index, field, from: before, to: after });
    }
  };

  const day = normalizeDay(entry.day ?? entry.day_th);
  record("day", entry.day ?? entry.day_th, day);
  out.day = day;

  for (const field of ["timeStart", "timeEnd"]) {
    const original = entry[field];
    const normalized = normalizeTime(original);
    // Keep the raw value when it cannot be parsed; validation reports it.
    out[field] = normalized ?? (original == null ? null : String(original).trim());
    record(field, original, out[field]);
  }

  for (const field of ["subjectCode", "room", "group", "note", "dayEn"]) {
    if (entry[field] === undefined) continue;
    const normalized = normalizeText(entry[field]);
    out[field] = normalized;
    record(field, entry[field], normalized);
  }

  if (entry.type !== undefined) {
    const type = normalizeText(entry.type);
    // "ท." / "ป." are the abbreviations printed in the grid cells.
    out.type = type === "ท." ? "ทฤษฎี" : type === "ป." ? "ปฏิบัติ" : type;
    record("type", entry.type, out.type);
  }

  if (entry.studentCount !== undefined) {
    out.studentCount = normalizeCount(entry.studentCount);
    record("studentCount", entry.studentCount, out.studentCount);
  }

  return { entry: out, fixes };
}

function entrySignature(entry) {
  return [entry.day, entry.timeStart, entry.timeEnd, entry.subjectCode, entry.group]
    .map((part) => part ?? "")
    .join("|");
}

/**
 * Validates a whole extracted schedule.
 *
 * @returns {{
 *   status: "ready" | "needs_review" | "blocked",
 *   issues: Array<{severity, ruleCode, message, entryIndex}>,
 *   fixes: Array<object>,
 *   entries: Array<object>,
 *   errorCount: number,
 *   warningCount: number
 * }}
 */
function validateSchedule(schedule) {
  const issues = [];
  const fixes = [];

  const add = (severity, ruleCode, message, entryIndex = null) =>
    issues.push({ severity, ruleCode, message, entryIndex });

  if (!schedule || typeof schedule !== "object") {
    add("error", "SCHEDULE_UNREADABLE", "ไม่สามารถอ่านโครงสร้างตารางสอนได้");
    return { status: "blocked", issues, fixes, entries: [], errorCount: 1, warningCount: 0 };
  }

  // --- document-level fields -------------------------------------------------
  const teacherName = normalizeText(schedule.teacher?.name);
  if (!teacherName) {
    add("warning", "TEACHER_NAME_MISSING", "ไม่พบชื่ออาจารย์ในเอกสาร ต้องระบุเอง");
  }

  const rawSubjects = Array.isArray(schedule.subjects) ? schedule.subjects : [];
  if (rawSubjects.length === 0) {
    add("warning", "SUBJECTS_MISSING", "ไม่พบรายการวิชาในเอกสาร");
  }

  const subjectCodes = new Set(
    rawSubjects.map((subject) => normalizeText(subject?.code)).filter(Boolean)
  );

  rawSubjects.forEach((subject, index) => {
    if (!normalizeText(subject?.code)) {
      add("error", "SUBJECT_CODE_MISSING", `วิชาลำดับที่ ${index + 1} ไม่มีรหัสวิชา`);
    }
    if (!normalizeText(subject?.name)) {
      add("warning", "SUBJECT_NAME_MISSING", `วิชาลำดับที่ ${index + 1} ไม่มีชื่อวิชา`);
    }
  });

  const rawEntries = Array.isArray(schedule.sessions)
    ? schedule.sessions
    : Array.isArray(schedule.entries)
      ? schedule.entries
      : null;

  if (!rawEntries) {
    add("error", "ENTRIES_UNREADABLE", "ไม่พบรายการคาบสอน (sessions) ในผลการอ่าน");
    return { status: "blocked", issues, fixes, entries: [], errorCount: 1, warningCount: issues.length - 1 };
  }

  if (rawEntries.length === 0) {
    add("error", "ENTRIES_EMPTY", "อ่านไม่พบคาบสอนเลยแม้แต่รายการเดียว");
  }

  // --- per-entry checks ------------------------------------------------------
  const entries = [];
  rawEntries.forEach((raw, index) => {
    const { entry, fixes: entryFixes } = normalizeEntry(raw, index);
    fixes.push(...entryFixes);
    entries.push(entry);

    const label = `คาบที่ ${index + 1}`;

    if (!entry.day) {
      add("error", "DAY_MISSING", `${label}: ไม่มีวันสอน`, index);
    } else if (!THAI_WEEKDAYS.includes(entry.day)) {
      add("error", "DAY_INVALID", `${label}: วันสอน "${entry.day}" ไม่ใช่วันในสัปดาห์`, index);
    }

    const startOk = entry.timeStart && TIME_RE.test(entry.timeStart);
    const endOk = entry.timeEnd && TIME_RE.test(entry.timeEnd);

    if (!entry.timeStart) {
      add("error", "TIME_START_MISSING", `${label}: ไม่มีเวลาเริ่ม`, index);
    } else if (!startOk) {
      add("error", "TIME_START_INVALID", `${label}: เวลาเริ่ม "${entry.timeStart}" ไม่ใช่รูปแบบ HH:MM`, index);
    }

    if (!entry.timeEnd) {
      add("error", "TIME_END_MISSING", `${label}: ไม่มีเวลาสิ้นสุด`, index);
    } else if (!endOk) {
      add("error", "TIME_END_INVALID", `${label}: เวลาสิ้นสุด "${entry.timeEnd}" ไม่ใช่รูปแบบ HH:MM`, index);
    }

    if (startOk && endOk) {
      const start = timeToMinutes(entry.timeStart);
      const end = timeToMinutes(entry.timeEnd);

      if (end <= start) {
        add("error", "TIME_RANGE_INVALID", `${label}: เวลาสิ้นสุด (${entry.timeEnd}) ไม่ได้อยู่หลังเวลาเริ่ม (${entry.timeStart})`, index);
      } else {
        if (end - start > MAX_SESSION_MINUTES) {
          add("warning", "SESSION_TOO_LONG", `${label}: คาบยาว ${((end - start) / 60).toFixed(1)} ชั่วโมง ผิดปกติ ควรตรวจสอบ`, index);
        }
        if (entry.timeStart < PLAUSIBLE_DAY_START || entry.timeEnd > PLAUSIBLE_DAY_END) {
          add("warning", "TIME_IMPLAUSIBLE", `${label}: เวลา ${entry.timeStart}–${entry.timeEnd} อยู่นอกช่วง ${PLAUSIBLE_DAY_START}–${PLAUSIBLE_DAY_END}`, index);
        }
      }
    }

    if (!entry.subjectCode) {
      add("error", "SUBJECT_CODE_MISSING_ON_ENTRY", `${label}: ไม่มีรหัสวิชา`, index);
    } else if (subjectCodes.size > 0 && !subjectCodes.has(entry.subjectCode)) {
      add("error", "SUBJECT_CODE_UNKNOWN", `${label}: รหัสวิชา "${entry.subjectCode}" ไม่อยู่ในรายการวิชาของเอกสารนี้`, index);
    }

    if (entry.type && !SESSION_TYPES.includes(entry.type)) {
      add("warning", "SESSION_TYPE_UNKNOWN", `${label}: ประเภท "${entry.type}" ไม่ใช่ ทฤษฎี หรือ ปฏิบัติ`, index);
    }

    if (!entry.room) {
      add("warning", "ROOM_MISSING", `${label}: ไม่มีห้องเรียน`, index);
    }
    if (!entry.group) {
      add("warning", "GROUP_MISSING", `${label}: ไม่มีกลุ่มเรียน`, index);
    }
    if (entry.studentCount !== undefined && entry.studentCount !== null && entry.studentCount < 0) {
      add("warning", "STUDENT_COUNT_INVALID", `${label}: จำนวนนักเรียน (${entry.studentCount}) ติดลบ`, index);
    }
  });

  // --- cross-entry checks ----------------------------------------------------
  const seen = new Map();
  entries.forEach((entry, index) => {
    const signature = entrySignature(entry);
    if (seen.has(signature)) {
      add("warning", "ENTRY_DUPLICATE", `คาบที่ ${index + 1}: ซ้ำกับคาบที่ ${seen.get(signature) + 1} ทุกประการ`, index);
    } else {
      seen.set(signature, index);
    }
  });

  // Overlaps are an error, not a warning: one teacher cannot be in two rooms
  // at once, so the reading is definitely wrong somewhere.
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];

      if (!a.day || a.day !== b.day) continue;
      if (!TIME_RE.test(a.timeStart || "") || !TIME_RE.test(a.timeEnd || "")) continue;
      if (!TIME_RE.test(b.timeStart || "") || !TIME_RE.test(b.timeEnd || "")) continue;
      if (entrySignature(a) === entrySignature(b)) continue; // already reported as duplicate

      const overlaps =
        timeToMinutes(a.timeStart) < timeToMinutes(b.timeEnd) &&
        timeToMinutes(b.timeStart) < timeToMinutes(a.timeEnd);

      if (overlaps) {
        add(
          "error",
          "ENTRY_OVERLAP",
          `คาบที่ ${i + 1} (${a.timeStart}–${a.timeEnd}) และคาบที่ ${j + 1} (${b.timeStart}–${b.timeEnd}) วัน${a.day} เวลาชนกัน`,
          j
        );
      }
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.length - errorCount;

  const status = errorCount > 0 ? "blocked" : warningCount > 0 ? "needs_review" : "ready";

  return { status, issues, fixes, entries, errorCount, warningCount };
}

/** Entry indexes that a human needs to look at. */
function entriesNeedingReview(result) {
  return [...new Set(result.issues.map((issue) => issue.entryIndex).filter((i) => i !== null))];
}

module.exports = {
  validateSchedule,
  normalizeEntry,
  normalizeTime,
  entriesNeedingReview,
  THAI_WEEKDAYS,
  SESSION_TYPES,
};
