#!/usr/bin/env node
/**
 * Moves the existing data/schedule.json into Supabase as a normal teacher +
 * published schedule.
 *
 * Properties this script is written to have:
 *
 *   - It never writes to or deletes data/schedule.json. The file stays as the
 *     backup, and the JSON store keeps working from it if Supabase is
 *     unconfigured.
 *   - It is safe to run twice. The teacher is matched on a stable code and the
 *     schedule on (teacher, year, semester), so a second run reports "already
 *     migrated" instead of creating duplicates.
 *   - It validates before writing, and refuses to publish data that would be
 *     blocked coming from OCR. The same gate applies to imported data.
 *
 * Usage:
 *   node scripts/migrate-schedule-json.js [--dry-run] [--teacher-code=maitri]
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { isSupabaseConfigured, getSupabase } = require("../lib/supabaseClient");
const { validateSchedule } = require("../services/scheduleValidator");

const SCHEDULE_PATH = path.join(__dirname, "..", "data", "schedule.json");

function parseArgs(argv) {
  const args = { dryRun: false, teacherCode: "maitri" };

  for (const arg of argv.slice(2)) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--teacher-code=")) args.teacherCode = arg.split("=")[1];
  }

  return args;
}

/** "1/2569" -> { semester: 1, academicYear: 2569 } */
function parseSemester(raw) {
  const match = String(raw || "").match(/^(\d)\s*\/\s*(\d{4})$/);
  if (!match) return null;
  return { semester: Number(match[1]), academicYear: Number(match[2]) };
}

async function main() {
  const args = parseArgs(process.argv);

  if (!fs.existsSync(SCHEDULE_PATH)) {
    console.error(`No file at ${SCHEDULE_PATH} — nothing to migrate.`);
    process.exit(1);
  }

  // Checked only for a real run, so --dry-run can inspect the data before
  // anything is configured.
  if (!args.dryRun && !isSupabaseConfigured()) {
    console.error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env first."
    );
    process.exit(1);
  }

  const source = JSON.parse(fs.readFileSync(SCHEDULE_PATH, "utf-8"));

  const term = parseSemester(source.semester);
  if (!term) {
    console.error(
      `Could not read an academic year and semester from "${source.semester}". Expected something like "1/2569".`
    );
    process.exit(1);
  }

  // The imported data goes through exactly the same gate as an OCR upload.
  const validation = validateSchedule(source);

  console.log(`Source     : ${SCHEDULE_PATH}`);
  console.log(`Teacher    : ${source.teacher?.name}`);
  console.log(`Term       : ${term.semester}/${term.academicYear}`);
  console.log(`Sessions   : ${validation.entries.length}`);
  console.log(`Validation : ${validation.status} (${validation.errorCount} errors, ${validation.warningCount} warnings)`);

  for (const issue of validation.issues) {
    console.log(`  [${issue.severity}] ${issue.ruleCode}: ${issue.message}`);
  }

  if (validation.status === "blocked") {
    console.error("\nRefusing to import: the existing file has errors that would block publishing.");
    process.exit(1);
  }

  if (args.dryRun) {
    console.log("\n--dry-run: nothing was written.");
    return;
  }

  const supabase = getSupabase();

  // --- teacher (idempotent on code) ----------------------------------------
  const { data: existingTeacher, error: teacherLookupError } = await supabase
    .from("teachers")
    .select("id, full_name")
    .eq("code", args.teacherCode)
    .maybeSingle();

  if (teacherLookupError) throw teacherLookupError;

  let teacherId = existingTeacher?.id;

  if (teacherId) {
    console.log(`\nTeacher "${args.teacherCode}" already exists; reusing it.`);
  } else {
    const { data, error } = await supabase
      .from("teachers")
      .insert({
        code: args.teacherCode,
        full_name: source.teacher?.name || "ไม่ระบุชื่อ",
        nickname: source.teacher?.nickname || null,
        education: source.teacher?.education || null,
        duty: source.teacher?.duty || null,
        department: source.department || null,
      })
      .select("id")
      .single();

    if (error) throw error;
    teacherId = data.id;
    console.log(`\nCreated teacher "${args.teacherCode}".`);
  }

  // --- schedule (idempotent on teacher + term) ------------------------------
  const { data: existingSchedule, error: scheduleLookupError } = await supabase
    .from("schedules")
    .select("id, status")
    .eq("teacher_id", teacherId)
    .eq("academic_year", term.academicYear)
    .eq("semester", term.semester)
    .maybeSingle();

  if (scheduleLookupError) throw scheduleLookupError;

  if (existingSchedule) {
    console.log(
      `A ${term.semester}/${term.academicYear} schedule already exists for this teacher (${existingSchedule.status}).`
    );
    console.log("Already migrated — nothing to do. data/schedule.json is unchanged.");
    return;
  }

  const now = new Date().toISOString();

  const { data: schedule, error: scheduleError } = await supabase
    .from("schedules")
    .insert({
      teacher_id: teacherId,
      academic_year: term.academicYear,
      semester: term.semester,
      college: source.college || null,
      department: source.department || null,
      week_range: source.weekRange || null,
      semester_start_date: source.semesterStartDate || null,
      semester_end_date: source.semesterEndDate || null,
      // Published directly: this is the data the chatbot has been answering
      // from all along, and it has just passed validation.
      status: "published",
      version: 1,
      source_file_name: source.sourceFile || "schedule.json",
      published_at: now,
      reviewed_by: "migration",
      reviewed_at: now,
    })
    .select("id")
    .single();

  if (scheduleError) throw scheduleError;

  try {
    const subjects = (source.subjects || [])
      .filter((subject) => subject.code)
      .map((subject) => ({
        schedule_id: schedule.id,
        code: String(subject.code).trim(),
        name: subject.name || String(subject.code).trim(),
        theory_hours: subject.hours?.theory ?? null,
        practice_hours: subject.hours?.practice ?? null,
        credit_units: subject.hours?.creditUnits ?? null,
        total_hours_per_week: subject.hours?.totalHoursPerWeek ?? null,
      }));

    if (subjects.length > 0) {
      const { error } = await supabase.from("subjects").insert(subjects);
      if (error) throw error;
    }

    const entries = validation.entries.map((entry) => ({
      schedule_id: schedule.id,
      day_th: entry.day,
      day_en: entry.dayEn || null,
      time_start: entry.timeStart,
      time_end: entry.timeEnd,
      subject_code: entry.subjectCode,
      session_type: entry.type || null,
      room: entry.room || null,
      student_group: entry.group || null,
      student_count: entry.studentCount ?? null,
      note: entry.note || null,
      needs_review: false,
    }));

    if (entries.length > 0) {
      const { error } = await supabase.from("schedule_entries").insert(entries);
      if (error) throw error;
    }

    console.log(`Imported ${subjects.length} subjects and ${entries.length} sessions.`);
    console.log(`Schedule ${schedule.id} is published.`);
    console.log("\ndata/schedule.json was not modified; it remains as a backup.");
  } catch (error) {
    // Do not leave a published-but-empty schedule behind.
    await supabase.from("schedules").delete().eq("id", schedule.id);
    throw error;
  }
}

main().catch((error) => {
  console.error("\nMigration failed:", error.message);
  process.exit(1);
});
