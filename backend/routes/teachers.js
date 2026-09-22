const express = require("express");
const store = require("../store");
const { requireAdmin } = require("../middleware/requireAdmin");
const { sendError, handleRouteError } = require("../lib/httpError");

const router = express.Router();

/**
 * GET /api/teachers
 * The list the chatbot's teacher picker is built from. Only teachers with a
 * published schedule appear, so a user cannot select someone whose timetable
 * is still in review.
 */
router.get("/", async (req, res) => {
  try {
    res.json({ teachers: await store.listTeachers() });
  } catch (error) {
    handleRouteError(res, error, "GET /api/teachers");
  }
});

/** GET /api/teachers/all — admin view, including teachers with nothing published. */
router.get("/all", requireAdmin, async (req, res) => {
  try {
    const listAll = store.listAllTeachers || store.listTeachers;
    res.json({ teachers: await listAll() });
  } catch (error) {
    handleRouteError(res, error, "GET /api/teachers/all");
  }
});

router.post("/", requireAdmin, async (req, res) => {
  const { code, fullName, nickname, education, duty, department } = req.body || {};

  if (!code || typeof code !== "string" || !code.trim()) {
    return sendError(res, 400, "CODE_REQUIRED", "ต้องระบุรหัสอาจารย์");
  }
  if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
    return sendError(res, 400, "NAME_REQUIRED", "ต้องระบุชื่ออาจารย์");
  }

  try {
    const teacher = await store.createTeacher({
      code: code.trim(),
      fullName: fullName.trim(),
      nickname,
      education,
      duty,
      department,
    });
    res.status(201).json({ teacher });
  } catch (error) {
    handleRouteError(res, error, "POST /api/teachers");
  }
});

router.patch("/:teacherId", requireAdmin, async (req, res) => {
  try {
    const teacher = await store.updateTeacher(req.params.teacherId, req.body || {});
    if (!teacher) return sendError(res, 404, "TEACHER_NOT_FOUND", "ไม่พบอาจารย์ที่ต้องการแก้ไข");
    res.json({ teacher });
  } catch (error) {
    handleRouteError(res, error, "PATCH /api/teachers/:id");
  }
});

/**
 * DELETE /api/teachers/:teacherId
 *
 * Removes the teacher and everything belonging to them — the database
 * cascades to schedules, subjects, entries and documents. Because that is
 * irreversible and its scope is not obvious from the button, it reports what
 * would be lost and requires ?confirm=true to go ahead.
 */
router.delete("/:teacherId", requireAdmin, async (req, res) => {
  try {
    const teacher = await store.getTeacher(req.params.teacherId);
    if (!teacher) return sendError(res, 404, "TEACHER_NOT_FOUND", "ไม่พบอาจารย์ที่ต้องการลบ");

    const summary = await store.summariseTeacherContents(req.params.teacherId);

    if (req.query.confirm !== "true") {
      return sendError(
        res,
        409,
        "DELETE_NEEDS_CONFIRM",
        summary.scheduleCount === 0
          ? `ยืนยันการลบอาจารย์ "${teacher.fullName}" หรือไม่`
          : `การลบอาจารย์ "${teacher.fullName}" จะลบตารางสอน ${summary.scheduleCount} ชุด` +
            `${summary.publishedCount > 0 ? ` (เผยแพร่อยู่ ${summary.publishedCount} ชุด)` : ""} ` +
            "รวมทั้งคาบเรียนและไฟล์ PDF ทั้งหมดด้วย และกู้คืนไม่ได้",
        { willDelete: summary }
      );
    }

    const deleted = await store.deleteTeacher(req.params.teacherId);
    res.json({ deleted, message: `ลบอาจารย์ "${teacher.fullName}" เรียบร้อยแล้ว` });
  } catch (error) {
    handleRouteError(res, error, "DELETE /api/teachers/:id", { detailed: true });
  }
});

module.exports = router;
