export default function MessageBubble({ role, text }) {
  const isUser = role === "user";
  return (
    <div className={`bubble-row ${isUser ? "bubble-row--user" : ""}`}>
      <div className={`bubble ${isUser ? "bubble--user" : "bubble--bot"}`}>
        {text}
      </div>
    </div>
  );
}
