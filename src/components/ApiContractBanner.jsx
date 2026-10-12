"use client";

/**
 * Alerte « backend périmé ».
 *
 * Composant silencieux quand tout va bien. Dès que `checkApiContract` detecte
 * un serveur API plus ancien que l'interface (ou injoignable), il affiche une
 * bandeau explicite NOMMANT le probleme — exactement le diagnostic que la
 * console ne donnait pas (« 404 » et « 400 » seuls).
 *
 * Il est monte dans les deux espaces authentifies (`espace-equipe` et
 * `espace-client`).
 */

import { useEffect, useState } from "react";
import { checkApiContract } from "@/lib/contract";

const STATE = { idle: "idle", ok: "ok", stale: "stale" };

export default function ApiContractBanner() {
  const [state, setState] = useState(STATE.idle);
  const [reason, setReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    checkApiContract().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setState(STATE.ok);
        return;
      }
      // Un navigateur ferme puis rouvert hors ligne ne doit pas crier au loup
      // a chaque navigation : seule l'incompatibilite de build merite l'alerte.
      if (result.contract === null) {
        setState(STATE.ok);
        return;
      }
      setState(STATE.stale);
      setReason(result.reason);
      // Trace egalement dans la console, pour les diagnostics a distance.
      console.error("[Comexa] Contrat API incompatible :", result.reason);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state !== STATE.stale) return null;

  return (
    <div role="alert" className="cx-contract-banner">
      <strong>Version serveur incompatible.</strong> {reason}
    </div>
  );
}
