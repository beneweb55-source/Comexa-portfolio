/**
 * Miroir frontend du contrat d'API (backend : `src/health/contract.ts`).
 *
 * Voir le commentaire du backend pour la genese : deux pannes (404 `/api/timer`,
 * 400 `personalOnly`) venaient d'un backend deploye PLUS ANCIEN que l'interface.
 * Ici, le frontend declare les fonctionnalites sans lesquelles il ne peut pas
 * fonctionner ; `checkApiContract()` interroge `GET /api/health` et renvoie
 * exactement CE QUI MANQUE, pour que l'alerte affichee nomme la cause au lieu
 * de laisser des erreurs reseau obscures.
 *
 * La comparaison est volontairement par fonctionnalite et non par numero de
 * version : « le serveur ne sert pas le minuteur » est actionnable ; « version
 * 2026-10-12.2 < 2026-10-12.3 » ne dit pas ce qui casse.
 */

/** Fonctionnalites que CETTE interface utilise desormais. */
export const REQUIRED_FEATURES = ["timer", "personalTasks", "calendar"];

/** Version du contrat attendue (informative, affichee dans le diagnostic). */
export const EXPECTED_CONTRACT_VERSION = "2026-10-12.3";

/**
 * Interroge la sante de l'API et compare au contrat attendu.
 *
 * @returns {Promise<{ ok: true, contract: object } | { ok: false, reason: string, contract: object | null }>}
 *   Jamais rejete : une API injoignable est un diagnostic comme un autre.
 */
export async function checkApiContract(fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl("/api/health", {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "Le serveur API est injoignable (aucune réponse).", contract: null };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.success) {
    return {
      ok: false,
      reason: `Le serveur API a répondu ${response.status} sur /api/health.`,
      contract: payload?.data?.contract ?? null,
    };
  }

  const features = payload?.data?.contract?.features ?? {};
  const missing = REQUIRED_FEATURES.filter((name) => features[name] !== true);
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `Le serveur API est antérieur à l'interface : il ne sert pas ${missing.join(", ")}. ` +
        "Redéployez le backend (build + migrations) pour qu'il corresponde au frontend.",
      contract: payload.data.contract,
    };
  }

  return { ok: true, contract: payload.data.contract };
}
