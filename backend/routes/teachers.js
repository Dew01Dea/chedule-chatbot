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

module.exports = router;
