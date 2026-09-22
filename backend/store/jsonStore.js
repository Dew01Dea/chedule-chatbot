const fs = require("fs");
const path = require("path");

/**
 * The original single-file store, kept so the project still runs with no
 * Supabase configured and so ไมตรี's existing schedule keeps working
 * untouched. It is read-only: anything that would create or publish a
 * schedule needs the database, and says so plainly.
 *
 * This is the fallback, not the target. The Supabase store is what supports
 * multiple teachers.
 */

const SCHEDULE_PATH = path.join(__dirname, "..", "data", "schedule.json");

// Stable synthetic id for the one teacher this store can represent, so the
// frontend's teacher picker works identically against either store.
const LEGACY_TEACHER_ID = "legacy-json";

function readSchedule() {
  const raw = fs.readFileSync(SCHEDULE_PATH, "utf-8");
  return JSON.parse(raw);
}

function scheduleExists() {
  return fs.existsSync(SCHEDULE_PATH);
}

function parseSemester(schedule) {
  // Stored as "1/2569".
  const match = String(schedule.semester || "").match(/^(\d)\s*\/\s*(\d{4})$/);
  if (!match) return { semester: null, academicYear: null };
  return { semester: Number(match[1]), academicYear: Number(match[2]) };
}

async function listTeachers() {
  if (!scheduleExists()) return [];

  const schedule = readSchedule();
  const { semester, academicYear } = parseSemester(schedule);

  return [
    {
      id: LEGACY_TEACHER_ID,
      code: LEGACY_TEACHER_ID,
      fullName: schedule.teacher?.name || "ไม่ระบุชื่อ",
      nickname: schedule.teacher?.nickname || null,
      department: schedule.department || null,
      college: schedule.college || null,
      terms: semester ? [{ academicYear, semester, label: schedule.semester }] : [],
    },
  ];
}

async function getPublishedSchedule(teacherId) {
  if (teacherId !== LEGACY_TEACHER_ID) return null;
  if (!scheduleExists()) return null;
  return readSchedule();
}

function unsupported(operation) {
  return async () => {
    const error = new Error(
      `${operation} requires a database. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`
    );
    error.code = "STORE_READ_ONLY";
    throw error;
  };
}

module.exports = {
  name: "json",
  LEGACY_TEACHER_ID,
  listTeachers,
  getPublishedSchedule,
  createTeacher: unsupported("Creating a teacher"),
  updateTeacher: unsupported("Updating a teacher"),
  listSchedulesForTeacher: unsupported("Listing schedules"),
  createDraftSchedule: unsupported("Uploading a schedule"),
  getScheduleForReview: unsupported("Reviewing a schedule"),
  updateEntry: unsupported("Editing an entry"),
  publishSchedule: unsupported("Publishing a schedule"),
  findDocumentByChecksum: async () => null,
  summariseTeacherContents: unsupported("Inspecting a teacher"),
  deleteTeacher: unsupported("Deleting a teacher"),
  deleteSchedule: unsupported("Deleting a schedule"),
  unpublishSchedule: unsupported("Unpublishing a schedule"),
  updateScheduleMeta: unsupported("Editing a schedule"),
  addEntry: unsupported("Adding an entry"),
  deleteEntry: unsupported("Deleting an entry"),
};
