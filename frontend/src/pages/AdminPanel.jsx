import { useCallback, useEffect, useState } from "react";
import { api, getAdminToken, setAdminToken } from "../api.js";

// Mirrors the limit multer enforces on the server.
const MAX_PDF_BYTES = 15 * 1024 * 1024;

const THAI_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

const STATUS_LABELS = {
  draft: "ร่าง",
  needs_review: "รอตรวจสอบ",
  published: "เผยแพร่แล้ว",
  archived: "เก็บถาวร",
};

/* -------------------------------------------------------------------------- */

function TokenGate({ onAuthenticated }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setChecking(true);
    setError(null);

    setAdminToken(token.trim());
    try {
      await api.admin.listTeachers();
      onAuthenticated();
    } catch (err) {
      setAdminToken("");
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="admin-card admin-card--narrow">
      <h1 className="admin-title">เข้าสู่ระบบผู้ดูแล</h1>
      <p className="admin-hint">
        กรอกโทเคนผู้ดูแลที่ตั้งไว้ใน ADMIN_TOKENS ฝั่งเซิร์ฟเวอร์ โทเคนจะถูกเก็บไว้เฉพาะในแท็บนี้เท่านั้น
      </p>

      <form onSubmit={submit} className="admin-form">
        <input
          className="admin-input"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="โทเคนผู้ดูแล"
          autoComplete="off"
        />
        <button className="admin-button" type="submit" disabled={checking || !token.trim()}>
          {checking ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}
        </button>
      </form>

      {error && <p className="admin-error">{error}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function UploadForm({ teachers, onUploaded }) {
  const currentBuddhistYear = new Date().getFullYear() + 543;

  const [teacherId, setTeacherId] = useState("");
  const [academicYear, setAcademicYear] = useState(currentBuddhistYear);
  const [semester, setSemester] = useState(1);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (!file || !teacherId) return;

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const data = await api.admin.upload({ file, teacherId, academicYear, semester });
      setResult(data);
      onUploaded(teacherId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Every field below needs a teacher, so with none in the system the form is
  // permanently disabled. Say why instead of presenting a dead form.
  if (teachers.length === 0) {
    return (
      <section className="admin-card">
        <h2 className="admin-subtitle">อัปโหลดตารางสอน (PDF)</h2>
        <p className="admin-hint">
          ต้องเพิ่มอาจารย์ก่อนจึงจะอัปโหลดตารางสอนได้ — กดปุ่ม “+ เพิ่มอาจารย์” ด้านบน
          หรือย้ายข้อมูลเดิมเข้ามาด้วยคำสั่ง
          {" "}
          <code className="admin-code">node scripts/migrate-schedule-json.js</code>
        </p>
      </section>
    );
  }

  return (
    <section className="admin-card">
      <h2 className="admin-subtitle">อัปโหลดตารางสอน (PDF)</h2>
      <p className="admin-hint">
        ระบบจะอ่านข้อมูลด้วย OCR แล้วเก็บเป็นฉบับร่าง ตารางสอนที่ใช้งานอยู่จะไม่เปลี่ยนจนกว่าจะกดเผยแพร่
      </p>

      <form onSubmit={submit} className="admin-form admin-form--grid">
        <label className="admin-field">
          <span>อาจารย์</span>
          <select className="admin-input" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">— เลือกอาจารย์ —</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.fullName}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-field">
          <span>ปีการศึกษา (พ.ศ.)</span>
          <input
            className="admin-input"
            type="number"
            value={academicYear}
            onChange={(e) => setAcademicYear(Number(e.target.value))}
          />
        </label>

        <label className="admin-field">
          <span>ภาคเรียน</span>
          <select className="admin-input" value={semester} onChange={(e) => setSemester(Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>

        <label className="admin-field">
          <span>ไฟล์ PDF</span>
          <input
            className="admin-input"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const picked = e.target.files?.[0] || null;
              setError(
                picked && picked.size > MAX_PDF_BYTES
                  ? `ไฟล์ใหญ่ ${(picked.size / 1024 / 1024).toFixed(1)}MB เกินขีดจำกัด 15MB`
                  : null
              );
              setFile(picked);
            }}
          />
        </label>

        <button
          className="admin-button"
          type="submit"
          disabled={busy || !file || !teacherId || file.size > MAX_PDF_BYTES}
        >
          {busy ? "กำลังอ่านเอกสาร… (อาจใช้เวลา 1-2 นาที)" : "อัปโหลดและอ่านข้อมูล"}
        </button>
      </form>

      {error && <p className="admin-error">{error}</p>}

      {result && (
        <div className="admin-result">
          <p>{result.message}</p>
          <ul className="admin-result__counts">
            <li>ข้อผิดพลาด: {result.validation.errorCount}</li>
            <li>คำเตือน: {result.validation.warningCount}</li>
            <li>แก้ไขอัตโนมัติ: {result.validation.autoFixCount}</li>
          </ul>
          <p className="admin-hint">
            ข้อมูลถูกบันทึกเป็น “{STATUS_LABELS[result.status] || result.status}” ยังไม่เผยแพร่
            ตารางสอนเดิมของอาจารย์ท่านนี้ยังใช้งานได้ตามปกติจนกว่าจะกดเผยแพร่
          </p>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function EntryRow({ scheduleId, entry, issues, onSaved }) {
  const [draft, setDraft] = useState(entry);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const entryIssues = issues.filter((issue) => issue.entryId === entry.id);
  const hasError = entryIssues.some((issue) => issue.severity === "error");

  const dirty = ["day", "timeStart", "timeEnd", "subjectCode", "room", "group"].some(
    (field) => draft[field] !== entry[field]
  );

  function set(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);

    try {
      await api.admin.updateEntry(scheduleId, entry.id, {
        day: draft.day,
        timeStart: draft.timeStart,
        timeEnd: draft.timeEnd,
        subjectCode: draft.subjectCode,
        room: draft.room,
        group: draft.group,
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const rowClass = [
    "entry-row",
    hasError ? "entry-row--error" : "",
    !hasError && entryIssues.length > 0 ? "entry-row--warning" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <tr className={rowClass}>
        <td>
          <select className="entry-input" value={draft.day || ""} onChange={(e) => set("day", e.target.value)}>
            {THAI_WEEKDAYS.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
        </td>
        <td>
          <input className="entry-input entry-input--time" value={draft.timeStart || ""} onChange={(e) => set("timeStart", e.target.value)} />
        </td>
        <td>
          <input className="entry-input entry-input--time" value={draft.timeEnd || ""} onChange={(e) => set("timeEnd", e.target.value)} />
        </td>
        <td>
          <input className="entry-input" value={draft.subjectCode || ""} onChange={(e) => set("subjectCode", e.target.value)} />
        </td>
        <td>
          <input className="entry-input" value={draft.room || ""} onChange={(e) => set("room", e.target.value)} />
        </td>
        <td>
          <input className="entry-input" value={draft.group || ""} onChange={(e) => set("group", e.target.value)} />
        </td>
        <td>
          <button className="admin-button admin-button--small" onClick={save} disabled={saving || !dirty}>
            {saving ? "…" : saved ? "บันทึกแล้ว" : "บันทึก"}
          </button>
        </td>
      </tr>

      {(entryIssues.length > 0 || error) && (
        <tr className={rowClass}>
          <td colSpan={7} className="entry-issues">
            {entryIssues.map((issue) => (
              <div key={issue.id} className={`entry-issue entry-issue--${issue.severity}`}>
                {issue.severity === "error" ? "✕" : "!"} {issue.message}
              </div>
            ))}
            {error && <div className="entry-issue entry-issue--error">{error}</div>}
          </td>
        </tr>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function ReviewPanel({ scheduleId, onClose, onPublished }) {
  const [schedule, setSchedule] = useState(null);
  const [documentUrl, setDocumentUrl] = useState(null);
  const [error, setError] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.admin.getSchedule(scheduleId);
      setSchedule(data.schedule);
      setDocumentUrl(data.documentUrl);
    } catch (err) {
      setError(err.message);
    }
  }, [scheduleId]);

  useEffect(() => {
    load();
  }, [load]);

  async function publish() {
    setPublishing(true);
    setError(null);

    try {
      await api.admin.publish(scheduleId);
      setNotice("เผยแพร่เรียบร้อยแล้ว");
      onPublished();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  if (error && !schedule) return <p className="admin-error">{error}</p>;
  if (!schedule) return <p className="admin-hint">กำลังโหลด…</p>;

  const issues = schedule.issues || [];
  const errorCount = issues.filter((issue) => issue.severity === "error").length;

  return (
    <section className="admin-card">
      <div className="review-header">
        <div>
          <h2 className="admin-subtitle">
            ตรวจสอบตารางสอน · {schedule.teacher?.name} · ภาคเรียน {schedule.semester}
          </h2>
          <p className="admin-hint">
            สถานะ: {STATUS_LABELS[schedule.status] || schedule.status} · ข้อผิดพลาด {errorCount} ·
            คำเตือน {issues.length - errorCount}
          </p>
        </div>
        <button className="admin-button admin-button--ghost" onClick={onClose}>
          ปิด
        </button>
      </div>

      {notice && <p className="admin-notice">{notice}</p>}
      {error && <p className="admin-error">{error}</p>}

      <div className="review-split">
        {/* The original PDF beside the extracted data, so a reviewer can
            compare rather than trust the reading. */}
        <div className="review-pdf">
          {documentUrl ? (
            <iframe title="ตารางสอนต้นฉบับ" src={documentUrl} className="review-pdf__frame" />
          ) : (
            <p className="admin-hint">ไม่มีไฟล์ต้นฉบับสำหรับตารางสอนนี้</p>
          )}
        </div>

        <div className="review-table-wrap">
          <table className="review-table">
            <thead>
              <tr>
                <th>วัน</th>
                <th>เริ่ม</th>
                <th>สิ้นสุด</th>
                <th>รหัสวิชา</th>
                <th>ห้อง</th>
                <th>กลุ่ม</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(schedule.sessions || []).map((entry) => (
                <EntryRow
                  key={entry.id}
                  scheduleId={scheduleId}
                  entry={entry}
                  issues={issues}
                  onSaved={load}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="review-actions">
        <button
          className="admin-button"
          onClick={publish}
          disabled={publishing || errorCount > 0 || schedule.status === "published"}
        >
          {publishing ? "กำลังเผยแพร่…" : "เผยแพร่ให้ Chatbot ใช้งาน"}
        </button>

        {errorCount > 0 && (
          <span className="admin-hint">ต้องแก้ไขข้อผิดพลาดทั้งหมดก่อนจึงจะเผยแพร่ได้</span>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function NewTeacherForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [department, setDepartment] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await api.admin.createTeacher({ code: code.trim(), fullName: fullName.trim(), department });
      setCode("");
      setFullName("");
      setDepartment("");
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="admin-button admin-button--ghost" onClick={() => setOpen(true)}>
        + เพิ่มอาจารย์
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="admin-form admin-form--grid">
      <label className="admin-field">
        <span>รหัสอาจารย์</span>
        <input className="admin-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="เช่น maitri" />
      </label>
      <label className="admin-field">
        <span>ชื่อ-นามสกุล</span>
        <input className="admin-input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="เช่น นายไมตรี นาโพธิ์" />
      </label>
      <label className="admin-field">
        <span>แผนกวิชา</span>
        <input className="admin-input" value={department} onChange={(e) => setDepartment(e.target.value)} />
      </label>

      <div className="admin-form__actions">
        <button className="admin-button" type="submit" disabled={busy || !code.trim() || !fullName.trim()}>
          บันทึก
        </button>
        <button className="admin-button admin-button--ghost" type="button" onClick={() => setOpen(false)}>
          ยกเลิก
        </button>
      </div>

      {error && <p className="admin-error">{error}</p>}
    </form>
  );
}

/* -------------------------------------------------------------------------- */

export default function AdminPanel() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(getAdminToken()));
  const [teachers, setTeachers] = useState([]);
  const [schedulesByTeacher, setSchedulesByTeacher] = useState({});
  const [reviewing, setReviewing] = useState(null);
  const [error, setError] = useState(null);

  const loadTeachers = useCallback(async () => {
    try {
      const data = await api.admin.listTeachers();
      setTeachers(data.teachers || []);
    } catch (err) {
      setError(err.message);
      if (err.status === 401 || err.status === 403) setAuthenticated(false);
    }
  }, []);

  const loadSchedules = useCallback(async (teacherId) => {
    try {
      const data = await api.admin.listSchedules(teacherId);
      setSchedulesByTeacher((prev) => ({ ...prev, [teacherId]: data.schedules || [] }));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (authenticated) loadTeachers();
  }, [authenticated, loadTeachers]);

  if (!authenticated) {
    return <TokenGate onAuthenticated={() => setAuthenticated(true)} />;
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <h1 className="admin-title">ระบบจัดการตารางสอน</h1>
        <div className="admin-header__actions">
          <a className="admin-button admin-button--ghost" href="#">
            ไปหน้าแชท
          </a>
          <button
            className="admin-button admin-button--ghost"
            onClick={() => {
              setAdminToken("");
              setAuthenticated(false);
            }}
          >
            ออกจากระบบ
          </button>
        </div>
      </header>

      {error && <p className="admin-error">{error}</p>}

      <section className="admin-card">
        <div className="review-header">
          <h2 className="admin-subtitle">อาจารย์ทั้งหมด ({teachers.length})</h2>
          <NewTeacherForm onCreated={loadTeachers} />
        </div>

        <ul className="admin-teacher-list">
          {teachers.map((teacher) => (
            <li key={teacher.id} className="admin-teacher">
              <div className="admin-teacher__head">
                <span className="admin-teacher__name">{teacher.fullName}</span>
                <span className="admin-teacher__meta">{teacher.department || "—"}</span>
                <button
                  className="admin-button admin-button--small admin-button--ghost"
                  onClick={() => loadSchedules(teacher.id)}
                >
                  ดูตารางสอน
                </button>
              </div>

              {schedulesByTeacher[teacher.id] && (
                <ul className="admin-schedule-list">
                  {schedulesByTeacher[teacher.id].length === 0 && (
                    <li className="admin-hint">ยังไม่มีตารางสอน</li>
                  )}
                  {schedulesByTeacher[teacher.id].map((schedule) => (
                    <li key={schedule.id} className="admin-schedule">
                      <span>
                        ภาคเรียน {schedule.semester}/{schedule.academicYear} · เวอร์ชัน {schedule.version}
                      </span>
                      <span className={`status-pill status-pill--${schedule.status}`}>
                        {STATUS_LABELS[schedule.status] || schedule.status}
                      </span>
                      <button
                        className="admin-button admin-button--small"
                        onClick={() => setReviewing(schedule.id)}
                      >
                        ตรวจสอบ
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      <UploadForm teachers={teachers} onUploaded={loadSchedules} />

      {reviewing && (
        <ReviewPanel
          scheduleId={reviewing}
          onClose={() => setReviewing(null)}
          onPublished={loadTeachers}
        />
      )}
    </div>
  );
}
