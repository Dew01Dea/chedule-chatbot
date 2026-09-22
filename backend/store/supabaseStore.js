const { getSupabase } = require("../lib/supabaseClient");

/**
 * Supabase-backed store. This is the implementation that supports multiple
 * teachers; jsonStore is only the no-database fallback.
 *
 * Two shapes exist in this file and they are deliberately different:
 *
 *   - Rows, as stored (snake_case, normalised across tables).
 *   - The "schedule document" the chatbot consumes, which is the shape
 *     schedule.json always had. typhoonService was written against it and is
 *     not changed here, so toScheduleDocument() rebuilds it on read.
 */

function fail(operation, error) {
  const wrapped = new Error(`${operation} failed: ${error.message}`);
  wrapped.code = "STORE_ERROR";
  wrapped.cause = error;
  return wrapped;
}

/* -------------------------------------------------------------------------- */
/* Teachers                                                                   */
/* -------------------------------------------------------------------------- */

function toTeacher(row, terms = []) {
  return {
    id: row.id,
    code: row.code,
    fullName: row.full_name,
    nickname: row.nickname,
    department: row.department,
    isActive: row.is_active,
    terms,
  };
}

/**
 * Teachers the chatbot may be pointed at: active, and with at least one
 * published schedule. A teacher whose only schedule is still in review must
 * not appear, or the picker would offer an empty conversation.
 */
async function listTeachers() {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("teachers")
    .select("id, code, full_name, nickname, department, is_active, schedules!inner(academic_year, semester, status)")
    .eq("is_active", true)
    .eq("schedules.status", "published")
    .order("full_name");

  if (error) throw fail("Listing teachers", error);

  return (data || []).map((row) =>
    toTeacher(
      row,
      (row.schedules || [])
        .map((s) => ({
          academicYear: s.academic_year,
          semester: s.semester,
          label: `${s.semester}/${s.academic_year}`,
        }))
        .sort((a, b) => b.academicYear - a.academicYear || b.semester - a.semester)
    )
  );
}

/** Every teacher, including those with nothing published. Admin views only. */
async function listAllTeachers() {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("teachers")
    .select("id, code, full_name, nickname, department, is_active")
    .order("full_name");

  if (error) throw fail("Listing teachers", error);
  return (data || []).map((row) => toTeacher(row));
}

async function getTeacher(teacherId) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("teachers")
    .select("id, code, full_name, nickname, education, duty, department, is_active")
    .eq("id", teacherId)
    .maybeSingle();

  if (error) throw fail("Loading teacher", error);
  return data ? toTeacher(data) : null;
}

async function createTeacher({ code, fullName, nickname, education, duty, department }) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("teachers")
    .insert({
      code,
      full_name: fullName,
      nickname: nickname || null,
      education: education || null,
      duty: duty || null,
      department: department || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      const conflict = new Error(`มีอาจารย์รหัส "${code}" อยู่แล้ว`);
      conflict.code = "TEACHER_EXISTS";
      throw conflict;
    }
    throw fail("Creating teacher", error);
  }

  return toTeacher(data);
}

async function updateTeacher(teacherId, patch) {
  const supabase = getSupabase();

  const columns = {
    fullName: "full_name",
    nickname: "nickname",
    education: "education",
    duty: "duty",
    department: "department",
    isActive: "is_active",
  };

  const update = {};
  for (const [key, column] of Object.entries(columns)) {
    if (patch[key] !== undefined) update[column] = patch[key];
  }

  if (Object.keys(update).length === 0) return getTeacher(teacherId);

  const { data, error } = await supabase
    .from("teachers")
    .update(update)
    .eq("id", teacherId)
    .select()
    .maybeSingle();

  if (error) throw fail("Updating teacher", error);
  return data ? toTeacher(data) : null;
}

/* -------------------------------------------------------------------------- */
/* Schedules                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Rebuilds the schedule-document shape the chatbot expects from normalised
 * rows, so typhoonService keeps working unchanged.
 */
