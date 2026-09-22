const express = require("express");
const fs = require("fs");
const path = require("path");
const { answerScheduleQuestion } = require("../services/typhoonService");
const { getThaiDateInfo, loadHolidaysInRange } = require("../services/dateService");

const router = express.Router();
const SCHEDULE_PATH = path.join(__dirname, "..", "data", "schedule.json");

// POST /api/chat -> { message: string } -> { reply: string }
router.post("/", async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Request body must include a non-empty 'message' string." });
  }

  let scheduleData;
  try {
    scheduleData = JSON.parse(fs.readFileSync(SCHEDULE_PATH, "utf-8"));
  } catch (err) {
    return res.status(404).json({ error: "No schedule stored yet. Upload a PDF via /api/schedule/extract first." });
  }

  // Today's real date is computed here, server-side — the model never guesses it.
  const today = getThaiDateInfo();

  // Scope holidays to the semester's actual dates if they've been set;
  // otherwise fall back to the rest of the current calendar year so
  // "เทอมนี้หยุดวันไหนบ้าง" still gets a useful (if broader) answer.
  const rangeStart = scheduleData.semesterStartDate || `${today.yearCE}-01-01`;
  const rangeEnd = scheduleData.semesterEndDate || `${today.yearCE}-12-31`;
  const holidays = loadHolidaysInRange(rangeStart, rangeEnd);

  try {
    const reply = await answerScheduleQuestion(message, scheduleData, today, holidays);
    res.json({ reply });
  } catch (err) {
    console.error("Chat failed:", err);
    res.status(500).json({ error: "Failed to generate a reply.", details: err.message });
  }
});

module.exports = router;
