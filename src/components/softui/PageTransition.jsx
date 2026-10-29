"use client";

/*
 * Transition de route pour la coque SoftUI.
 *
 * Enveloppe le contenu de la page dans `AnimatePresence` : à chaque changement
 * d'URL (key = pathname), l'ancienne page sort (fondu + léger glissement vers
 * le haut) pendant que la nouvelle entre (fondu + glissement depuis le bas).
 *
 * Next.js App Router garde la coque montée ; seul le canvas change de key.
 * AnimatePresence gère le cycle de sortie/entrée sans bloquer la navigation.
 */

import { AnimatePresence, motion } from "framer-motion";
import { pageTransition } from "./motion";

export default function PageTransition({ children, key, className = "" }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={key}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={pageTransition}
        className={`sui-page ${className}`.trim()}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