function toScheduleDocument(schedule, teacher, subjects, entries) {
  return {
    id: schedule.id,
    college: schedule.college,
    semester: `${schedule.semester}/${schedule.academic_year}`,
    academicYear: schedule.academic_year,
    semesterNumber: schedule.semester,
    department: schedule.department,
    weekRange: schedule.week_range,
    status: schedule.status,
    teacher: {
      id: teacher?.id,
      name: teacher?.full_name,
      nickname: teacher?.nickname,
      education: teacher?.education,
      duty: teacher?.duty,
    },
    subjects: (subjects || []).map((s) => ({
      code: s.code,
      name: s.name,
      hours: {
        theory: s.theory_hours,
        practice: s.practice_hours,
        creditUnits: s.credit_units,
        totalHoursPerWeek: s.total_hours_per_week,
      },
    })),
    sessions: (entries || []).map((e) => ({
      id: e.id,
      day: e.day_th,
      dayEn: e.day_en,
      timeStart: e.time_start,
      timeEnd: e.time_end,
      subjectCode: e.subject_code,
      type: e.session_type,
      room: e.room,
      group: e.student_group,
      studentCount: e.student_count,
      note: e.note,
      needsReview: e.needs_review,
    })),
    semesterStartDate: schedule.semester_start_date,
    semesterEndDate: schedule.semester_end_date,
    sourceFile: schedule.source_file_name,
  };
}

async function loadScheduleParts(scheduleId) {
  const supabase = getSupabase();

  const [subjectsResult, entriesResult] = await Promise.all([
    supabase.from("subjects").select("*").eq("schedule_id", scheduleId).order("code"),
    supabase
      .from("schedule_entries")
      .select("*")
      .eq("schedule_id", scheduleId)
      .order("time_start"),
  ]);

  if (subjectsResult.error) throw fail("Loading subjects", subjectsResult.error);
  if (entriesResult.error) throw fail("Loading entries", entriesResult.error);

  return { subjects: subjectsResult.data || [], entries: entriesResult.data || [] };
}

/**
 * The only read path the chatbot uses.
 *
 * Scoping is enforced here rather than in the prompt: the query filters by
 * teacher_id and status='published', so a draft or another teacher's schedule
 * cannot be returned even if a caller asks for one.
 */
async function getPublishedSchedule(teacherId, { academicYear, semester } = {}) {
  const supabase = getSupabase();

  let query = supabase
    .from("schedules")
    .select("*, teachers!inner(id, full_name, nickname, education, duty)")
    .eq("teacher_id", teacherId)
    .eq("status", "published");

  if (academicYear) query = query.eq("academic_year", academicYear);
  if (semester) query = query.eq("semester", semester);

  const { data, error } = await query
    .order("academic_year", { ascending: false })
    .order("semester", { ascending: false })
    .limit(1);

  if (error) throw fail("Loading published schedule", error);
  if (!data || data.length === 0) return null;

  const schedule = data[0];
  const { subjects, entries } = await loadScheduleParts(schedule.id);

  return toScheduleDocument(schedule, schedule.teachers, subjects, entries);
}

async function listSchedulesForTeacher(teacherId) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("schedules")
    .select("id, academic_year, semester, status, version, source_file_name, created_at, published_at, reviewed_by")
    .eq("teacher_id", teacherId)
    .order("academic_year", { ascending: false })
    .order("semester", { ascending: false })
    .order("version", { ascending: false });

  if (error) throw fail("Listing schedules", error);

  return (data || []).map((row) => ({
    id: row.id,
    academicYear: row.academic_year,
    semester: row.semester,
    status: row.status,
    version: row.version,
    sourceFileName: row.source_file_name,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    reviewedBy: row.reviewed_by,
  }));
}

/**
 * Creates a schedule and its children from a validated extraction.
 *
 * Always lands in 'draft' or 'needs_review', never 'published': a new upload
 * cannot displace the live schedule until a human publishes it. The currently
 * published schedule for the same term is untouched and keeps serving.
 */
