const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { ocrPdfWithTyphoon, structureScheduleFromMarkdown } = require("../services/typhoonService");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const SCHEDULE_PATH = path.join(__dirname, "..", "data", "schedule.json");

// GET /api/schedule -> return whatever schedule is currently stored
router.get("/", (req, res) => {
  try {
    const raw = fs.readFileSync(SCHEDULE_PATH, "utf-8");
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(404).json({ error: "No schedule stored yet. Upload a PDF first." });
  }
});

// POST /api/schedule/extract -> upload a new PDF, OCR it, and store the result
router.post("/extract", upload.single("schedulePdf"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded. Field name must be 'schedulePdf'." });
  }
  if (req.file.mimetype !== "application/pdf") {
    return res.status(400).json({ error: "Only PDF files are supported." });
  }

  try {
    // Stage 1: Typhoon OCR reads the Thai page images accurately.
    const ocrMarkdown = await ocrPdfWithTyphoon(req.file.buffer);

    // Stage 2: Typhoon's instruct model structures that clean text into the schedule schema.
    const extracted = await structureScheduleFromMarkdown(ocrMarkdown);
    extracted.extractedAt = new Date().toISOString();
    extracted.sourceFile = req.file.originalname;

    fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(extracted, null, 2), "utf-8");
    res.json({ message: "Schedule extracted and stored.", schedule: extracted });
  } catch (err) {
    console.error("Extraction failed:", err);
    res.status(500).json({ error: "Failed to extract schedule from PDF.", details: err.message });
  }
});

module.exports = router;
