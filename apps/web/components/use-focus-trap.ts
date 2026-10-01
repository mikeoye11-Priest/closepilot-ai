"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const containTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((control) => control.getClientRects().length > 0);
      if (!controls.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", containTab);
    return () => document.removeEventListener("keydown", containTab);
  }, [active, containerRef]);
}
