import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import StatusPill from "./StatusPill.jsx";
import UploadForm from "./UploadForm.jsx";

function TeacherFields({ teacher, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(teacher);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => setForm(teacher), [teacher]);

  const set = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.admin.updateTeacher(teacher.id, {
        fullName: form.fullName,
        nickname: form.nickname,
        department: form.department,
        education: form.education,
        duty: form.duty,
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="panel">
        <div className="panel__head">
          <div>
            <h2 className="panel__title">{teacher.fullName}</h2>
            <p className="panel__subtitle">
              {[teacher.department, teacher.nickname && `ชื่อเล่น ${teacher.nickname}`, `รหัส ${teacher.code}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <button className="admin-button admin-button--ghost" onClick={() => setEditing(true)}>
            แก้ไขข้อมูล
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2 className="panel__title">แก้ไขข้อมูลอาจารย์</h2>

      <div className="field-grid">
        <label className="field">
          <span className="field__label">ชื่อ-นามสกุล</span>
          <input className="input" value={form.fullName || ""} onChange={set("fullName")} />
        </label>
        <label className="field">
          <span className="field__label">ชื่อเล่น</span>
          <input className="input" value={form.nickname || ""} onChange={set("nickname")} />
        </label>
        <label className="field">
          <span className="field__label">แผนกวิชา</span>
          <input className="input" value={form.department || ""} onChange={set("department")} />
        </label>
        <label className="field">
          <span className="field__label">วุฒิการศึกษา</span>
          <input className="input" value={form.education || ""} onChange={set("education")} />
        </label>
        <label className="field field--wide">
          <span className="field__label">หน้าที่พิเศษ</span>
          <input className="input" value={form.duty || ""} onChange={set("duty")} />
        </label>
      </div>

      {error && <p className="alert alert--error">{error}</p>}

      <div className="button-row">
        <button className="admin-button" onClick={save} disabled={busy || !form.fullName?.trim()}>
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button
          className="admin-button admin-button--ghost"
          onClick={() => {
            setForm(teacher);
            setEditing(false);
          }}
          disabled={busy}
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

/**
 * Everything about one teacher in one place: who they are, every version of
 * their timetable with what can be done to each, and the upload that adds
 * another.
 */
export default function TeacherDetail({ teacher, onBack, onReview, onTeacherChanged }) {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.listSchedules(teacher.id);
      setSchedules(data.schedules || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [teacher.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirming(null);
      await load();
      onTeacherChanged();
    } catch (err) {
      setError(err.detail ? `${err.message} (${err.detail})` : err.message);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  async function askDeleteSchedule(schedule) {
    setError(null);
    try {
      await api.admin.deleteSchedule(schedule.id);
      setNotice("ลบตารางสอนเรียบร้อยแล้ว");
      await load();
      onTeacherChanged();
    } catch (err) {
      if (err.code === "PUBLISHED_DELETE_NEEDS_CONFIRM") {
        setConfirming({
          title: "ลบตารางสอนที่กำลังเผยแพร่",
          message: err.message,
          detail: "ถ้าต้องการแค่หยุดให้ Chatbot ตอบ แนะนำให้ใช้ “หยุดเผยแพร่” ซึ่งเก็บข้อมูลไว้",
          confirmLabel: "ลบถาวร",
          run: () => api.admin.deleteSchedule(schedule.id, { confirmPublished: true }),
        });
        return;
      }
      setError(err.message);
    }
  }

  return (
    <>
      <button className="back-link" onClick={onBack}>
        ← กลับไปรายชื่ออาจารย์
      </button>

      <TeacherFields teacher={teacher} onSaved={onTeacherChanged} />

      <div className="panel">
        <div className="panel__head">
          <div>
            <h2 className="panel__title">ตารางสอน</h2>
            <p className="panel__subtitle">
              {loading ? "กำลังโหลด…" : `${schedules.length} ชุด`}
            </p>
          </div>
        </div>

        {notice && <p className="alert alert--ok">{notice}</p>}
        {error && <p className="alert alert--error">{error}</p>}

        {!loading && schedules.length === 0 && (
          <p className="empty-note">ยังไม่มีตารางสอน — อัปโหลดไฟล์ PDF ด้านล่างเพื่อเริ่มต้น</p>
        )}

        <ul className="card-list">
          {schedules.map((schedule) => (
            <li key={schedule.id} className="schedule-card">
              <div className="schedule-card__info">
                <span className="schedule-card__term">
                  ภาคเรียน {schedule.semester}/{schedule.academicYear}
                </span>
                <StatusPill status={schedule.status} />
                <span className="schedule-card__meta">
                  เวอร์ชัน {schedule.version}
                  {schedule.reviewedBy ? ` · ตรวจโดย ${schedule.reviewedBy}` : ""}
                </span>
              </div>

              <div className="schedule-card__actions">
                <button className="admin-button admin-button--small" onClick={() => onReview(schedule.id)}>
                  ตรวจสอบ / แก้ไข
                </button>

                {schedule.status === "published" && (
                  <button
                    className="admin-button admin-button--small admin-button--ghost"
                    onClick={() =>
                      setConfirming({
                        title: "หยุดเผยแพร่",
                        message: "Chatbot จะไม่ตอบคำถามเกี่ยวกับตารางสอนชุดนี้อีก",
                        detail: "ข้อมูลยังเก็บไว้ครบ และเผยแพร่ใหม่ได้ภายหลัง",
                        confirmLabel: "หยุดเผยแพร่",
                        run: () => api.admin.unpublish(schedule.id),
                      })
                    }
                  >
                    หยุดเผยแพร่
                  </button>
                )}

                <button
                  className="admin-button admin-button--small admin-button--danger-ghost"
                  onClick={() => askDeleteSchedule(schedule)}
                >
                  ลบ
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <UploadForm teacher={teacher} onUploaded={load} />

      <ConfirmDialog
        open={Boolean(confirming)}
        danger={confirming?.confirmLabel === "ลบถาวร"}
        busy={busy}
        title={confirming?.title || ""}
        message={confirming?.message || ""}
        detail={confirming?.detail}
        confirmLabel={confirming?.confirmLabel}
        onConfirm={() => act(confirming.run)}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}