async function createDraftSchedule({
  teacherId,
  academicYear,
  semester,
  document,
  validation,
  sourceFileName,
}) {
  const supabase = getSupabase();

  const existing = await listSchedulesForTeacher(teacherId);
  const sameTerm = existing.filter(
    (s) => s.academicYear === academicYear && s.semester === semester
  );
  const nextVersion = sameTerm.reduce((max, s) => Math.max(max, s.version), 0) + 1;

  const status = validation.status === "ready" ? "draft" : "needs_review";

  const { data: schedule, error: scheduleError } = await supabase
    .from("schedules")
    .insert({
      teacher_id: teacherId,
      academic_year: academicYear,
      semester,
      college: document.college || null,
      department: document.department || null,
      week_range: document.weekRange || null,
      semester_start_date: document.semesterStartDate || null,
      semester_end_date: document.semesterEndDate || null,
      status,
      version: nextVersion,
      source_file_name: sourceFileName || null,
    })
    .select()
    .single();

  if (scheduleError) throw fail("Creating schedule", scheduleError);

  // From here on, any failure leaves a partial schedule behind, so clean it up
  // rather than stranding half a timetable in the review queue.
  try {
    const subjects = (document.subjects || [])
      .filter((s) => s.code)
      .map((s) => ({
        schedule_id: schedule.id,
        code: String(s.code).trim(),
        name: s.name || String(s.code).trim(),
        theory_hours: s.hours?.theory ?? null,
        practice_hours: s.hours?.practice ?? null,
        credit_units: s.hours?.creditUnits ?? null,
        total_hours_per_week: s.hours?.totalHoursPerWeek ?? null,
      }));

    if (subjects.length > 0) {
      const { error } = await supabase.from("subjects").insert(subjects);
      if (error) throw fail("Creating subjects", error);
    }

    const reviewIndexes = new Set(
      validation.issues.map((issue) => issue.entryIndex).filter((i) => i !== null)
    );

    // Drafts hold what OCR actually read, including gaps — those are what the
    // reviewer is there to fill. Missing values go in as NULL rather than
    // undefined, which PostgREST would otherwise drop from the row entirely.
    const entries = validation.entries.map((entry, index) => ({
      schedule_id: schedule.id,
      day_th: entry.day ?? null,
      day_en: entry.dayEn || null,
      time_start: entry.timeStart ?? null,
      time_end: entry.timeEnd ?? null,
      subject_code: entry.subjectCode ?? null,
      session_type: entry.type || null,
      room: entry.room || null,
      student_group: entry.group || null,
      student_count: entry.studentCount ?? null,
      note: entry.note || null,
      needs_review: reviewIndexes.has(index),
    }));

    let insertedEntries = [];
    if (entries.length > 0) {
      const { data, error } = await supabase.from("schedule_entries").insert(entries).select("id");
      if (error) throw fail("Creating entries", error);
      insertedEntries = data || [];
    }

    const issues = validation.issues.map((issue) => ({
      schedule_id: schedule.id,
      entry_id:
        issue.entryIndex !== null && insertedEntries[issue.entryIndex]
          ? insertedEntries[issue.entryIndex].id
          : null,
      severity: issue.severity,
      rule_code: issue.ruleCode,
      message: issue.message,
    }));

    if (issues.length > 0) {
      const { error } = await supabase.from("validation_issues").insert(issues);
      if (error) throw fail("Recording validation issues", error);
    }

    return { id: schedule.id, status, version: nextVersion };
  } catch (err) {
    await supabase.from("schedules").delete().eq("id", schedule.id);
    throw err;
  }
}

/** The full draft plus its outstanding issues, for the review screen. */
async function getScheduleForReview(scheduleId) {
  const supabase = getSupabase();

  const { data: schedule, error } = await supabase
    .from("schedules")
    .select("*, teachers!inner(id, full_name, nickname, education, duty)")
    .eq("id", scheduleId)
    .maybeSingle();

  if (error) throw fail("Loading schedule", error);
  if (!schedule) return null;

  const { subjects, entries } = await loadScheduleParts(scheduleId);

  const [issuesResult, documentResult] = await Promise.all([
    supabase.from("validation_issues").select("*").eq("schedule_id", scheduleId).eq("resolved", false),
    supabase.from("documents").select("id, storage_path, file_name, page_count").eq("schedule_id", scheduleId).maybeSingle(),
  ]);

  if (issuesResult.error) throw fail("Loading validation issues", issuesResult.error);

  return {
    ...toScheduleDocument(schedule, schedule.teachers, subjects, entries),
    issues: (issuesResult.data || []).map((issue) => ({
      id: issue.id,
      entryId: issue.entry_id,
      severity: issue.severity,
      ruleCode: issue.rule_code,
      message: issue.message,
    })),
    document: documentResult.data
      ? {
          id: documentResult.data.id,
          storagePath: documentResult.data.storage_path,
          fileName: documentResult.data.file_name,
          pageCount: documentResult.data.page_count,
        }
      : null,
  };
}

/**
 * Applies a reviewer's correction to one entry.
 *
 * Scoped by schedule_id as well as entry id, so a request cannot reach into a
 * different teacher's schedule by guessing an entry id.
 */
