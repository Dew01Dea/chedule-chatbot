import { useCallback, useEffect, useState } from "react";
import { api, getAdminToken, setAdminToken } from "../api.js";
import TeacherList from "../components/admin/TeacherList.jsx";
import TeacherDetail from "../components/admin/TeacherDetail.jsx";
import ScheduleReview from "../components/admin/ScheduleReview.jsx";

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
    <div className="panel panel--narrow">
      <h1 className="panel__title">เข้าสู่ระบบผู้ดูแล</h1>
      <p className="panel__subtitle">
        กรอกโทเคนที่ตั้งไว้ใน ADMIN_TOKENS ฝั่งเซิร์ฟเวอร์ — เก็บไว้เฉพาะในแท็บนี้เท่านั้น
      </p>

      <form onSubmit={submit} className="button-row button-row--stack">
        <input
          className="input"
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

      {error && <p className="alert alert--error">{error}</p>}
    </div>
  );
}

/**
 * One view at a time rather than everything stacked on one page. The three
 * views mirror how the work actually goes: pick a teacher, manage their
 * schedules, then review one of them in detail.
 */
export default function AdminPanel() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(getAdminToken()));
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState({ name: "teachers" });

  const loadTeachers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.listTeachers();
      setTeachers(data.teachers || []);
      setError(null);
    } catch (err) {
      setError(err.message);
      if (err.status === 401 || err.status === 403) setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) loadTeachers();
  }, [authenticated, loadTeachers]);

  if (!authenticated) {
    return <TokenGate onAuthenticated={() => setAuthenticated(true)} />;
  }

  // Kept in sync with the list, so an edit made in the detail view shows
  // without navigating away and back.
  const openTeacher =
    view.name !== "teachers" ? teachers.find((t) => t.id === view.teacherId) : null;

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div>
          <h1 className="admin-title">ระบบจัดการตารางสอน</h1>
          <p className="panel__subtitle">สำหรับผู้ดูแลระบบ</p>
        </div>
        <div className="button-row">
          <a className="admin-button admin-button--ghost" href="#">หน้าแชท</a>
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

      {error && <p className="alert alert--error">{error}</p>}

      {view.name === "teachers" && (
        <TeacherList
          teachers={teachers}
          loading={loading}
          onOpen={(teacher) => setView({ name: "teacher", teacherId: teacher.id })}
          onChanged={loadTeachers}
        />
      )}

      {view.name === "teacher" && openTeacher && (
        <TeacherDetail
          teacher={openTeacher}
          onBack={() => setView({ name: "teachers" })}
          onReview={(scheduleId) =>
            setView({ name: "review", teacherId: openTeacher.id, scheduleId })
          }
          onTeacherChanged={loadTeachers}
        />
      )}

      {view.name === "review" && (
        <ScheduleReview
          scheduleId={view.scheduleId}
          onBack={() => setView({ name: "teacher", teacherId: view.teacherId })}
          onChanged={loadTeachers}
        />
      )}

      {/* The teacher this view was opened for has since been deleted. */}
      {view.name !== "teachers" && !openTeacher && view.name === "teacher" && (
        <p className="empty-note">
          ไม่พบอาจารย์ท่านนี้แล้ว{" "}
          <button className="link-button" onClick={() => setView({ name: "teachers" })}>
            กลับไปรายชื่อ
          </button>
        </p>
      )}
    </div>
  );
}
