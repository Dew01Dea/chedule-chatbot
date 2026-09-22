const fs = require("fs");
const path = require("path");

const THAI_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

// Add more years here as they become available/needed.
const HOLIDAY_FILES = {
  2026: path.join(__dirname, "..", "data", "holidays-2569.json"),
};

/**
 * Returns real, server-computed info about "today" (or a given date) in Thai
 * terms. The chatbot itself has no clock, so this MUST be computed here and
 * injected into every chat request — never left for the model to guess.
 */
function getThaiDateInfo(date = new Date()) {
  const isoDate = date.toISOString().slice(0, 10);
  const weekdayTh = THAI_WEEKDAYS[date.getDay()];
  const day = date.getDate();
  const monthTh = THAI_MONTHS[date.getMonth()];
  const yearCE = date.getFullYear();
  const yearBE = yearCE + 543;
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const timeHHMM = `${hours}:${minutes}`;

  return {
    isoDate,
    weekdayTh,
    day,
    monthTh,
    yearCE,
    yearBE,
    timeHHMM,
    formatted: `วัน${weekdayTh}ที่ ${day} ${monthTh} พ.ศ. ${yearBE} (${isoDate}) เวลา ${timeHHMM} น.`,
  };
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
  const startYear = new Date(startISO).getFullYear();
  const endYear = new Date(endISO).getFullYear();
  const all = [];
  for (let y = startYear; y <= endYear; y++) {
    all.push(...loadHolidaysForYear(y));
  }
  return all
    .filter((h) => h.date >= startISO && h.date <= endISO)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function findHolidayOn(isoDate) {
  const year = new Date(isoDate).getFullYear();
  return loadHolidaysForYear(year).find((h) => h.date === isoDate) || null;
}

module.exports = {
  getThaiDateInfo,
  loadHolidaysInRange,
  findHolidayOn,
  THAI_WEEKDAYS,
  THAI_MONTHS,
};