async function updateEntry(scheduleId, entryId, patch, reviewer) {
  const supabase = getSupabase();

  const columns = {
    day: "day_th",
    dayEn: "day_en",
    timeStart: "time_start",
    timeEnd: "time_end",
    subjectCode: "subject_code",
    type: "session_type",
    room: "room",
    group: "student_group",
    studentCount: "student_count",
    note: "note",
  };

  const update = {};
  for (const [key, column] of Object.entries(columns)) {
    if (patch[key] !== undefined) update[column] = patch[key];
  }

  if (Object.keys(update).length === 0) {
    const error = new Error("No editable fields were provided.");
    error.code = "NOTHING_TO_UPDATE";
    throw error;
  }

  // A human has looked at this row, so it no longer needs review.
  update.needs_review = false;
  update.edited_by = reviewer || null;
  update.edited_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("schedule_entries")
    .update(update)
    .eq("id", entryId)
    .eq("schedule_id", scheduleId)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === "23514" || /ไม่ถูกต้อง/.test(error.message || "")) {
      const invalid = new Error(error.message);
      invalid.code = "ENTRY_INVALID";
      throw invalid;
    }
    throw fail("Updating entry", error);
  }
  if (!data) return null;

  await supabase
    .from("validation_issues")
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq("entry_id", entryId);

  return data;
}

/**
 * Publishes a reviewed schedule, archiving whatever it replaces.
 *
 * Order matters: the previously published schedule for the same teacher and
 * term is archived first, because the database's partial unique index refuses
 * a second published row. That index is what guarantees a term can never end
 * up with two live schedules.
 */
async function publishSchedule(scheduleId, reviewer) {
  const supabase = getSupabase();

  const { data: schedule, error } = await supabase
    .from("schedules")
    .select("id, teacher_id, academic_year, semester, status")
    .eq("id", scheduleId)
    .maybeSingle();

  if (error) throw fail("Loading schedule", error);
  if (!schedule) return null;

  // Refuse to publish anything still carrying a blocking error.
  const { data: blocking, error: issuesError } = await supabase
    .from("validation_issues")
    .select("id")
    .eq("schedule_id", scheduleId)
    .eq("severity", "error")
    .eq("resolved", false)
    .limit(1);

  if (issuesError) throw fail("Checking validation issues", issuesError);

  if (blocking && blocking.length > 0) {
    const blocked = new Error("ยังมีข้อผิดพลาดที่ยังไม่ได้แก้ไข ไม่สามารถเผยแพร่ได้");
    blocked.code = "PUBLISH_BLOCKED";
    throw blocked;
  }

  const { error: archiveError } = await supabase
    .from("schedules")
    .update({ status: "archived" })
    .eq("teacher_id", schedule.teacher_id)
    .eq("academic_year", schedule.academic_year)
    .eq("semester", schedule.semester)
    .eq("status", "published");

  if (archiveError) throw fail("Archiving previous schedule", archiveError);

  const now = new Date().toISOString();
  const { data: published, error: publishError } = await supabase
    .from("schedules")
    .update({ status: "published", published_at: now, reviewed_by: reviewer || null, reviewed_at: now })
    .eq("id", scheduleId)
    .select()
    .single();

  if (publishError) {
    // The database refuses to publish a schedule with invalid entries, and its
    // message names the offending row. Pass that through rather than burying
    // it in a generic store error.
    if (publishError.code === "23514" || /เผยแพร่ไม่ได้/.test(publishError.message || "")) {
      const blocked = new Error(publishError.message);
      blocked.code = "PUBLISH_BLOCKED";
      throw blocked;
    }
    throw fail("Publishing schedule", publishError);
  }

  return { id: published.id, status: published.status, publishedAt: published.published_at };
}

/**
 * Counts what deleting a teacher would take with it, so the caller can say so
 * before doing it rather than after.
 */
async function summariseTeacherContents(teacherId) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("schedules")
    .select("id, status")
    .eq("teacher_id", teacherId);

  if (error) throw fail("Checking the teacher's schedules", error);

  const schedules = data || [];
  return {
    scheduleCount: schedules.length,
    publishedCount: schedules.filter((s) => s.status === "published").length,
  };
}

/**
 * Deletes a teacher and everything belonging to them.
 *
 * The cascade is the database's, so subjects, entries, issues and document
 * rows go with it. Stored PDFs are removed separately, since Storage is not
 * part of that cascade and would otherwise be orphaned.
 */
