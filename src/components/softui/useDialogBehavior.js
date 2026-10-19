"use client";

/*
 * Comportement modal partagé : piège à focus, fermeture par Échap, blocage du
 * défilement de la page et restitution du focus à l'élément d'origine.
 *
 * Extrait de `Dialog` parce que le lecteur de document (`Viewer`) en a besoin à
 * l'identique : une deuxième copie du même protocole aurait fini par diverger,
 * et c'est précisément le genre de code dont la régression ne se voit pas à
 * l'écran (un focus qui s'échappe, une page qui défile derrière un volet).
 *
 * LA PILE DE COUCHES. `Dialog` écoutait `keydown` sur `window` en phase de
 * capture puis appelait `stopPropagation()`. Or `stopPropagation()` arrête la
 * propagation vers les AUTRES nœuds, pas les autres écouteurs posés sur le même
 * nœud — il faudrait `stopImmediatePropagation()` pour cela. Deux volets ouverts
 * l'un dans l'autre (le formulaire d'envoi par email dans le lecteur PDF)
 * réagissaient donc tous les deux à un seul appui sur Échap, et le piège à focus
 * du volet du dessous reprenait la saisie au volet du dessus.
 *
 * Les volets ouverts s'inscrivent désormais dans une pile de module, et seule la
 * couche du haut traite le clavier. Avec un seul volet ouvert, le comportement
 * est exactement celui d'avant.
 */

import { useEffect } from "react";

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Couches modales ouvertes, la dernière étant celle qui a la main. */
const layers = [];

/**
 * @param {object} options
 * @param {import("react").RefObject<HTMLElement | null>} options.panelRef Élément
 *   portant `role="dialog"` : le focus y est piégé et rendu à l'ouverture.
 * @param {() => void} [options.onClose] Appelé sur Échap, et seulement si cette
 *   couche est la plus haute.
 * @param {boolean} [options.enabled] À `false`, le crochet ne fait rien — utile
 *   pendant le rendu côté serveur ou quand le volet est fermé.
 */
export function useDialogBehavior({ panelRef, onClose, enabled = true }) {
  useEffect(() => {
    if (!enabled) return undefined;

    const panel = panelRef.current;
    if (!panel) return undefined;

    const layer = { panel };
    layers.push(layer);

    const previous = document.activeElement;
    const focusables = () => Array.from(panel.querySelectorAll(FOCUSABLE));

    /* Un volet peut demander le focus sur lui-même plutôt que sur son premier
       bouton : c'est le cas du lecteur de document, où partir sur un bouton
       ferait perdre le raccourci Échap dès que l'utilisateur clique dans le PDF
       (l'iframe ne remonte plus les touches au document parent). */
    const autofocus = panel.hasAttribute("data-autofocus")
      ? panel
      : (panel.querySelector("[data-autofocus]") ?? focusables()[0] ?? panel);
    autofocus.focus();

    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(event) {
      /* Une couche recouverte par une autre ne touche pas au clavier. */
      if (layers[layers.length - 1] !== layer) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
        return;
      }

      if (event.key !== "Tab") return;

      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey, true);

    return () => {
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [panelRef, onClose, enabled]);
}

export default useDialogBehavior;
