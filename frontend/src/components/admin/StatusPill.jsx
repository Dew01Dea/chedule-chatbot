export const STATUS_LABELS = {
  draft: "ฉบับร่าง",
  needs_review: "รอตรวจสอบ",
  published: "เผยแพร่อยู่",
  archived: "เก็บถาวร",
};

export default function StatusPill({ status }) {
  return (
    <span className={`status-pill status-pill--${status}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}
