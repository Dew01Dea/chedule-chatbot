import { useState } from "react";
import { api } from "../../api.js";
import ConfirmDialog from "./ConfirmDialog.jsx";

function NewTeacherForm({ onCreated, onCancel }) {
  const [form, setForm] = useState({ code: "", fullName: "", department: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await api.admin.createTeacher({
        code: form.code.trim(),
        fullName: form.fullName.trim(),
        department: form.department.trim(),
      });
      onCreated();
    } catch (err) {
      setError(err.detail ? `${err.message} (${err.detail})` : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel panel--inset">
      <h3 className="panel__title">เพิ่มอาจารย์ใหม่</h3>

      <div className="field-grid">
        <label className="field">
          <span className="field__label">ชื่อ-นามสกุล</span>
          <input className="input" value={form.fullName} onChange={set("fullName")} placeholder="นายไมตรี นาโพธิ์" />
        </label>

        <label className="field">
          <span className="field__label">รหัสอาจารย์</span>
          <input className="input" value={form.code} onChange={set("code")} placeholder="maitri" />
          <span className="field__hint">ใช้เป็นรหัสอ้างอิง ห้ามซ้ำ</span>
        </label>

        <label className="field">
          <span className="field__label">แผนกวิชา</span>
          <input className="input" value={form.department} onChange={set("department")} placeholder="เทคโนโลยีสารสนเทศ" />
        </label>
      </div>

      {error && <p className="alert alert--error">{error}</p>}

      <div className="button-row">
        <button className="admin-button" type="submit" disabled={busy || !form.code.trim() || !form.fullName.trim()}>
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button className="admin-button admin-button--ghost" type="button" onClick={onCancel} disabled={busy}>
          ยกเลิก
        </button>
      </div>
    </form>
  );
}

/**
 * The console's home: every teacher, what state their schedule is in, and the
 * two things most likely to be wanted next — opening one, or adding another.
 */
export default function TeacherList({ teachers, loading, onOpen, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Deletion is two requests on purpose. The first is refused and answers
   * with what would be lost, which is what the dialog then shows; only the
   * second actually deletes.
   */
  async function askToDelete(teacher) {
    setError(null);
    try {
      await api.admin.deleteTeacher(teacher.id);
      onChanged();
    } catch (err) {
      if (err.code === "DELETE_NEEDS_CONFIRM") {
        setConfirming({ teacher, message: err.message });
        return;
      }
      setError(err.message);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await api.admin.deleteTeacher(confirming.teacher.id, { confirm: true });
      setConfirming(null);
      onChanged();
    } catch (err) {
      setError(err.message);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel">
        <div className="panel__head">
          <div>
            <h2 className="panel__title">อาจารย์ทั้งหมด</h2>
            <p className="panel__subtitle">
              {loading ? "กำลังโหลด…" : `${teachers.length} คน`}
            </p>
          </div>
          {!adding && (
            <button className="admin-button" onClick={() => setAdding(true)}>
              + เพิ่มอาจารย์
            </button>
          )}
        </div>

        {adding && (
          <NewTeacherForm
            onCancel={() => setAdding(false)}
            onCreated={() => {
              setAdding(false);
              onChanged();
            }}
          />
        )}

        {error && <p className="alert alert--error">{error}</p>}

        {!loading && teachers.length === 0 && !adding && (
          <p className="empty-note">
            ยังไม่มีอาจารย์ในระบบ — กด “เพิ่มอาจารย์” เพื่อเริ่มต้น
            หรือย้ายข้อมูลเดิมเข้ามาด้วย <code className="admin-code">node scripts/migrate-schedule-json.js</code>
          </p>
        )}

        <ul className="card-list">
          {teachers.map((teacher) => (
            <li key={teacher.id} className="teacher-card">
              <button className="teacher-card__main" onClick={() => onOpen(teacher)}>
                <span className="teacher-card__name">{teacher.fullName}</span>
                <span className="teacher-card__meta">
                  {[teacher.department, `รหัส ${teacher.code}`].filter(Boolean).join(" · ")}
                </span>
              </button>

              <div className="teacher-card__actions">
                <button className="admin-button admin-button--small" onClick={() => onOpen(teacher)}>
                  จัดการตารางสอน
                </button>
                <button
                  className="admin-button admin-button--small admin-button--danger-ghost"
                  onClick={() => askToDelete(teacher)}
                  title="ลบอาจารย์และข้อมูลทั้งหมด"
                >
                  ลบ
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <ConfirmDialog
        open={Boolean(confirming)}
        danger
        busy={busy}
        title="ลบอาจารย์"
        message={confirming?.message || ""}
        detail="การลบนี้กู้คืนไม่ได้"
        confirmLabel="ลบถาวร"
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}
