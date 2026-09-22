const express = require("express");
const store = require("../store");
const { answerScheduleQuestion } = require("../services/typhoonService");
const { getThaiDateInfo, loadHolidaysInRange } = require("../services/dateService");
const { sendError, handleRouteError } = require("../lib/httpError");

const router = express.Router();

const MAX_MESSAGE_LENGTH = 1000;

/**
 * POST /api/chat
 * Body: { message, teacherId, academicYear?, semester? }
 *
 * teacherId is required and is resolved against the database here. The
 * schedule handed to the model is whatever that lookup returns and nothing
 * else, so the answer cannot draw on another teacher's timetable. The model is
 * never asked to work out which teacher is meant.
 */
router.post("/", async (req, res) => {
  const { message, teacherId, academicYear, semester } = req.body || {};

  if (!message || typeof message !== "string" || !message.trim()) {
    return sendError(res, 400, "MESSAGE_REQUIRED", "กรุณาพิมพ์คำถาม");
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return sendError(res, 400, "MESSAGE_TOO_LONG", `คำถามยาวเกิน ${MAX_MESSAGE_LENGTH} ตัวอักษร`);
  }
  if (!teacherId || typeof teacherId !== "string") {
    return sendError(res, 400, "TEACHER_REQUIRED", "กรุณาเลือกอาจารย์ก่อนถามคำถาม");
  }

  const year = academicYear === undefined || academicYear === null ? undefined : Number(academicYear);
  const term = semester === undefined || semester === null ? undefined : Number(semester);

  if (year !== undefined && !Number.isInteger(year)) {
    return sendError(res, 400, "YEAR_INVALID", "ปีการศึกษาไม่ถูกต้อง");
  }
  if (term !== undefined && ![1, 2, 3].includes(term)) {
    return sendError(res, 400, "SEMESTER_INVALID", "ภาคเรียนไม่ถูกต้อง");
  }

  try {
    const scheduleData = await store.getPublishedSchedule(teacherId, {
      academicYear: year,
      semester: term,
    });

    // Covers an unknown teacher, an inactive one, and a teacher whose only
    // schedule is still in review — all of which are "nothing to answer from".
    if (!scheduleData) {
      return sendError(
        res,
        404,
        "SCHEDULE_NOT_FOUND",
        "ไม่พบตารางสอนที่เผยแพร่แล้วของอาจารย์ท่านนี้"
      );
    }

    const today = getThaiDateInfo();

    const rangeStart = scheduleData.semesterStartDate || `${today.yearCE}-01-01`;
    const rangeEnd = scheduleData.semesterEndDate || `${today.yearCE}-12-31`;
    const holidays = loadHolidaysInRange(rangeStart, rangeEnd);

    const reply = await answerScheduleQuestion(message, scheduleData, today, holidays);

    res.json({
      reply,
      teacher: { id: teacherId, name: scheduleData.teacher?.name },
      semester: scheduleData.semester,
    });
  } catch (error) {
    handleRouteError(res, error, "POST /api/chat");
  }
});

module.exports = router;
