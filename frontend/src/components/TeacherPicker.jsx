import { useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * The chatbot answers about exactly one teacher, so one has to be chosen
 * before any question can be asked. The list comes from the backend and holds
 * only teachers with a published schedule, so every option here can actually
 * be answered about.
 */
export default function TeacherPicker({ onSelect }) {
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    api
      .listTeachers()
      .then((data) => {
        if (!cancelled) setTeachers(data.teachers || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="picker-card">
        <p className="picker-status">กำลังโหลดรายชื่ออาจารย์…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="picker-card">
        <h1 className="picker-title">เลือกอาจารย์</h1>
        <p className="picker-status picker-status--error">{error}</p>
      </div>
    );
  }

  if (teachers.length === 0) {
    return (
      <div className="picker-card">
        <h1 className="picker-title">เลือกอาจารย์</h1>
        <p className="picker-status">
          ยังไม่มีอาจารย์ที่มีตารางสอนเผยแพร่แล้ว ผู้ดูแลระบบต้องอัปโหลดและตรวจสอบตารางสอนก่อน
        </p>
      </div>
    );
  }

  return (
    <div className="picker-card">
      <h1 className="picker-title">เลือกอาจารย์</h1>
      <p className="picker-subtitle">เลือกอาจารย์ที่ต้องการสอบถามตารางสอน</p>

      <ul className="teacher-list">
        {teachers.map((teacher) => (
          <li key={teacher.id}>
            <button className="teacher-button" onClick={() => onSelect(teacher)}>
              <span className="teacher-button__name">{teacher.fullName}</span>
              {teacher.department && (
                <span className="teacher-button__meta">{teacher.department}</span>
              )}
              {teacher.terms?.length > 0 && (
                <span className="teacher-button__meta">
                  ภาคเรียน {teacher.terms.map((t) => t.label).join(", ")}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
