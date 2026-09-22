import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import StatusPill from "./StatusPill.jsx";

const THAI_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const SESSION_TYPES = ["ทฤษฎี", "ปฏิบัติ"];

const EDITABLE = ["day", "timeStart", "timeEnd", "subjectCode", "type", "room", "group"];

const EMPTY_ROW = {
  day: "จันทร์",
  timeStart: "",
  timeEnd: "",
  subjectCode: "",
  type: "",
  room: "",
  group: "",
};

/** One editable row. Saves only when something actually changed. */
function EntryRow({ scheduleId, entry, issues, onChanged, onAskDelete }) {
  const [draft, setDraft] = useState(entry);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(entry);
    setSaved(false);
  }, [entry]);

  const entryIssues = issues.filter((issue) => issue.entryId === entry.id);
  const hasError = entryIssues.some((issue) => issue.severity === "error");
  const dirty = EDITABLE.some((field) => (draft[field] || "") !== (entry[field] || ""));

  function set(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.admin.updateEntry(
        scheduleId,
        entry.id,
        Object.fromEntries(EDITABLE.map((field) => [field, draft[field] ?? null]))
      );
      setSaved(true);
      onChanged();
    } catch (err) {
      setError(err.detail ? `${err.message} (${err.detail})` : err.message);
    } finally {
      setSaving(false);
    }
  }

  const rowClass = [
    "entry-row",
    hasError ? "entry-row--error" : entryIssues.length > 0 ? "entry-row--warning" : "",
    dirty ? "entry-row--dirty" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <tr className={rowClass}>
        <td>
          <select className="entry-input" value={draft.day || ""} onChange={(e) => set("day", e.target.value)}>
            <option value="">—</option>
            {THAI_WEEKDAYS.map((day) => (
              <option key={day} value={day}>{day}</option>
            ))}
          </select>
        </td>
        <td>
          <input
            className="entry-input entry-input--time"
            value={draft.timeStart || ""}
            placeholder="09:00"
            onChange={(e) => set("timeStart", e.target.value)}
          />
        </td>
        <td>
          <input
            className="entry-input entry-input--time"
            value={draft.timeEnd || ""}
            placeholder="11:00"
            onChange={(e) => set("timeEnd", e.target.value)}
          />
        </td>
        <td>
          <input className="entry-input" value={draft.subjectCode || ""} onChange={(e) => set("subjectCode", e.target.value)} />
        </td>
        <td>
          <select className="entry-input" value={draft.type || ""} onChange={(e) => set("type", e.target.value)}>
            <option value="">—</option>
            {SESSION_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </td>
        <td>
          <input className="entry-input" value={draft.room || ""} onChange={(e) => set("room", e.target.value)} />
        </td>
        <td>
          <input className="entry-input" value={draft.group || ""} onChange={(e) => set("group", e.target.value)} />
        </td>
        <td className="entry-actions">
          <button className="admin-button admin-button--small" onClick={save} disabled={saving || !dirty}>
            {saving ? "…" : saved && !dirty ? "บันทึกแล้ว" : "บันทึก"}
          </button>
          <button
            className="icon-button icon-button--danger"
            onClick={() => onAskDelete(entry)}
            title="ลบคาบนี้"
            aria-label="ลบคาบนี้"
          >
            ✕
          </button>
        </td>
      </tr>

      {(entryIssues.length > 0 || error) && (
        <tr className={rowClass}>
          <td colSpan={8} className="entry-issues">
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

/** Adding a row OCR missed entirely. */
function AddEntryRow({ scheduleId, onAdded }) {
  const [draft, setDraft] = useState(EMPTY_ROW);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const ready = draft.day && draft.timeStart && draft.timeEnd && draft.subjectCode;

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api.admin.addEntry(scheduleId, draft);
      setDraft(EMPTY_ROW);
      onAdded();
    } catch (err) {
      setError(err.detail ? `${err.message} (${err.detail})` : err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (field) => (event) => setDraft((prev) => ({ ...prev, [field]: event.target.value }));

  return (
    <>
      <tr className="entry-row entry-row--new">
        <td>
          <select className="entry-input" value={draft.day} onChange={set("day")}>
            {THAI_WEEKDAYS.map((day) => (
              <option key={day} value={day}>{day}</option>
            ))}
          </select>
        </td>
        <td><input className="entry-input entry-input--time" value={draft.timeStart} placeholder="09:00" onChange={set("timeStart")} /></td>
        <td><input className="entry-input entry-input--time" value={draft.timeEnd} placeholder="11:00" onChange={set("timeEnd")} /></td>
        <td><input className="entry-input" value={draft.subjectCode} placeholder="รหัสวิชา" onChange={set("subjectCode")} /></td>
        <td>
          <select className="entry-input" value={draft.type} onChange={set("type")}>
            <option value="">—</option>
            {SESSION_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </td>
        <td><input className="entry-input" value={draft.room} placeholder="ห้อง" onChange={set("room")} /></td>
        <td><input className="entry-input" value={draft.group} placeholder="กลุ่ม" onChange={set("group")} /></td>
        <td className="entry-actions">
          <button className="admin-button admin-button--small" onClick={add} disabled={busy || !ready}>
            {busy ? "…" : "+ เพิ่ม"}
          </button>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={8} className="entry-issues">
            <div className="entry-issue entry-issue--error">{error}</div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Editable schedule metadata — the term, and the dates holiday answers use. */
function ScheduleMeta({ scheduleId, schedule, onSaved }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    semesterStartDate: schedule.semesterStartDate || "",
    semesterEndDate: schedule.semesterEndDate || "",
    college: schedule.college || "",
    department: schedule.department || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.admin.updateSchedule(scheduleId, form);
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="admin-button admin-button--ghost admin-button--small" onClick={() => setOpen(true)}>
        แก้ไขข้อมูลภาคเรียน
      </button>
    );
  }

  return (
    <div className="panel panel--inset">
      <h3 className="panel__title">ข้อมูลภาคเรียน</h3>
      <p className="panel__subtitle">
        วันเปิด-ปิดภาคเรียนใช้จำกัดขอบเขตคำตอบเรื่องวันหยุด ถ้าเว้นว่างจะตอบครอบคลุมทั้งปีปฏิทินแทน
      </p>

      <div className="field-grid">
        <label className="field">
          <span className="field__label">วันเปิดภาคเรียน</span>
          <input className="input" type="date" value={form.semesterStartDate} onChange={set("semesterStartDate")} />
        </label>
        <label className="field">
          <span className="field__label">วันปิดภาคเรียน</span>
          <input className="input" type="date" value={form.semesterEndDate} onChange={set("semesterEndDate")} />
        </label>
        <label className="field">
          <span className="field__label">วิทยาลัย</span>
          <input className="input" value={form.college} onChange={set("college")} />
        </label>
        <label className="field">
          <span className="field__label">แผนกวิชา</span>
          <input className="input" value={form.department} onChange={set("department")} />
        </label>
      </div>

      {error && <p className="alert alert--error">{error}</p>}

      <div className="button-row">
        <button className="admin-button" onClick={save} disabled={busy}>
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button className="admin-button admin-button--ghost" onClick={() => setOpen(false)} disabled={busy}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

export default function ScheduleReview({ scheduleId, onBack, onChanged }) {
  const [schedule, setSchedule] = useState(null);
  const [documentUrl, setDocumentUrl] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [showPdf, setShowPdf] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.admin.getSchedule(scheduleId);
      setSchedule(data.schedule);
      setDocumentUrl(data.documentUrl);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [scheduleId]);

  useEffect(() => {
    load();
  }, [load]);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      await api.admin.publish(scheduleId);
      setNotice("เผยแพร่เรียบร้อยแล้ว — Chatbot ใช้ข้อมูลชุดนี้ตอบได้ทันที");
      await load();
      onChanged();
    } catch (err) {
      setError(err.detail ? `${err.message} (${err.detail})` : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntry(entry) {
    setBusy(true);
    try {
      await api.admin.deleteEntry(scheduleId, entry.id);
      setConfirming(null);
      await load();
    } catch (err) {
      setError(err.message);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  if (error && !schedule) {
    return (
      <>
        <button className="back-link" onClick={onBack}>← กลับ</button>
        <p className="alert alert--error">{error}</p>
      </>
    );
  }

  if (!schedule) return <p className="empty-note">กำลังโหลด…</p>;

  const issues = schedule.issues || [];
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.length - errorCount;
  const sessions = schedule.sessions || [];

  return (
    <>
      <button className="back-link" onClick={onBack}>
        ← กลับไปหน้าอาจารย์
      </button>

      <div className="panel">
        <div className="panel__head">
          <div>
            <h2 className="panel__title">
              {schedule.teacher?.name} · ภาคเรียน {schedule.semester}
            </h2>
            <p className="panel__subtitle">
              <StatusPill status={schedule.status} /> {sessions.length} คาบ ·{" "}
              {errorCount > 0 ? `ต้องแก้ ${errorCount}` : "ไม่มีข้อผิดพลาด"}
              {warningCount > 0 ? ` · ควรตรวจ ${warningCount}` : ""}
            </p>
          </div>
          <ScheduleMeta scheduleId={scheduleId} schedule={schedule} onSaved={load} />
        </div>

        {notice && <p className="alert alert--ok">{notice}</p>}
        {error && <p className="alert alert--error">{error}</p>}

        {errorCount === 0 && sessions.length > 0 && schedule.status !== "published" && (
          <p className="alert alert--ok">ข้อมูลผ่านการตรวจแล้ว กดเผยแพร่ได้เลย</p>
        )}
      </div>

      <div className={`review-split ${documentUrl && showPdf ? "" : "review-split--single"}`}>
        {documentUrl && showPdf && (
          <div className="panel review-pdf">
            <div className="panel__head">
              <h3 className="panel__title">ไฟล์ต้นฉบับ</h3>
              <button
                className="admin-button admin-button--ghost admin-button--small"
                onClick={() => setShowPdf(false)}
              >
                ซ่อน
              </button>
            </div>
            <iframe title="ตารางสอนต้นฉบับ" src={documentUrl} className="review-pdf__frame" />
          </div>
        )}

        <div className="panel">
          <div className="panel__head">
            <div>
              <h3 className="panel__title">ข้อมูลที่อ่านได้</h3>
              <p className="panel__subtitle">
                แถวสีแดงต้องแก้ก่อนเผยแพร่ · สีเหลืองควรตรวจสอบ · แก้ในช่องแล้วกดบันทึกทีละแถว
              </p>
            </div>
            {documentUrl && !showPdf && (
              <button
                className="admin-button admin-button--ghost admin-button--small"
                onClick={() => setShowPdf(true)}
              >
                แสดงไฟล์ต้นฉบับ
              </button>
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
                  <th>ประเภท</th>
                  <th>ห้อง</th>
                  <th>กลุ่ม</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    scheduleId={scheduleId}
                    entry={entry}
                    issues={issues}
                    onChanged={load}
                    onAskDelete={(row) =>
                      setConfirming({
                        title: "ลบคาบเรียน",
                        message: `ลบคาบวัน${row.day || "—"} เวลา ${row.timeStart || "—"}–${row.timeEnd || "—"} หรือไม่`,
                        run: () => deleteEntry(row),
                      })
                    }
                  />
                ))}
                <AddEntryRow scheduleId={scheduleId} onAdded={load} />
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel publish-bar">
        <div>
          <strong>
            {schedule.status === "published" ? "ตารางสอนชุดนี้เผยแพร่อยู่" : "ยังไม่เผยแพร่"}
          </strong>
          <p className="panel__subtitle">
            {errorCount > 0
              ? `ต้องแก้ข้อผิดพลาด ${errorCount} รายการก่อนจึงจะเผยแพร่ได้`
              : sessions.length === 0
                ? "ต้องมีคาบเรียนอย่างน้อย 1 คาบ"
                : "Chatbot จะใช้ข้อมูลชุดนี้ตอบทันทีหลังเผยแพร่"}
          </p>
        </div>
        <button
          className="admin-button"
          onClick={publish}
          disabled={busy || errorCount > 0 || sessions.length === 0 || schedule.status === "published"}
        >
          {busy ? "กำลังเผยแพร่…" : "เผยแพร่ให้ Chatbot ใช้งาน"}
        </button>
      </div>

      <ConfirmDialog
        open={Boolean(confirming)}
        danger
        busy={busy}
        title={confirming?.title || ""}
        message={confirming?.message || ""}
        confirmLabel="ลบ"
        onConfirm={() => confirming.run()}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}
