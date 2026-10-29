"use client";

/*
 * Système de mouvement partagé — Comexa Portfolio.
 *
 * Toutes les durées proviennent des tokens CSS (`--dur-*`) et sont reprises ici
 * en secondes pour Framer Motion. Le miroir JS reste une source de secours
 * quand un composant lit directement les variantes.
 *
 * Règles :
 *  - prefers-reduced-motion : MotionConfig réduit les mouvements, seuls les
 *    fondus d'opacité et les changements d'état sont conservés.
 *  - transform + opacity uniquement (propriétés performantes).
 *  - Aucun rebond, aucune rotation décorative, aucun flottement permanent.
 *  - AnimatePresence est obligatoire pour toute variante avec `exit`.
 */

import { MotionConfig, motion, useReducedMotion } from "framer-motion";

export { motion, useReducedMotion };

/** Cadences en secondes (Framer Motion). Calées sur les tokens CSS. */
export const MOTION = {
  fast: 0.14,      // --dur-fast : 140 ms
  base: 0.22,      // --dur-base : 220 ms
  slow: 0.30,      // --dur-slow : 300 ms
  stagger: 0.04,   // 40 ms entre deux enfants d'une liste
  easeOut: [0.16, 1, 0.3, 1],
};

export function SoftMotionProvider({ children }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Hook : true si le système demande une réduction des mouvements. */
export function usePrefersReducedMotion() {
  return useReducedMotion();
}

/* ------------------------------------------------------------------ */
/* Variantes de page                                                  */
/* ------------------------------------------------------------------ */

/** Conteneur de page : fondu + léger glissement vertical à l'entrée. */
export const pageVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: MOTION.base, ease: MOTION.easeOut },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: MOTION.fast, ease: MOTION.easeOut },
  },
};

/** Enfant d'une page (titre, sections) : apparition échelonnée. */
export const pageChildVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: MOTION.fast, ease: MOTION.easeOut },
  },
};

/** Wrapper de transition de route : à utiliser avec AnimatePresence. */
export const pageTransition = {
  initial: "hidden",
  animate: "visible",
  exit: "exit",
  variants: pageVariants,
};

/* ------------------------------------------------------------------ */
/* Variantes de liste / grille                                        */
/* ------------------------------------------------------------------ */

/** Conteneur de liste : apparition échelonnée des enfants. */
export const staggerParent = {
  hidden: {},
  visible: {
    transition: { staggerChildren: MOTION.stagger, delayChildren: 0.02 },
  },
};

/** Élément de liste : fondu + léger glissement vertical. */
export const staggerItem = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: MOTION.base, ease: MOTION.easeOut },
  },
};

/* ------------------------------------------------------------------ */
/* Variantes de tirour / panneau latéral                              */
/* ------------------------------------------------------------------ */

/** Tiroir latéral (droite) : glissement horizontal. */
export const drawerVariants = {
  hidden: { x: "100%", opacity: 0 },
  visible: {
    x: 0,
    opacity: 1,
    transition: { duration: MOTION.slow, ease: MOTION.easeOut },
  },
  exit: {
    x: "100%",
    opacity: 0,
    transition: { duration: MOTION.fast, ease: MOTION.easeOut },
  },
};

/** Voile de fond du tiroir / dialog. */
export const backdropVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: MOTION.fast, ease: MOTION.easeOut },
  },
  exit: {
    opacity: 0,
    transition: { duration: MOTION.fast, ease: MOTION.easeOut },
  },
};

/* ------------------------------------------------------------------ */
/* Variantes de dialog / modale                                       */
/* ------------------------------------------------------------------ */

/** Dialog : apparition avec légère montée. */
export const dialogVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: MOTION.base, ease: MOTION.easeOut },
  },
  exit: {
    opacity: 0,
    y: 8,
    scale: 0.98,
    transition: { duration: MOTION.fast, ease: MOTION.easeOut },
  },
};

/* ------------------------------------------------------------------ */
/* Micro-interactions                                                 */
/* ------------------------------------------------------------------ */

/** Survol d'une carte ou d'un élément interactif. */
export const cardHover = {
  y: -4,
  transition: { duration: MOTION.fast, ease: MOTION.easeOut },
};

export const cardRest = {
  y: 0,
  transition: { duration: MOTION.base, ease: MOTION.easeOut },
};

/** État « occupé » d'un bouton ou d'une ligne d'action. */
export const busyVariants = {
  idle: { opacity: 1, scale: 1 },
  busy: {
    opacity: 0.6,
    scale: 0.98,
    transition: { duration: MOTION.fast, ease: MOTION.easeOut },
  },
};

/** Infobulle : fondu + translateY, jamais de rebond. */
export const tooltipMotion = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: MOTION.fast, ease: MOTION.easeOut } },
  exit: { opacity: 0, y: 4, transition: { duration: MOTION.fast, ease: MOTION.easeOut } },
};

/** Transitions de layoutId (pilule de navigation, onglet segmenté). */
export const layoutSpring = { type: "spring", stiffness: 480, damping: 38, mass: 0.7 };
export const layoutSoft = { duration: MOTION.base, ease: MOTION.easeOut };

/* ------------------------------------------------------------------ */
/* Squelettes                                                         */
/* ------------------------------------------------------------------ */

/** Pulsation d'un skeleton (opacité). */
export const skeletonPulse = {
  hidden: { opacity: 0.4 },
  visible: {
    opacity: 1,
    transition: { duration: 1.4, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" },
  },
};

/** Initial / animate pour un skeleton qui pulse immédiatement. */
export const skeletonAnimation = {
  initial: "hidden",
  animate: "visible",
  variants: skeletonPulse,
};
