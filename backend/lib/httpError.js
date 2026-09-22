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
  STORE_ERROR: "บันทึกข้อมูลลงฐานข้อมูลไม่สำเร็จ",
  STORAGE_BUCKET_MISSING:
    "ยังไม่มีที่เก็บไฟล์ชื่อ schedule-pdfs ใน Supabase Storage — สร้าง bucket นี้แบบ private ใน Dashboard แล้วลองใหม่",

  // These reach admins only, on routes behind the admin token. An operator
  // cannot fix a setup problem they are not told about, and none of these
  // reveal anything a reviewer should not already know.
  POPPLER_MISSING:
    "เซิร์ฟเวอร์หาคำสั่ง pdftoppm (poppler) ไม่เจอ จึงแปลง PDF เป็นภาพไม่ได้ — " +
    "วิธีที่ชัวร์ที่สุดคือไม่ต้องพึ่ง PATH: เพิ่ม POPPLER_PATH ในไฟล์ backend/.env " +
    "ให้ชี้ไปที่โฟลเดอร์ bin ของ poppler เช่น POPPLER_PATH=C:\\poppler\\Library\\bin " +
    "แล้วรีสตาร์ทเซิร์ฟเวอร์",
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
 *
 * `options.detailed` is set by admin routes. Those sit behind the admin token
 * and are operated by whoever runs the server, so withholding the underlying
 * message there does not protect anyone — it just turns a fixable setup
 * problem (a missing storage bucket, a rejected insert) into an unactionable
 * "internal error". Public routes still get the generic message.
 */
function handleRouteError(res, error, context, options = {}) {
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

    return sendError(res, status, error.code, known, detailFor(error, options));
  }

  return sendError(
    res,
    500,
    error.code || "INTERNAL_ERROR",
    "เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง",
    detailFor(error, options)
  );
}

/**
 * The underlying message, for admin routes only. Anything that looks like a
 * credential is stripped, since an error body is not a place to reproduce one
 * even for an operator who legitimately has it.
 */
function detailFor(error, options) {
  if (!options.detailed) return {};

  const cause = error.cause?.message ? ` (${error.cause.message})` : "";
  const detail = `${error.message || String(error)}${cause}`
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<redacted-jwt>")
    .replace(/sb_[a-z]+_[A-Za-z0-9_-]{10,}/g, "<redacted-key>")
    .replace(/sk-[A-Za-z0-9]{10,}/g, "<redacted-key>")
    .slice(0, 400);

  return { detail };
}

module.exports = { sendError, handleRouteError };
