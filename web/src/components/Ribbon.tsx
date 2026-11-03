import { useEffect, useRef, type ReactNode } from "react";

const SPEED_PX_PER_S = 28;
const RESUME_AFTER_MS = 2500;

/**
 * Horizontal strip that drifts on its own, can be scrolled by hand, and resumes drifting once the
 * user has been idle for RESUME_AFTER_MS. Content is rendered twice so the loop has no seam.
 * Position lives in a ref and is written straight to scrollLeft: no React state per frame.
 */
export function Ribbon({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let pos = el.scrollLeft;
    let lastWritten = pos;
    let lastInteraction = -Infinity;
    let pointerDown = false;
    let last = performance.now();
    let frame = 0;

    const touch = () => {
      lastInteraction = performance.now();
    };
    const onDown = () => {
      pointerDown = true;
      touch();
    };
    const onUp = () => {
      pointerDown = false;
      touch();
    };
    // A scroll we did not write (finger, wheel, momentum) counts as the user and resets the timer.
    const onScroll = () => {
      if (Math.abs(el.scrollLeft - lastWritten) > 1.5) {
        pos = el.scrollLeft;
        lastWritten = pos;
        touch();
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      const half = el.scrollWidth / 2;
      const idle = !pointerDown && now - lastInteraction > RESUME_AFTER_MS;
      if (idle) pos += SPEED_PX_PER_S * dt;
      if (half > 0) {
        if (pos >= half) pos -= half;
        else if (pos < 0) pos += half;
      }
      if (idle || Math.abs(el.scrollLeft - pos) > 1.5) {
        el.scrollLeft = pos;
        lastWritten = el.scrollLeft;
      }
      frame = requestAnimationFrame(tick);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("wheel", touch, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("wheel", touch);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const row = { display: "flex", gap: "var(--space-2)", paddingRight: "var(--space-2)", flex: "none" } as const;
  return (
    <div
      ref={ref}
      style={{
        display: "flex",
        overflowX: "auto",
        scrollbarWidth: "none",
        // Soft edges so items fade at the page padding instead of being cut off
        maskImage: "linear-gradient(90deg, transparent, #000 20px, #000 calc(100% - 20px), transparent)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 20px, #000 calc(100% - 20px), transparent)",
      }}
    >
      <div style={row}>{children}</div>
      <div style={row} aria-hidden="true">
        {children}
      </div>
    </div>
  );
}
