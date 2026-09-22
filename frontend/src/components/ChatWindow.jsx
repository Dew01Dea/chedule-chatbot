import { useEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble.jsx";

const SUGGESTED = [
  "วันจันทร์มีสอนกี่คาบ",
  "สอนวิชาอะไรบ้าง",
  "วันศุกร์ตอนบ่ายว่างไหม",
  "ห้อง COM603 ใช้วันไหนบ้าง",
];

export default function ChatWindow() {
  const [messages, setMessages] = useState([
    {
      role: "bot",
      text: "สวัสดีครับ ผมช่วยตอบคำถามเกี่ยวกับตารางสอนของครูไมตรีได้ ลองถามได้เลย เช่น \"วันพุธมีคาบเรียนอะไรบ้าง\"",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

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
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = await res.json();
      const replyText = res.ok ? data.reply : data.error || "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
      setMessages((prev) => [...prev, { role: "bot", text: replyText }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่า backend กำลังทำงานอยู่" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-card">
      <header className="chat-header">
        <div className="chat-header__title">ตารางสอน · ครูไมตรี นาโพธิ์</div>
        <div className="chat-header__subtitle">เทคโนโลยีสารสนเทศ · วิทยาลัยเทคนิคสัตหีบ · ภาคเรียน 1/2569</div>
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
        {SUGGESTED.map((s) => (
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
