import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

export const MOBILE_NAV = "(max-width: 899px)";
const RAIL_KEY = "freightlytics-sidebar";
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function useMedia(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", notify);
    return () => list.removeEventListener("change", notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

export function useRail(): [boolean, () => void] {
  const [railed, setRailed] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === "rail";
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setRailed((current) => {
      const next = !current;
      try {
        localStorage.setItem(RAIL_KEY, next ? "rail" : "open");
      } catch {
        // Private mode: the choice lasts for this page only.
      }
      return next;
    });
  }, []);
  return [railed, toggle];
}

export function useDrawer(
  open: boolean,
  onClose: () => void,
  panel: RefObject<HTMLElement | null>,
  opener: RefObject<HTMLElement | null>,
) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const node = panel.current;
    if (!open || !node) return;
    const returnTo = opener.current;
    const focusable = () => [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.getClientRects().length > 0);
    (node.querySelector<HTMLElement>("[aria-current='page']") ?? focusable()[0])?.focus({ preventScroll: true });

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!node.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    let startX = 0;
    let startY = 0;
    let tracking = false;
    function onStart(event: TouchEvent) {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) return;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    }
    function onEnd(event: TouchEvent) {
      const touch = event.changedTouches[0];
      if (!tracking || !touch) return;
      tracking = false;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (dx < -56 && Math.abs(dx) > Math.abs(dy) * 1.4) close.current();
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
      document.body.style.overflow = overflow;
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [open, panel, opener]);
}
