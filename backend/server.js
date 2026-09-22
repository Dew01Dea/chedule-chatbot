require("dotenv").config();
const express = require("express");
const cors = require("cors");

const scheduleRoutes = require("./routes/schedule");
const chatRoutes = require("./routes/chat");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.use("/api/schedule", scheduleRoutes);
app.use("/api/chat", chatRoutes);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`Schedule chatbot backend running on http://localhost:${PORT}`);
  if (!process.env.TYPHOON_API_KEY) {
    console.warn("WARNING: TYPHOON_API_KEY is not set. Copy .env.example to .env and add your key.");
  }
});
