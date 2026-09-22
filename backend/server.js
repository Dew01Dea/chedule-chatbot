require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");

const store = require("./store");
const { getServiceKey } = require("./lib/supabaseClient");
const scheduleRoutes = require("./routes/schedule");
const chatRoutes = require("./routes/chat");
const teacherRoutes = require("./routes/teachers");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 4000;

// In dev the Vite server proxies /api, so no browser origin is involved.
// In production the frontend is served from a known origin, so list it
// explicitly instead of reflecting whatever origin asks.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin/non-browser callers (curl, the Vite proxy) send no Origin.
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS policy"));
    },
  })
);

app.use(express.json({ limit: "1mb" }));

app.use("/api/schedule", scheduleRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/teachers", teacherRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", (req, res) =>
  res.json({ status: "ok", store: store.name, multiTeacher: store.isMultiTeacher })
);

// Upload failures arrive here as MulterError rather than as thrown route
// errors, so they need translating into the same response shape.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "ไฟล์ใหญ่เกิน 15MB"
        : err.code === "LIMIT_UNEXPECTED_FILE"
          ? "ชื่อฟิลด์ไฟล์ไม่ถูกต้อง (ต้องเป็น schedulePdf)"
          : "อัปโหลดไฟล์ไม่สำเร็จ";

    return res.status(400).json({ error: { code: err.code, message } });
  }

  if (err && /CORS/.test(err.message || "")) {
    return res.status(403).json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "ต้นทางนี้ไม่ได้รับอนุญาต" } });
  }

  if (err) {
    console.error("[unhandled]", err);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาดภายในระบบ" } });
  }

  return next();
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Schedule chatbot backend running on http://localhost:${PORT}`);
    console.log(`Store: ${store.name} (multi-teacher: ${store.isMultiTeacher})`);

    if (!process.env.TYPHOON_API_KEY) {
      console.warn("WARNING: TYPHOON_API_KEY is not set. Copy .env.example to .env and add your key.");
    }
    if (!store.isMultiTeacher) {
      // Name the missing half, since the usual cause is a misnamed variable
      // rather than a deliberate choice to run without a database.
      const missing = [
        !process.env.SUPABASE_URL && "SUPABASE_URL",
        !getServiceKey() && "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)",
      ].filter(Boolean);

      console.warn(
        `WARNING: Supabase is not configured (missing: ${missing.join(", ")}); ` +
          "running read-only against data/schedule.json. Multiple teachers and uploads are unavailable."
      );
    }
    if (!process.env.ADMIN_TOKENS) {
      console.warn("WARNING: ADMIN_TOKENS is not set; all admin endpoints will refuse requests.");
    }
    if (allowedOrigins.length === 0) {
      console.warn("WARNING: ALLOWED_ORIGINS is not set; all origins are accepted. Set it before deploying.");
    }
  });
}

module.exports = app;
