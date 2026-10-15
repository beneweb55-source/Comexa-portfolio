"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tooltipMotion } from "./motion";

/*
 * Infobulle accessible et sobre, montée dans un portail pour ne jamais être
 * rognée par la coque (qui masque ses débordements).
 *
 * - affichée au survol ET au focus clavier (donc utile au clavier et aux lecteurs
 *   d'écran), jamais uniquement à la souris ;
 * - `role="tooltip"` relié au déclencheur par `aria-describedby` ;
 * - fade + translateY 150 ms, sans transformation en `prefers-reduced-motion`.
 */

const ANCHOR_STYLE = { position: "relative", display: "inline-flex" };

export default function Tooltip({ label, children, placement = "top", gap = 10 }) {
  const id = useId();
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);

  const measure = useCallback(() => {
    const node = anchorRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const middleX = rect.left + rect.width / 2;
    const middleY = rect.top + rect.height / 2;
    const positions = {
      top: { left: middleX, top: rect.top - gap, transform: "translate(-50%, -100%)" },
      bottom: { left: middleX, top: rect.bottom + gap, transform: "translate(-50%, 0)" },
      left: { left: rect.left - gap, top: middleY, transform: "translate(-100%, -50%)" },
      right: { left: rect.right + gap, top: middleY, transform: "translate(0, -50%)" },
    };
    const value = positions[placement] ?? positions.top;
    setCoords({ left: Math.round(value.left), top: Math.round(value.top), transform: value.transform });
  }, [gap, placement]);

  useEffect(() => {
    if (!open) return undefined;
    const refresh = () => measure();
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    return () => {
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
    };
  }, [measure, open]);

  if (!label) return children;

  return (
    <span
      ref={anchorRef}
      style={ANCHOR_STYLE}
      onPointerEnter={() => {
        measure();
        setOpen(true);
      }}
      onPointerLeave={() => setOpen(false)}
      onFocusCapture={() => {
        measure();
        setOpen(true);
      }}
      onBlurCapture={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined} style={{ display: "contents" }}>
        {children}
      </span>
      {open && coords && typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              <motion.span id={id} role="tooltip" className="sui-tip" style={coords} {...tooltipMotion}>
                {label}
              </motion.span>
            </AnimatePresence>,
            document.body,
          )
        : null}
    </span>
  );
}
