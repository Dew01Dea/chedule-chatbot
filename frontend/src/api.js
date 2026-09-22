/**
 * Thin fetch wrapper around the backend.
 *
 * The backend answers errors as { error: { code, message } } with a message
 * written for a user, so that message is what surfaces in the UI. Nothing here
 * holds a service key: the only credential is the admin token the reviewer
 * types in, kept in sessionStorage for the tab's lifetime.
 */

const ADMIN_TOKEN_KEY = "schedule-admin-token";

export function getAdminToken() {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setAdminToken(token) {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // A blocked sessionStorage only costs the reviewer a re-entry.
  }
}

class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(path, { admin = false, headers = {}, ...options } = {}) {
  const finalHeaders = { ...headers };

  if (admin) {
    const token = getAdminToken();
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(path, { ...options, headers: finalHeaders });
  } catch {
    throw new ApiError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่า backend กำลังทำงานอยู่", "NETWORK", 0);
  }

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  if (!response.ok) {
    throw new ApiError(
      body?.error?.message || "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
      body?.error?.code || "UNKNOWN",
      response.status
    );
  }

  return body;
}

function json(method, payload, admin) {
  return {
    method,
    admin,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export const api = {
  listTeachers: () => request("/api/teachers"),

  ask: ({ message, teacherId, academicYear, semester }) =>
    request("/api/chat", json("POST", { message, teacherId, academicYear, semester }, false)),

  admin: {
    listTeachers: () => request("/api/teachers/all", { admin: true }),

    createTeacher: (teacher) => request("/api/teachers", json("POST", teacher, true)),

    listSchedules: (teacherId) =>
      request(`/api/admin/teachers/${encodeURIComponent(teacherId)}/schedules`, { admin: true }),

    getSchedule: (scheduleId) =>
      request(`/api/admin/schedules/${encodeURIComponent(scheduleId)}`, { admin: true }),

    upload: ({ file, teacherId, academicYear, semester }) => {
      const form = new FormData();
      form.append("schedulePdf", file);
      form.append("teacherId", teacherId);
      form.append("academicYear", String(academicYear));
      form.append("semester", String(semester));

      return request("/api/admin/schedules/upload", { method: "POST", admin: true, body: form });
    },

    updateEntry: (scheduleId, entryId, patch) =>
      request(
        `/api/admin/schedules/${encodeURIComponent(scheduleId)}/entries/${encodeURIComponent(entryId)}`,
        json("PATCH", patch, true)
      ),

    publish: (scheduleId) =>
      request(`/api/admin/schedules/${encodeURIComponent(scheduleId)}/publish`, {
        method: "POST",
        admin: true,
      }),
  },
};

export { ApiError };
