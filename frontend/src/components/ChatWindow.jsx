import { useEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble.jsx";
import { api } from "../api.js";

// The old chips named a specific room from one teacher's timetable, which
// would be wrong for everyone else. These are phrased to fit any schedule.
const SUGGESTIONS = [
  "วันจันทร์มีสอนกี่คาบ",
  "สอนวิชาอะไรบ้าง",
  "วันศุกร์ตอนบ่ายว่างไหม",
  "ตอนนี้สอนอะไรอยู่",
];

export default function ChatWindow({ teacher, onChangeTeacher }) {
  const [messages, setMessages] = useState(() => [
    {
      role: "bot",
      text: `สวัสดีครับ ผมช่วยตอบคำถามเกี่ยวกับตารางสอนของ${teacher.fullName}ได้ ลองถามได้เลย เช่น "วันพุธมีคาบเรียนอะไรบ้าง"`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  // A term is only offered when the teacher actually has more than one.
  const terms = teacher.terms || [];
  const [selectedTerm, setSelectedTerm] = useState(terms[0] || null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const data = await api.ask({
        message: trimmed,
        teacherId: teacher.id,
        academicYear: selectedTerm?.academicYear,
        semester: selectedTerm?.semester,
      });
      setMessages((prev) => [...prev, { role: "bot", text: data.reply }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "bot", text: err.message }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-card">
      <header className="chat-header">
        <div className="chat-header__row">
          <div>
            <div className="chat-header__title">ตารางสอน · {teacher.fullName}</div>
            <div className="chat-header__subtitle">
              {[teacher.department, selectedTerm && `ภาคเรียน ${selectedTerm.label}`]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <button className="chat-header__switch" onClick={onChangeTeacher}>
            เปลี่ยนอาจารย์
          </button>
        </div>

        {terms.length > 1 && (
          <select
            className="chat-header__term"
            value={selectedTerm?.label || ""}
            onChange={(e) => setSelectedTerm(terms.find((t) => t.label === e.target.value) || null)}
          >
            {terms.map((term) => (
              <option key={term.label} value={term.label}>
                ภาคเรียน {term.label}
              </option>
            ))}
          </select>
        )}
      </header>

      <div className="chat-messages" ref={scrollRef}>
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} text={m.text} />
        ))}
        {loading && (
          <div className="bubble-row">
            <div className="bubble bubble--bot bubble--typing">กำลังพิมพ์…</div>
          </div>
        )}
      </div>

      <div className="chat-suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="suggestion-chip" onClick={() => sendMessage(s)} disabled={loading}>
            {s}
          </button>
        ))}
      </div>

      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
      >
        <input
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="พิมพ์คำถามเกี่ยวกับตารางสอน..."
          disabled={loading}
        />
        <button className="chat-send" type="submit" disabled={loading || !input.trim()}>
          ส่ง
        </button>
      </form>
    </div>
  );
}
