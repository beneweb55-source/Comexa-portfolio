"use client";

/*
 * Lecteur de document soft UI : un volet quasi plein écran qui affiche un
 * document (PDF) dans une iframe, avec les commandes que le document appelle —
 * imprimer, plein écran, fermer — et les actions métier passées par l'appelant.
 *
 * POURQUOI CETTE TAILLE ET CE SCROLL.
 *
 * L'aperçu de facture tenait dans une carte de 896 px centrée, avec un cadre
 * interne à `overflow: auto` autour d'une iframe elle-même scrollable : sur un
 * écran de 1670 × 880, la page A4 apparaissait dans à peu près 780 × 435 px, et
 * l'utilisateur empilait trois barres de défilement (page, volet, cadre) pour
 * lire un document d'une page.
 *
 * Ici : le volet fait 96 vw × 94 dvh (plein cadre sur mobile), son corps est en
 * `overflow: hidden` et l'iframe le remplit bord à bord. Le SEUL défilement qui
 * reste est celui du document, géré par le lecteur PDF du navigateur.
 *
 * Le volet est rendu dans un portail vers `body`, comme les boîtes de dialogue.
 * Ce n'est pas une précaution : une modale laissée dans la page passe SOUS le
 * dock noir flottant, quel que soit son `z-index`. `.sui-shell__body` porte
 * `z-index: 0` — voulu, pour que le dock passe au-dessus du panneau clair — et
 * `.sui-main__scroll` a `container-type: inline-size`, qui isole lui aussi son
 * sous-arbre. Les deux enferment tout `z-index` interne dans un contexte qui,
 * lui, reste au niveau 0 : `z-50` comme `z-[100]` perdaient donc contre le dock
 * (45). Le portail sort de ces deux contextes d'un coup.
 *
 * BARRE D'OUTILS NATIVE. `#toolbar=0&navpanes=0&view=FitH` masque la barre du
 * lecteur intégré de Chrome et Edge (PDFium) et ajuste la page à la largeur.
 * Firefox ne retient que `zoom`, Safari que `page` : il n'existe aucun moyen
 * portable de retirer cette barre en HTML. Nos propres boutons prennent donc le
 * relais, et ils fonctionnent partout.
 */

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader, Maximize2, Minimize2, Printer, X } from "lucide-react";
import { IconButton } from "./primitives";
import useDialogBehavior from "./useDialogBehavior";

/** Paramètres de fragment du lecteur PDF intégré (Chrome, Edge, PDFium). */
const PDF_FRAGMENT = "#toolbar=0&navpanes=0&view=FitH";

/**
 * @param {object} props
 * @param {string} props.title Titre du volet, relié par `aria-labelledby`.
 * @param {string} [props.eyebrow] Surtitre court (« Facture », « Devis »).
 * @param {string} [props.description] Ligne de contexte sous le titre.
 * @param {string | null} [props.src] URL du document. `null` pendant le chargement.
 * @param {boolean} [props.loading] Chargement en cours : voile et roue.
 * @param {string} [props.loadingLabel]
 * @param {string | null} [props.error] Message d'échec, affiché à la place du document.
 * @param {() => void} [props.onRetry] Propose un bouton « Réessayer » avec `error`.
 * @param {() => void} props.onClose
 * @param {import("react").ReactNode} [props.actions] Boutons métier (télécharger,
 *   envoyer par email) : l'appelant les rend avec `sui-btn` / `IconButton`. Le
 *   libellé passe dans un `.sui-btn__label` pour s'effacer sur mobile.
 */
