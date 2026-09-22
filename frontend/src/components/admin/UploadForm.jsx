import { useState } from "react";
import { api } from "../../api.js";

// Mirrors the limit multer enforces on the server.
const MAX_PDF_BYTES = 15 * 1024 * 1024;

export default function UploadForm({ teacher, onUploaded }) {
  const currentBuddhistYear = new Date().getFullYear() + 543;

  const [academicYear, setAcademicYear] = useState(currentBuddhistYear);
  const [semester, setSemester] = useState(1);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const tooBig = file && file.size > MAX_PDF_BYTES;

  async function submit(event) {
    event.preventDefault();
    if (!file || tooBig) return;

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const data = await api.admin.upload({ file, teacherId: teacher.id, academicYear, semester });
      setResult(data);
      setFile(null);
      event.target.reset();
      onUploaded();
    } catch (err) {
      setError(err.detail ? `${err.message}\n\n[${err.code}] ${err.detail}` : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">อัปโหลดตารางสอนใหม่</h2>
          <p className="panel__subtitle">
            ระบบจะอ่านด้วย OCR แล้วเก็บเป็นฉบับร่าง — ตารางที่ใช้งานอยู่จะไม่เปลี่ยนจนกว่าจะกดเผยแพร่
          </p>
        </div>
      </div>

      <div className="field-grid">
        <label className="field">
          <span className="field__label">ปีการศึกษา (พ.ศ.)</span>
          <input
            className="input"
            type="number"
            value={academicYear}
            onChange={(e) => setAcademicYear(Number(e.target.value))}
          />
        </label>

        <label className="field">
          <span className="field__label">ภาคเรียน</span>
          <select className="input" value={semester} onChange={(e) => setSemester(Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>

        <label className="field field--wide">
          <span className="field__label">ไฟล์ PDF ตารางสอน</span>
          <input
            className="input"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <span className="field__hint">
            {tooBig
              ? `ไฟล์ใหญ่ ${(file.size / 1024 / 1024).toFixed(1)}MB เกินขีดจำกัด 15MB`
              : "ขนาดไม่เกิน 15MB"}
          </span>
        </label>
      </div>

      {error && <p className="alert alert--error">{error}</p>}

      {result && (
        <div className="alert alert--info">
          <strong>{result.message}</strong>
          <div className="result-counts">
            <span>ข้อผิดพลาด {result.validation.errorCount}</span>
            <span>คำเตือน {result.validation.warningCount}</span>
            <span>แก้อัตโนมัติ {result.validation.autoFixCount}</span>
          </div>
          <span className="alert__hint">กด “ตรวจสอบ” ที่รายการด้านล่างเพื่อดูและแก้ไขก่อนเผยแพร่</span>
        </div>
      )}

      <div className="button-row">
        <button className="admin-button" type="submit" disabled={busy || !file || tooBig}>
          {busy ? "กำลังอ่านเอกสาร… (อาจใช้เวลา 1-2 นาที)" : "อัปโหลดและอ่านข้อมูล"}
        </button>
      </div>
    </form>
  );
}
