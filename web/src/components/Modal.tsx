import { useRef, useState, type ReactNode } from "react";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;
    if (dx > 0 && Math.abs(dy) < Math.abs(dx)) {
      setDragging(true);
      setDragX(dx);
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    setDragging(false);
    setDragX(0);
    if (!touchStart.current) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    touchStart.current = null;
    // Left-to-right swipe closes the popup.
    if (dx > 60 && Math.abs(dy) < 50) onClose();
  };

  return (
    <div
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-4)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          maxHeight: "80vh",
          overflowY: "auto",
          background: "var(--bg-elevated-2)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-card)",
          padding: "var(--space-5)",
          transform: dragX > 0 ? `translateX(${dragX}px)` : undefined,
          opacity: dragX > 0 ? Math.max(0.4, 1 - dragX / 400) : undefined,
          transition: dragging ? "none" : "transform 200ms ease-out, opacity 200ms ease-out",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-4)" }}>
          <h2 style={{ fontSize: 20 }}>{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "var(--bg-elevated-1)",
              border: "none",
              borderRadius: "50%",
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
