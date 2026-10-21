"use client";

/*
 * DEVISE D'AFFICHAGE — la préférence « DA », « EUR » ou « les deux ».
 *
 * C'EST UNE PRÉFÉRENCE D'ÉCRAN, PAS UNE DONNÉE COMPTABLE. Elle ne convertit
 * rien et ne modifie aucune facture : elle choisit seulement la ou les devises
 * dont les totaux sont montrés. Un document garde sa devise d'émission, et une
 * facture en euro reste une facture en euro même si l'écran affiche les dinars.
 *
 * POURQUOI UN `useSyncExternalStore`. La préférence se change à plusieurs
 * endroits (tableau de bord, factures, devis, compte) et doit suivre
 * immédiatement partout, y compris dans un autre onglet. Un `useState` local
 * aurait laissé deux sélecteurs se contredire jusqu'au rechargement. Le store
 * externe écoute l'événement émis par le sélecteur et `storage` (autres
 * onglets), et React relit la valeur sans décalage d'hydratation : le serveur
 * rend le dinar, le client bascule ensuite sur la préférence enregistrée.
 *
 * Le stockage est celui du navigateur, comme la vue « cartes / liste » ou le
 * zoom : aucune donnée métier, aucune synchronisation entre appareils promise.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_CURRENCY,
  currencyScopeOptions,
  isCurrencyScope,
} from "./currency";

const STORAGE_KEY = "comexa:display-currency";
const CHANGE_EVENT = "comexa:display-currency-change";

function readScope() {
  if (typeof window === "undefined") return DEFAULT_CURRENCY;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isCurrencyScope(value) ? value : DEFAULT_CURRENCY;
  } catch {
    // Stockage indisponible (navigation privée stricte) : le dinar reste le
    // défaut, et le sélecteur fonctionne pour la session en cours.
    return DEFAULT_CURRENCY;
  }
}

function subscribe(listener) {
  if (typeof window === "undefined") return () => {};

  const onLocalChange = () => listener();
  const onStorage = (event) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };

  window.addEventListener(CHANGE_EVENT, onLocalChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onLocalChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Change la portée pour toute l'application et pour les autres onglets. */
export function setDisplayCurrency(scope) {
  if (!isCurrencyScope(scope)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, scope);
  } catch {
    // Préférence valable pour la session seulement : on prévient quand même
    // les écrans ouverts, sinon le clic semblerait sans effet.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: scope }));
}

/** Portée courante et son setter. */
export function useDisplayCurrency() {
  const scope = useSyncExternalStore(subscribe, readScope, () => DEFAULT_CURRENCY);
  const setScope = useCallback((next) => setDisplayCurrency(next), []);
  return { scope, setScope };
}

/**
 * Options du sélecteur pour un jeu de devises réellement présentes.
 *
 * Elles incluent toujours DA et EUR : un écran sans facture en euro doit
 * quand même permettre de choisir « EUR » ou « les deux », ne serait-ce que
 * pour constater qu'il n'y a rien — et pour préparer le jour où il y en aura.
 */
export function useCurrencyScope(available = []) {
  const { scope, setScope } = useDisplayCurrency();
  return { scope, setScope, options: currencyScopeOptions(available, scope) };
}
