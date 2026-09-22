const express = require("express");
const multer = require("multer");
const crypto = require("crypto");

const store = require("../store");
const { requireAdmin } = require("../middleware/requireAdmin");
const { ocrPdfWithTyphoon, structureScheduleFromMarkdown } = require("../services/typhoonService");
const { validateSchedule } = require("../services/scheduleValidator");
const { looksLikePdf } = require("../lib/pdf");
const { sendError, handleRouteError } = require("../lib/httpError");

const router = express.Router();

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1 },
});

// Every route below is an admin write path.
router.use(requireAdmin);

/**
 * POST /api/admin/schedules/upload
 * multipart: schedulePdf, teacherId, academicYear, semester
 *
 * Runs the existing Typhoon pipeline, validates the result, and stores it as a
 * draft. It never publishes: the teacher's live schedule is untouched until
 * someone reviews this one and publishes it explicitly.
 */
router.post("/schedules/upload", upload.single("schedulePdf"), async (req, res) => {
  const { teacherId, academicYear, semester } = req.body || {};

  if (!req.file) {
    return sendError(res, 400, "FILE_REQUIRED", "กรุณาแนบไฟล์ PDF (ชื่อฟิลด์ schedulePdf)");
  }
  if (!teacherId) {
    return sendError(res, 400, "TEACHER_REQUIRED", "กรุณาเลือกอาจารย์");
  }

  const year = Number(academicYear);
  const term = Number(semester);

  if (!Number.isInteger(year) || year < 2500 || year > 2700) {
    return sendError(res, 400, "YEAR_INVALID", "ปีการศึกษาไม่ถูกต้อง (ใช้ พ.ศ. เช่น 2569)");
  }
  if (![1, 2, 3].includes(term)) {
    return sendError(res, 400, "SEMESTER_INVALID", "ภาคเรียนต้องเป็น 1, 2 หรือ 3");
  }
  if (!looksLikePdf(req.file.buffer)) {
    return sendError(res, 400, "NOT_A_PDF", "ไฟล์ที่อัปโหลดไม่ใช่ PDF");
  }

  try {
    const teacher = await store.getTeacher(teacherId);
    if (!teacher) return sendError(res, 404, "TEACHER_NOT_FOUND", "ไม่พบอาจารย์ที่เลือก");

    // Identity of the bytes, so the same file cannot be processed twice.
    const checksum = crypto.createHash("sha256").update(req.file.buffer).digest("hex");

    const duplicate = await store.findDocumentByChecksum(teacherId, checksum);
    if (duplicate) {
      return sendError(res, 409, "DUPLICATE_UPLOAD", "ไฟล์นี้เคยอัปโหลดไว้แล้ว", {
        existingScheduleId: duplicate.schedule_id || duplicate.scheduleId || null,
      });
    }

    // Stage 1 + 2: the original Typhoon pipeline, unchanged.
    const ocrMarkdown = await ocrPdfWithTyphoon(req.file.buffer);
    const extracted = await structureScheduleFromMarkdown(ocrMarkdown);

    // Stage 3: the gate that did not exist before.
    const validation = validateSchedule(extracted);

    const created = await store.createDraftSchedule({
      teacherId,
      academicYear: year,
      semester: term,
      document: extracted,
      validation,
      sourceFileName: req.file.originalname,
    });

    await store.storePdf({
      teacherId,
      scheduleId: created.id,
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      checksum,
      uploadedBy: req.admin.name,
    });

    res.status(201).json({
      scheduleId: created.id,
      status: created.status,
      version: created.version,
      validation: {
        status: validation.status,
        errorCount: validation.errorCount,
        warningCount: validation.warningCount,
        autoFixCount: validation.fixes.length,
        issues: validation.issues,
      },
      message:
        validation.status === "ready"
          ? "อ่านข้อมูลสำเร็จ ไม่พบข้อผิดพลาด กรุณาตรวจสอบแล้วกดเผยแพร่"
          : validation.status === "needs_review"
            ? "อ่านข้อมูลสำเร็จ แต่มีบางรายการที่ควรตรวจสอบก่อนเผยแพร่"
            : "พบข้อผิดพลาดที่ต้องแก้ไขก่อนจึงจะเผยแพร่ได้",
    });
  } catch (error) {
    handleRouteError(res, error, "POST /api/admin/schedules/upload", { detailed: true });
  }
});

