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
};

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
          : error.code === "STORE_READ_ONLY"
            ? 503
            : 400;

    return sendError(res, status, error.code, known);
  }

  return sendError(res, 500, "INTERNAL_ERROR", "เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง");
}

module.exports = { sendError, handleRouteError };