async function deleteTeacher(teacherId) {
  const supabase = getSupabase();

  const teacher = await getTeacher(teacherId);
  if (!teacher) return null;

  const summary = await summariseTeacherContents(teacherId);
  await removeStoredPdfs({ teacherId });

  const { error } = await supabase.from("teachers").delete().eq("id", teacherId);
  if (error) throw fail("Deleting teacher", error);

  return { teacher, ...summary };
}

/**
 * Deletes one schedule version and its rows.
 *
 * Publishing state is the caller's to check: a published schedule is the one
 * the chatbot is answering from, so deleting it silently would take the
 * teacher offline. The route requires that to be asked for explicitly.
 */
async function deleteSchedule(scheduleId, { allowPublished = false } = {}) {
  const supabase = getSupabase();

  const { data: schedule, error: lookupError } = await supabase
    .from("schedules")
    .select("id, teacher_id, academic_year, semester, status, version")
    .eq("id", scheduleId)
    .maybeSingle();

  if (lookupError) throw fail("Loading schedule", lookupError);
  if (!schedule) return null;

  // Checked here rather than in the route, against the stored row itself, so
  // the guard cannot be bypassed by a caller reading a stale or derived copy
  // of the status.
  if (schedule.status === "published" && !allowPublished) {
    const blocked = new Error("Refusing to delete a published schedule without confirmation.");
    blocked.code = "PUBLISHED_DELETE_NEEDS_CONFIRM";
    throw blocked;
  }

  await removeStoredPdfs({ scheduleId });

  const { error } = await supabase.from("schedules").delete().eq("id", scheduleId);
  if (error) throw fail("Deleting schedule", error);

  return {
    id: schedule.id,
    teacherId: schedule.teacher_id,
    academicYear: schedule.academic_year,
    semester: schedule.semester,
    status: schedule.status,
    version: schedule.version,
  };
}

/** Takes a published schedule back out of service without destroying it. */
async function unpublishSchedule(scheduleId) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("schedules")
    .update({ status: "archived" })
    .eq("id", scheduleId)
    .eq("status", "published")
    .select()
    .maybeSingle();

  if (error) throw fail("Unpublishing schedule", error);
  return data ? { id: data.id, status: data.status } : null;
}

/** Editable metadata on the schedule itself, as opposed to its rows. */
async function updateScheduleMeta(scheduleId, patch) {
  const supabase = getSupabase();

  const columns = {
    college: "college",
    department: "department",
    weekRange: "week_range",
    semesterStartDate: "semester_start_date",
    semesterEndDate: "semester_end_date",
    academicYear: "academic_year",
    semester: "semester",
  };

  const update = {};
  for (const [key, column] of Object.entries(columns)) {
    if (patch[key] !== undefined) update[column] = patch[key] === "" ? null : patch[key];
  }

  if (Object.keys(update).length === 0) {
    const error = new Error("No editable fields were provided.");
    error.code = "NOTHING_TO_UPDATE";
    throw error;
  }

  const { data, error } = await supabase
    .from("schedules")
    .update(update)
    .eq("id", scheduleId)
    .select()
    .maybeSingle();

  if (error) {
    // Moving a schedule onto a term that already has a published one.
    if (error.code === "23505") {
      const conflict = new Error("มีตารางสอนที่เผยแพร่แล้วของภาคเรียนนี้อยู่ก่อนแล้ว");
      conflict.code = "TERM_CONFLICT";
      throw conflict;
    }
    throw fail("Updating schedule", error);
  }

  return data;
}

/**
 * Adds a row by hand. OCR misses whole rows sometimes, and without this the
 * only remedy would be re-uploading and reviewing the entire document again.
 */
async function addEntry(scheduleId, entry) {
  const supabase = getSupabase();

  const { data: schedule, error: lookupError } = await supabase
    .from("schedules")
    .select("id")
    .eq("id", scheduleId)
    .maybeSingle();

  if (lookupError) throw fail("Loading schedule", lookupError);
  if (!schedule) return null;

  const { data, error } = await supabase
    .from("schedule_entries")
    .insert({
      schedule_id: scheduleId,
      day_th: entry.day ?? null,
      day_en: entry.dayEn ?? null,
      time_start: entry.timeStart ?? null,
      time_end: entry.timeEnd ?? null,
      subject_code: entry.subjectCode ?? null,
      session_type: entry.type ?? null,
      room: entry.room ?? null,
      student_group: entry.group ?? null,
      student_count: entry.studentCount ?? null,
      note: entry.note ?? null,
      needs_review: false,
      edited_by: entry.editedBy ?? null,
      edited_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23514" || /ไม่ถูกต้อง/.test(error.message || "")) {
      const invalid = new Error(error.message);
      invalid.code = "ENTRY_INVALID";
      throw invalid;
    }
    throw fail("Adding entry", error);
  }

  return data;
}

