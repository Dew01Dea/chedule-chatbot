import { useEffect, useRef } from "react";

/**
 * Confirmation for actions that cannot be undone.
 *
 * Deliberately not window.confirm: these actions need to say what will be
 * lost — how many schedules, whether one of them is live — and a browser
 * dialog cannot show that. `danger` marks the destructive variant so the
 * confirming button does not look like an ordinary save.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  detail,
  confirmLabel = "ยืนยัน",
  cancelLabel = "ยกเลิก",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);

  // Focus the safe option, so a stray Enter does not confirm a deletion.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onClick={() => !busy && onCancel()}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="dialog__title" id="dialog-title">
          {title}
        </h2>
        <p className="dialog__message">{message}</p>
        {detail && <p className="dialog__detail">{detail}</p>}

        <div className="dialog__actions">
          <button className="admin-button admin-button--ghost" ref={cancelRef} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={`admin-button ${danger ? "admin-button--danger" : ""}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "กำลังดำเนินการ…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
