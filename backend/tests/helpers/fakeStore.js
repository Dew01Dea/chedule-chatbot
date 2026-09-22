/**
 * An in-memory stand-in for the Supabase store, used to exercise the routes.
 * It implements the same contract: published-only reads, teacher-scoped
 * lookups, and drafts that are invisible to the chatbot.
 */
function createFakeStore() {
  const teachers = new Map();
  const schedules = new Map();
  const documents = [];

  function addTeacher(teacher) {
    teachers.set(teacher.id, { isActive: true, ...teacher });
  }

  function addSchedule(schedule) {
    schedules.set(schedule.id, schedule);
  }

  return {
    name: "fake",
    isMultiTeacher: true,

    // test helpers
    addTeacher,
    addSchedule,
    _schedules: schedules,
    _documents: documents,

    async listTeachers() {
      return [...teachers.values()]
        .filter(
          (teacher) =>
            teacher.isActive &&
            [...schedules.values()].some(
              (s) => s.teacherId === teacher.id && s.status === "published"
            )
        )
        .map(({ id, code, fullName, department }) => ({ id, code, fullName, department }));
    },

    async listAllTeachers() {
      return [...teachers.values()];
    },

    async getTeacher(id) {
      return teachers.get(id) || null;
    },

    async getPublishedSchedule(teacherId, { academicYear, semester } = {}) {
      const match = [...schedules.values()].find(
        (s) =>
          s.teacherId === teacherId &&
          s.status === "published" &&
          (academicYear === undefined || s.academicYear === academicYear) &&
          (semester === undefined || s.semester === semester)
      );
      return match ? match.document : null;
    },

    async listSchedulesForTeacher(teacherId) {
      return [...schedules.values()].filter((s) => s.teacherId === teacherId);
    },

    async findDocumentByChecksum(teacherId, checksum) {
      return documents.find((d) => d.teacherId === teacherId && d.checksum === checksum) || null;
    },

    async createDraftSchedule({ teacherId, academicYear, semester, document, validation }) {
      const id = `sched-${schedules.size + 1}`;
      const status = validation.status === "ready" ? "draft" : "needs_review";
      addSchedule({ id, teacherId, academicYear, semester, status, version: 1, document, validation });
      return { id, status, version: 1 };
    },

    async storePdf({ teacherId, scheduleId, checksum, fileName }) {
      documents.push({ id: `doc-${documents.length + 1}`, teacherId, scheduleId, checksum, fileName });
      return { id: `doc-${documents.length}`, storagePath: `${teacherId}/${checksum}.pdf` };
    },

    async getScheduleForReview(id) {
      const schedule = schedules.get(id);
      return schedule ? { ...schedule.document, id, issues: schedule.validation?.issues || [] } : null;
    },

    async updateEntry(scheduleId, entryId, patch) {
      const schedule = schedules.get(scheduleId);
      if (!schedule) return null;

      const entry = (schedule.document.sessions || []).find((s) => s.id === entryId);
      if (!entry) return null;

      Object.assign(entry, patch);
      return entry;
    },

    async publishSchedule(id) {
      const schedule = schedules.get(id);
      if (!schedule) return null;

      for (const other of schedules.values()) {
        if (
          other.teacherId === schedule.teacherId &&
          other.academicYear === schedule.academicYear &&
          other.semester === schedule.semester &&
          other.status === "published"
        ) {
          other.status = "archived";
        }
      }

      schedule.status = "published";
      return { id, status: "published", publishedAt: new Date().toISOString() };
    },
  };
}

module.exports = { createFakeStore };
