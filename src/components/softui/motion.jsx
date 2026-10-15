"use client";

/*
 * Mouvement partagé du design system.
 *
 * Toutes les animations du dashboard passent par ces variantes : 150–300 ms,
 * ease-out, apparition échelonnée de 40 ms, survol à -4 px. `MotionConfig`
 * `reducedMotion="user"` retire les transformations (et les transitions de
 * `layoutId`) quand le système demande moins de mouvement : il ne reste que
 * les fondus. Les composants n'ont donc rien à gérer eux-mêmes.
 */

import { MotionConfig, motion, useReducedMotion } from "framer-motion";
import { MOTION } from "./tokens";

export { motion, useReducedMotion };

export function SoftMotionProvider({ children }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Conteneur d'une grille : apparition échelonnée (40 ms) des enfants. */
export const staggerParent = {
  hidden: {},
  visible: {
    transition: { staggerChildren: MOTION.stagger, delayChildren: 0.02 },
  },
};

/** Carte : fondu + léger glissement vertical. */
export const staggerItem = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: MOTION.base, ease: MOTION.easeOut } },
};

/** Changement de page : fondu + y 8 → 0. */
export const pageTransition = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: MOTION.base, ease: MOTION.easeOut, staggerChildren: MOTION.stagger } },
  exit: { opacity: 0, y: -4, transition: { duration: MOTION.fast, ease: MOTION.easeOut } },
};

/** Survol d'une carte : y -4 et ombre accentuée. */
export const cardHover = {
  y: -4,
  transition: { duration: MOTION.fast, ease: MOTION.easeOut },
};

export const cardRest = {
  y: 0,
  transition: { duration: MOTION.base, ease: MOTION.easeOut },
};

/** Infobulle : fondu + translateY, jamais de rebond. */
export const tooltipMotion = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: MOTION.fast, ease: MOTION.easeOut } },
  exit: { opacity: 0, y: 4, transition: { duration: MOTION.fast, ease: MOTION.easeOut } },
};

/** Transitions de `layoutId` (pilule de navigation, onglet segmenté). */
export const layoutSpring = { type: "spring", stiffness: 480, damping: 38, mass: 0.7 };
export const layoutSoft = { duration: MOTION.base, ease: MOTION.easeOut };
