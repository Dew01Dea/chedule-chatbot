require("dotenv").config();
const express = require("express");
const cors = require("cors");

const scheduleRoutes = require("./routes/schedule");
const chatRoutes = require("./routes/chat");

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

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Schedule chatbot backend running on http://localhost:${PORT}`);
    if (!process.env.TYPHOON_API_KEY) {
      console.warn("WARNING: TYPHOON_API_KEY is not set. Copy .env.example to .env and add your key.");
    }
    if (allowedOrigins.length === 0) {
      console.warn("WARNING: ALLOWED_ORIGINS is not set; all origins are accepted. Set it before deploying.");
    }
  });
}

module.exports = app;
