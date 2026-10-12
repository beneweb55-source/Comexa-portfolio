"use client";

/**
 * Alerte « version serveur incompatible ».
 *
 * Composant silencieux quand tout va bien. Trois diagnostics possibles (voir
 * `src/lib/contract.js`) ; deux meritent l'alerte :
 *
 *  - `no-contract` : le backend est d'avant la poignee de main de contrat —
 *    exactement la configuration qui a produit les 404/400 historiques ;
 *  - `missing` : le backend declare son contrat mais n'a pas encore telle ou
 *    telle fonctionnalite (le message les nomme).
 *
 * Une simple injoignabilite (`unreachable`) reste silencieuse : une coupure
 * reseau passagere s'affiche deja par ailleurs, et une banniere qui pleure a
 * chaque coupure finit ignoree — y compris quand elle dit vrai.
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
      if (result.kind === "unreachable") {
        setState(STATE.ok);
        return;
      }
      if (result.ok) {
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