/**
 * Removes one row. Scoped by schedule as well as id, so a guessed id cannot
 * reach another teacher's rows.
 */
async function deleteEntry(scheduleId, entryId) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("schedule_entries")
    .delete()
    .eq("id", entryId)
    .eq("schedule_id", scheduleId)
    .select()
    .maybeSingle();

  if (error) throw fail("Deleting entry", error);
  return data || null;
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

async function findDocumentByChecksum(teacherId, checksum) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("documents")
    .select("id, file_name, schedule_id, uploaded_at")
    .eq("teacher_id", teacherId)
    .eq("checksum", checksum)
    .maybeSingle();

  if (error) throw fail("Checking for a duplicate upload", error);
  return data || null;
}

const PDF_BUCKET = "schedule-pdfs";

async function storePdf({ teacherId, scheduleId, buffer, fileName, checksum, uploadedBy, pageCount }) {
  const supabase = getSupabase();

  // Namespaced by teacher so a path can never collide across teachers.
  const storagePath = `${teacherId}/${checksum}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(PDF_BUCKET)
    .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });

  // An existing object means the same bytes are already stored; the row below
  // is what actually enforces "do not process this twice".
  if (uploadError && !/exists/i.test(uploadError.message)) {
    // The bucket is created by the migration, but that statement is the one
    // most likely to have been skipped if it hit a permissions error in the
    // SQL editor. Say so rather than reporting a generic storage failure.
    if (/bucket.*not.*found/i.test(uploadError.message)) {
      const missing = new Error(
        `Supabase Storage bucket "${PDF_BUCKET}" does not exist.`
      );
      missing.code = "STORAGE_BUCKET_MISSING";
      throw missing;
    }
    throw fail("Uploading the PDF", uploadError);
  }

  const { data, error } = await supabase
    .from("documents")
    .insert({
      teacher_id: teacherId,
      schedule_id: scheduleId || null,
      storage_path: storagePath,
      file_name: fileName,
      file_size: buffer.length,
      checksum,
      page_count: pageCount ?? null,
      ocr_status: "done",
      uploaded_by: uploadedBy || null,
    })
    .select()
    .single();

  if (error) throw fail("Recording the document", error);
  return { id: data.id, storagePath };
}

/** Short-lived signed URL so reviewers can see the PDF without a public bucket. */
async function getDocumentUrl(storagePath, expiresInSeconds = 300) {
  const supabase = getSupabase();

  const { data, error } = await supabase.storage
    .from(PDF_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error) throw fail("Creating a document link", error);
  return data.signedUrl;
}

/**
 * Deletes stored PDFs for a teacher or a schedule. Storage is not covered by
 * the database's cascade, so without this the files would outlive the rows
 * that point at them.
 *
 * Best effort: a schedule that cannot lose its file should still be
 * deletable, so failures here are logged rather than thrown.
 */
async function removeStoredPdfs({ teacherId, scheduleId }) {
  const supabase = getSupabase();

  try {
    let query = supabase.from("documents").select("storage_path");
    query = teacherId ? query.eq("teacher_id", teacherId) : query.eq("schedule_id", scheduleId);

    const { data, error } = await query;
    if (error || !data || data.length === 0) return;

    const paths = data.map((row) => row.storage_path).filter(Boolean);
    if (paths.length > 0) await supabase.storage.from(PDF_BUCKET).remove(paths);
  } catch (error) {
    console.error("[store] could not remove stored PDFs", error);
  }
}

module.exports = {
  name: "supabase",
  listTeachers,
  listAllTeachers,
  getTeacher,
  createTeacher,
  updateTeacher,
  getPublishedSchedule,
  listSchedulesForTeacher,
  createDraftSchedule,
  getScheduleForReview,
  updateEntry,
  publishSchedule,
  findDocumentByChecksum,
  storePdf,
  getDocumentUrl,
  toScheduleDocument,
  PDF_BUCKET,
  summariseTeacherContents,
  deleteTeacher,
  deleteSchedule,
  unpublishSchedule,
  updateScheduleMeta,
  addEntry,
  deleteEntry,
};
