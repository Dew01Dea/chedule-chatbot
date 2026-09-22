/**
 * Error handling for routes.
 *
 * Clients get a stable code and a message written for a user. Diagnostics stay
 * in the server log. Upstream error bodies in particular (Typhoon, Supabase)
 * can echo request details, so they are never forwarded.
 */

const USER_SAFE_MESSAGES = {
  TEACHER_EXISTS: "มีอาจารย์รหัสนี้อยู่แล้ว",
  TEACHER_NOT_FOUND: "ไม่พบอาจารย์ที่เลือก",
  SCHEDULE_NOT_FOUND: "ไม่พบตารางสอนที่เผยแพร่แล้วของอาจารย์ท่านนี้",
  PUBLISH_BLOCKED: "ยังมีข้อผิดพลาดที่ยังไม่ได้แก้ไข ไม่สามารถเผยแพร่ได้",
  DUPLICATE_UPLOAD: "ไฟล์นี้เคยอัปโหลดไว้แล้ว",
  STORE_READ_ONLY: "ระบบยังไม่ได้เชื่อมต่อฐานข้อมูล จึงยังทำรายการนี้ไม่ได้",
  STRUCTURING_NOT_JSON: "อ่านตารางสอนจากไฟล์นี้ไม่สำเร็จ กรุณาตรวจสอบไฟล์แล้วลองใหม่",
  NOTHING_TO_UPDATE: "ไม่มีข้อมูลที่ต้องแก้ไข",

  // These reach admins only, on routes behind the admin token. An operator
  // cannot fix a setup problem they are not told about, and none of these
  // reveal anything a reviewer should not already know.
  POPPLER_MISSING:
    "เซิร์ฟเวอร์ยังไม่ได้ติดตั้ง poppler จึงแปลง PDF เป็นภาพไม่ได้ — ติดตั้งแล้วเพิ่มโฟลเดอร์ bin ลงใน PATH จากนั้นรีสตาร์ทเซิร์ฟเวอร์",
  PDF_RENDER_FAILED: "เปิดไฟล์ PDF นี้ไม่สำเร็จ ไฟล์อาจเสียหายหรือถูกตั้งรหัสผ่านไว้",
  TYPHOON_KEY_MISSING: "ยังไม่ได้ตั้งค่า TYPHOON_API_KEY ในไฟล์ backend/.env",
  TYPHOON_KEY_REJECTED: "Typhoon ปฏิเสธ API key — ตรวจสอบ TYPHOON_API_KEY อีกครั้ง",
  TYPHOON_RATE_LIMITED: "เรียก Typhoon ถี่เกินกำหนด กรุณารอสักครู่แล้วลองใหม่",
  TYPHOON_UNAVAILABLE: "บริการ Typhoon ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
  TYPHOON_UNREACHABLE: "เชื่อมต่อ Typhoon ไม่ได้ ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตของเซิร์ฟเวอร์",
};

// Setup problems are the server's fault, not the request's.
const SERVER_FAULT_CODES = new Set([
  "POPPLER_MISSING",
  "TYPHOON_KEY_MISSING",
  "TYPHOON_KEY_REJECTED",
  "TYPHOON_UNAVAILABLE",
  "TYPHOON_UNREACHABLE",
]);

function sendError(res, status, code, message, extra = {}) {
  return res.status(status).json({ error: { code, message, ...extra } });
}

/**
 * Turns a thrown error into a response without leaking internals.
 * `context` identifies the operation in the server log.
 */
function handleRouteError(res, error, context) {
  console.error(`[${context}]`, error);

  const known = USER_SAFE_MESSAGES[error.code];
  if (known) {
    const status =
      error.code === "TEACHER_EXISTS" || error.code === "DUPLICATE_UPLOAD"
        ? 409
        : error.code === "TEACHER_NOT_FOUND" || error.code === "SCHEDULE_NOT_FOUND"
          ? 404
          : error.code === "STORE_READ_ONLY" || SERVER_FAULT_CODES.has(error.code)
            ? 503
            : error.code === "TYPHOON_RATE_LIMITED"
              ? 429
              : 400;

    return sendError(res, status, error.code, known);
  }

  return sendError(res, 500, "INTERNAL_ERROR", "เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง");
}

module.exports = { sendError, handleRouteError };
