"use client";
// React wiring for the transitions.dev snippets in app/motion.css. Each one follows the snippet's documented
// class sequence; timings are read from the CSS variables so the CSS stays the single source.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const cssMs = (name: string, fallback: number) => {
  if (typeof window === "undefined") return fallback;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
};
const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 04 Text states swap: the old label exits up with blur, the new one enters from below. */
export function SwapText({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);
  const entering = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (text === shown) {
      el?.classList.remove("is-exit");
      return;
    }
    if (!el || reducedMotion()) {
      setShown(text);
      return;
    }
    el.classList.add("is-exit");
    const timer = setTimeout(
      () => {
        el.classList.remove("is-exit");
        el.classList.add("is-enter-start");
        entering.current = true;
        setShown(text);
      },
      cssMs("--text-swap-dur", 150),
    );
    return () => clearTimeout(timer);
  }, [text, shown]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !entering.current) return;
    entering.current = false;
    void el.offsetHeight; // reflow so removing .is-enter-start transitions
    el.classList.remove("is-enter-start");
  }, [shown]);

  return (
    <span ref={ref} className={`t-text-swap ${className}`}>
      {shown}
    </span>
  );
}

/**
 * 12 Error state shake, without the auto-revert: a parse error stays until the owner edits the field.
 * Put the returned ref on the element that owns the border (with class `t-input`); call `shake()` on a
 * failed submit. The error class and message are driven by React state in the caller.
 */
export function useShake<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const shake = useCallback(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    el.classList.remove("is-shaking");
    void el.offsetWidth;
    el.classList.add("is-shaking");
    const total = cssMs("--shake-dur-a", 80) * 2 + cssMs("--shake-dur-b", 60) * 2;
    setTimeout(() => el.classList.remove("is-shaking"), total + 20);
  }, []);
  return [ref, shake] as const;
}

/**
 * 14 Skeleton loader and reveal. While `loading`, the skeleton covers the slot and pulses; when it stops and
 * `ready` is true, both layers cross-fade. `instant` skips the cross-fade (a keyboard-run check: no motion
 * on keyboard actions). A new run snaps back to the skeleton without animating the reverse.
 */
export function Reveal({
  loading,
  ready,
  instant,
  skeleton,
  children,
  minHeight = 320,
}: {
  loading: boolean;
  ready: boolean;
  instant: boolean;
  skeleton: ReactNode;
  children: ReactNode;
  minHeight?: number;
}) {
  const [resetting, setResetting] = useState(false);
  const revealed = ready && !loading;

  // Entering the loading state: snap to the skeleton (is-resetting), then allow transitions again.
  useLayoutEffect(() => {
    if (!loading) return;
    setResetting(true);
    const frame = requestAnimationFrame(() => setResetting(false));
    return () => cancelAnimationFrame(frame);
  }, [loading]);

  return (
    <div
      className={`t-skel check-reveal ${revealed ? "is-revealed" : ""} ${resetting || instant ? "is-resetting" : ""}`}
      style={revealed ? undefined : { minHeight }}
    >
      <div className="t-skel-skeleton is-pulsing" aria-hidden="true">
        {skeleton}
      </div>
      <div className="t-skel-content" inert={!revealed}>
        {children}
      </div>
    </div>
  );
}
