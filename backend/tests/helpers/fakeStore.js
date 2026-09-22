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
      return schedule
        ? { ...schedule.document, id, status: schedule.status, issues: schedule.validation?.issues || [] }
        : null;
    },

    async updateEntry(scheduleId, entryId, patch) {
      const schedule = schedules.get(scheduleId);
      if (!schedule) return null;

      const entry = (schedule.document.sessions || []).find((s) => s.id === entryId);
      if (!entry) return null;

      Object.assign(entry, patch);

      // The real store marks that entry's validation issues resolved, which is
      // what lets publishing become possible again. Mirror it, or the fake
      // would keep reporting errors that no longer exist.
      if (schedule.validation?.issues) {
        schedule.validation.issues = schedule.validation.issues.filter(
          (issue) => issue.entryId !== entryId
        );
      }

      return entry;
    },

    async summariseTeacherContents(teacherId) {
      const owned = [...schedules.values()].filter((s) => s.teacherId === teacherId);
      return {
        scheduleCount: owned.length,
        publishedCount: owned.filter((s) => s.status === "published").length,
      };
    },

    async deleteTeacher(teacherId) {
      const teacher = teachers.get(teacherId);
      if (!teacher) return null;

      const summary = {
        scheduleCount: [...schedules.values()].filter((s) => s.teacherId === teacherId).length,
        publishedCount: [...schedules.values()].filter(
          (s) => s.teacherId === teacherId && s.status === "published"
        ).length,
      };

      // Mirrors the database cascade.
      for (const [id, schedule] of [...schedules.entries()]) {
        if (schedule.teacherId === teacherId) schedules.delete(id);
      }
      teachers.delete(teacherId);

      return { teacher, ...summary };
    },

    async deleteSchedule(scheduleId, { allowPublished = false } = {}) {
      const schedule = schedules.get(scheduleId);
      if (!schedule) return null;

      if (schedule.status === "published" && !allowPublished) {
        const blocked = new Error("Refusing to delete a published schedule without confirmation.");
        blocked.code = "PUBLISHED_DELETE_NEEDS_CONFIRM";
        throw blocked;
      }

      schedules.delete(scheduleId);
      return { id: scheduleId, status: schedule.status };
    },

    async unpublishSchedule(scheduleId) {
      const schedule = schedules.get(scheduleId);
      if (!schedule || schedule.status !== "published") return null;
      schedule.status = "archived";
      return { id: scheduleId, status: "archived" };
    },

    async updateScheduleMeta(scheduleId, patch) {
      const schedule = schedules.get(scheduleId);
      if (!schedule) return null;
      Object.assign(schedule, patch);
      return { id: scheduleId, ...patch };
    },

    async addEntry(scheduleId, entry) {
      const schedule = schedules.get(scheduleId);
      if (!schedule) return null;
      const created = { id: `entry-${Math.random().toString(36).slice(2, 8)}`, ...entry };
      schedule.document.sessions = [...(schedule.document.sessions || []), created];
      return created;
    },

    async deleteEntry(scheduleId, entryId) {
      const schedule = schedules.get(scheduleId);
      if (!schedule) return null;

      const sessions = schedule.document.sessions || [];
      const found = sessions.find((s) => s.id === entryId);
      if (!found) return null;

      schedule.document.sessions = sessions.filter((s) => s.id !== entryId);

      if (schedule.validation?.issues) {
        schedule.validation.issues = schedule.validation.issues.filter(
          (issue) => issue.entryId !== entryId
        );
      }

      return found;
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