export default function Viewer({
  title,
  eyebrow,
  description,
  src,
  loading = false,
  loadingLabel = "Génération du document…",
  error = null,
  onRetry,
  onClose,
  actions,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  const frameRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);
  /* Source pour laquelle le cadre a fini de peindre. Comparer plutôt que
     réinitialiser : quand `src` change, l'état redevient « pas prêt » tout seul,
     sans `setState` dans un effet — ce que le lint du dépôt
     (`react-hooks/set-state-in-effect`) refuse, à raison. */
  const [readyFor, setReadyFor] = useState(null);
  const frameReady = readyFor !== null && readyFor === src;

  useDialogBehavior({ panelRef, onClose });

  /* Le plein écran est piloté par le navigateur (Échap, F11, geste) : l'état du
     bouton suit `fullscreenchange` plutôt que de supposer que seul notre bouton
     peut le faire basculer. */
  useEffect(() => {
    function onChange() {
      setFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* Filet de sécurité : si `onLoad` ne se déclenche jamais — navigateur sans
     lecteur PDF intégré, cadre bloqué par une extension — on découvre le
     document plutôt que de laisser une roue tourner au-dessus d'une page valide. */
  useEffect(() => {
    if (!src || frameReady) return undefined;
    const timer = setTimeout(() => setReadyFor(src), 10_000);
    return () => clearTimeout(timer);
  }, [src, frameReady]);

  async function toggleFullscreen() {
    const panel = panelRef.current;
    if (!panel) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panel.requestFullscreen();
    } catch {
      /* Refusé par le navigateur ou par la politique du cadre : le volet reste
         à 96 vw × 94 dvh, ce qui est déjà l'essentiel de l'écran. */
    }
  }

  function printDocument() {
    const frame = frameRef.current?.contentWindow;
    if (!frame) return;
    try {
      /* `blob:` hérite de l'origine du document qui l'a créé : l'appel est
         same-origin, donc autorisé. Un navigateur qui le refuse laisse de toute
         façon le raccourci d'impression classique. */
      frame.focus();
      frame.print();
    } catch {
      /* rien à afficher : l'utilisateur garde ⌘/Ctrl + P */
    }
  }

  if (typeof document === "undefined") return null;

  /* Le document n'est pas prêt : pas d'impression, pas de plein écran vide. */
  const documentReady = Boolean(src) && !error;
  /* Voile tant qu'il n'y a rien à montrer (chargement, échec) et tant que
     l'iframe n'a pas peint : sans lui, un éclair blanc traverse le volet entre
     l'arrivée de l'URL et le rendu de la page. */
  const veil = !documentReady || !frameReady;

  return createPortal(
    <div
      className="sui-viewer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="sui-viewer"
        tabIndex={-1}
        data-autofocus
      >
        <header className="sui-viewer__head">
          <div className="sui-viewer__titles">
            {eyebrow ? <p className="sui-viewer__eyebrow">{eyebrow}</p> : null}
            <h2 className="sui-viewer__title" id={titleId}>{title}</h2>
            {description ? (
              <p className="sui-viewer__desc" id={descriptionId}>{description}</p>
            ) : null}
          </div>

          <div className="sui-viewer__actions">
            {actions}
            <IconButton
              icon={Printer}
              label="Imprimer"
              onClick={printDocument}
              disabled={!documentReady}
            />
            <IconButton
              icon={fullscreen ? Minimize2 : Maximize2}
              label={fullscreen ? "Quitter le plein écran" : "Plein écran"}
              onClick={toggleFullscreen}
              disabled={!documentReady}
            />
            <IconButton icon={X} label="Fermer" tone="dark" onClick={onClose} />
          </div>
        </header>

        <div className="sui-viewer__body">
          {src ? (
            <iframe
              ref={frameRef}
              /* Une clé par URL : le lecteur PDF intégré recharge un document
                 neuf au lieu de réutiliser le cadre précédent. */
              key={src}
              className="sui-viewer__frame"
              /* Le fragment va au `src`, pas à l'URL d'objet conservée par
                 l'appelant : c'est cette dernière qu'il faut révoquer. */
              src={`${src}${PDF_FRAGMENT}`}
              title={title}
              onLoad={() => setReadyFor(src)}
            />
          ) : null}

          {veil ? (
            <div className="sui-viewer__state">
              {error ? (
                <>
                  <p className="sui-viewer__state-text" role="alert">{error}</p>
                  {onRetry ? (
                    <button type="button" className="sui-btn" onClick={onRetry}>
                      Réessayer
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <Loader size={26} strokeWidth={1.75} className="sui-spin" aria-hidden="true" />
                  <p className="sui-viewer__state-text">
                    {/* `loading` distingue la fabrication du PDF côté serveur de
                        son affichage dans le cadre : deux attentes différentes. */}
                    {loading ? loadingLabel : "Ouverture du document…"}
                  </p>
                </>
              )}
            </div>
          ) : null}
        </div>

      </section>
    </div>,
    document.body,
  );
}
