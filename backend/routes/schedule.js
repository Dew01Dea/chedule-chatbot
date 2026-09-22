const express = require("express");
const store = require("../store");
const { sendError, handleRouteError } = require("../lib/httpError");

const router = express.Router();

/**
 * GET /api/schedule?teacherId=...&academicYear=&semester=
 *
 * Returns one teacher's published schedule. Previously this took no
 * parameters because there was only ever one schedule on disk; a teacher must
 * now be named, for the same reason /api/chat requires one.
 */
router.get("/", async (req, res) => {
  const { teacherId, academicYear, semester } = req.query;

  if (!teacherId) {
    return sendError(res, 400, "TEACHER_REQUIRED", "ต้องระบุ teacherId");
  }

  try {
    const schedule = await store.getPublishedSchedule(teacherId, {
      academicYear: academicYear ? Number(academicYear) : undefined,
      semester: semester ? Number(semester) : undefined,
    });

    if (!schedule) {
      return sendError(res, 404, "SCHEDULE_NOT_FOUND", "ไม่พบตารางสอนที่เผยแพร่แล้วของอาจารย์ท่านนี้");
    }

    res.json(schedule);
  } catch (error) {
    handleRouteError(res, error, "GET /api/schedule");
  }
});

/**
 * POST /api/schedule/extract used to accept a PDF from anyone and overwrite
 * the live schedule with whatever came back. It is answered explicitly rather
 * than left to 404, so any existing caller is told where the replacement is.
 */
router.post("/extract", (req, res) => {
  res.status(410).json({
    error: {
      code: "ENDPOINT_REPLACED",
      message:
        "ย้ายไปที่ POST /api/admin/schedules/upload ซึ่งต้องเข้าสู่ระบบผู้ดูแล ระบุอาจารย์ และผ่านการตรวจสอบก่อนเผยแพร่",
    },
  });
});

module.exports = router;