/**
 * GET /api/admin/diagnostics
 *
 * Reports what the RUNNING server process can see, which is not always what a
 * terminal sees. A process inherits PATH at launch, so installing poppler and
 * then not restarting the server leaves check-setup.js reporting success from
 * a fresh shell while uploads keep failing. Asking the server itself settles
 * which of the two is out of date.
 *
 * Admin-only, and reports presence rather than values.
 */
router.get("/diagnostics", async (req, res) => {
  const { checkPoppler } = require("../lib/poppler");
  const poppler = await checkPoppler();

  res.json({
    poppler,
    store: { name: store.name, multiTeacher: Boolean(store.isMultiTeacher) },
    typhoonKeyPresent: Boolean(process.env.TYPHOON_API_KEY?.trim()),
    timezone: process.env.APP_TIMEZONE || "Asia/Bangkok",
    node: process.version,
    platform: process.platform,
    serverStartedAt: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/** GET /api/admin/teachers/:teacherId/schedules — every version, any status. */
router.get("/teachers/:teacherId/schedules", async (req, res) => {
  try {
    res.json({ schedules: await store.listSchedulesForTeacher(req.params.teacherId) });
  } catch (error) {
    handleRouteError(res, error, "GET /api/admin/teachers/:id/schedules", { detailed: true });
  }
});

/** GET /api/admin/schedules/:scheduleId — the draft plus outstanding issues. */
router.get("/schedules/:scheduleId", async (req, res) => {
  try {
    const schedule = await store.getScheduleForReview(req.params.scheduleId);
    if (!schedule) return sendError(res, 404, "SCHEDULE_NOT_FOUND", "ไม่พบตารางสอนนี้");

    // A short-lived link so the reviewer can read the PDF beside the data.
    let documentUrl = null;
    if (schedule.document?.storagePath && store.getDocumentUrl) {
      try {
        documentUrl = await store.getDocumentUrl(schedule.document.storagePath);
      } catch (error) {
        console.error("[admin] could not sign document URL", error);
      }
    }

    res.json({ schedule, documentUrl });
  } catch (error) {
    handleRouteError(res, error, "GET /api/admin/schedules/:id", { detailed: true });
  }
});

/**
 * PATCH /api/admin/schedules/:scheduleId/entries/:entryId
 * Corrects one field on one row. The reviewer fixes what OCR got wrong, not
 * the whole timetable.
 */
router.patch("/schedules/:scheduleId/entries/:entryId", async (req, res) => {
  try {
    const updated = await store.updateEntry(
      req.params.scheduleId,
      req.params.entryId,
      req.body || {},
      req.admin.name
    );

    // Also covers an entry id that belongs to a different schedule.
    if (!updated) return sendError(res, 404, "ENTRY_NOT_FOUND", "ไม่พบรายการคาบสอนนี้");

    res.json({ entry: updated });
  } catch (error) {
    handleRouteError(res, error, "PATCH /api/admin/schedules/:id/entries/:entryId", { detailed: true });
  }
});

/**
 * POST /api/admin/schedules/:scheduleId/publish
 * Makes a reviewed schedule the live one, archiving what it replaces.
 */
router.post("/schedules/:scheduleId/publish", async (req, res) => {
  try {
    const published = await store.publishSchedule(req.params.scheduleId, req.admin.name);
    if (!published) return sendError(res, 404, "SCHEDULE_NOT_FOUND", "ไม่พบตารางสอนนี้");

    res.json({ schedule: published, message: "เผยแพร่ตารางสอนเรียบร้อยแล้ว" });
  } catch (error) {
    handleRouteError(res, error, "POST /api/admin/schedules/:id/publish", { detailed: true });
  }
});

module.exports = router;
