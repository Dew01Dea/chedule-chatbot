const fs = require("fs");
const path = require("path");

const THAI_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

// Every date the chatbot reasons about is a Thai school day, so the whole
// service works in one fixed zone rather than whatever the host happens to be
// set to. Overridable for tests and for hosts in other regions.
const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Bangkok";

// Add more years here as they become available/needed.
const HOLIDAY_FILES = {
  2026: path.join(__dirname, "..", "data", "holidays-2569.json"),
};

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Breaks a Date down into calendar/clock fields as they read in `timeZone`.
 *
 * Doing this in one pass matters: deriving the ISO date from UTC while reading
 * the weekday and hour from the host's local time makes them disagree for part
 * of every day. In Asia/Bangkok (UTC+7) that window is 00:00–07:00, during
 * which the old code reported the correct weekday alongside the *previous*
 * day's ISO date — and that ISO date is what "พรุ่งนี้หยุดไหม" counts from.
 */
function getZonedParts(date, timeZone) {
  const parts = {};
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  for (const { type, value } of formatter.formatToParts(date)) {
    parts[type] = value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour,
    minute: parts.minute,
    weekdayIndex: WEEKDAY_INDEX[parts.weekday],
  };
}

/**
 * Returns real, server-computed info about "today" (or a given date) in Thai
 * terms. The chatbot itself has no clock, so this MUST be computed here and
 * injected into every chat request — never left for the model to guess.
 */
function getThaiDateInfo(date = new Date(), timeZone = APP_TIMEZONE) {
  const { year, month, day, hour, minute, weekdayIndex } = getZonedParts(date, timeZone);

  const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const weekdayTh = THAI_WEEKDAYS[weekdayIndex];
  const monthTh = THAI_MONTHS[month - 1];
  const yearBE = year + 543;
  const timeHHMM = `${hour}:${minute}`;

  return {
    isoDate,
    weekdayTh,
    day,
    monthTh,
    yearCE: year,
    yearBE,
    timeHHMM,
    formatted: `วัน${weekdayTh}ที่ ${day} ${monthTh} พ.ศ. ${yearBE} (${isoDate}) เวลา ${timeHHMM} น.`,
  };
}

/**
 * Adds whole days to a plain YYYY-MM-DD string without going through a
 * timezone. Callers work in calendar days, so anchoring at UTC noon keeps the
 * arithmetic away from DST and offset edges entirely.
 */
function addDaysISO(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const anchored = new Date(Date.UTC(year, month - 1, day, 12));
  anchored.setUTCDate(anchored.getUTCDate() + days);
  return anchored.toISOString().slice(0, 10);
}

function yearOfISO(isoDate) {
  return Number(isoDate.slice(0, 4));
}

function loadHolidaysForYear(yearCE) {
  const filePath = HOLIDAY_FILES[yearCE];
  if (!filePath || !fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * Loads holidays across every year touched by [startISO, endISO], so a
 * semester spanning e.g. Dec–Feb still gets the right data from both files.
 */
function loadHolidaysInRange(startISO, endISO) {
  const startYear = yearOfISO(startISO);
  const endYear = yearOfISO(endISO);
  const all = [];
  for (let y = startYear; y <= endYear; y++) {
    all.push(...loadHolidaysForYear(y));
  }
  return all
    .filter((h) => h.date >= startISO && h.date <= endISO)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function findHolidayOn(isoDate) {
  return loadHolidaysForYear(yearOfISO(isoDate)).find((h) => h.date === isoDate) || null;
}

module.exports = {
  getThaiDateInfo,
  loadHolidaysInRange,
  findHolidayOn,
  addDaysISO,
  APP_TIMEZONE,
  THAI_WEEKDAYS,
  THAI_MONTHS,
};
