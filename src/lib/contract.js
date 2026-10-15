/**
 * Miroir frontend du contrat d'API (backend : `src/health/contract.ts`).
 *
 * Voir le commentaire du backend pour la genese : deux pannes (404 `/api/timer`,
 * 400 `personalOnly`) venaient d'un backend deploye PLUS ANCIEN que l'interface.
 * Ici, le frontend declare les fonctionnalites sans lesquelles il ne peut pas
 * fonctionner ; `checkApiContract()` interroge `GET /api/health` et renvoie un
 * DIAGNOSTIC PRECIS, pour que l'alerte affichee nomme la cause au lieu de
 * laisser des erreurs reseau obscures.
 *
 * Trois cas sont distingues, et c'est voulu :
 *
 *  - `unreachable`  : l'API ne repond pas (ou renvoie du non-JSON). Une panne
 *    reseau s'affiche deja par ailleurs ; la banniere reste silencieuse pour ne
 *    pas crier au loup a chaque coupure passagere ;
 *  - `no-contract`  : l'API repond 200 SANS bloc `contract` — un build de la
 *    periode ou la poignee de main n'existait pas. Le message dit cela
 *    LITTERALEMENT : on ne peut pas savoir quelles routes il sert, seulement
 *    qu'il est anterieur au contrat ;
 *  - `missing`      : le serveur declare son contrat mais DES FONCTIONNALITES
 *    SONT ABSENTES. Le message les NOMME — « il ne sert pas calendar » est
 *    actionnable ; « version 2026-10-12.2 < 2026-10-12.3 » ne dit pas ce qui
 *    casse.
 */

/**
 * Fonctionnalites que CETTE interface utilise desormais.
 *
 * `telegramVoice` et `whatsappGateway` (ajoutees cote backend le 2026-10-15)
 * N'Y FIGURENT PAS, et ce n'est pas un oubli : aucune page de cette interface ne
 * les appelle encore — la transcription sert le bot n8n, et l'appairage WhatsApp
 * se fait dans Telegram (le QR y est affiche). Les exiger ici ferait apparaitre
 * la banniere « backend perime » sur une application qui n'utilise pas ces
 * routes, c'est-a-dire une alerte qui crie au loup. Elles y entreront le jour ou
 * une page les appellera.
 */
export const REQUIRED_FEATURES = ["timer", "personalTasks", "calendar", "taskCreators"];

/** Version du contrat attendue (informative, affichee dans le diagnostic). */
export const EXPECTED_CONTRACT_VERSION = "2026-10-15.1";

/**
 * Interroge la sante de l'API et compare au contrat attendu.
 *
 * @returns {Promise<
 *   | { ok: true, kind: 'ok', contract: object }
 *   | { ok: false, kind: 'unreachable', reason: string, contract: null }
 *   | { ok: false, kind: 'no-contract', reason: string, contract: null }
 *   | { ok: false, kind: 'missing', reason: string, contract: object }
 * >}
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
    return {
      ok: false,
      kind: "unreachable",
      reason: "Le serveur API est injoignable (aucune réponse).",
      contract: null,
    };
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
      kind: "unreachable",
      reason: `Le serveur API a répondu ${response.status} sur /api/health.`,
      contract: null,
    };
  }

  const contract = payload?.data?.contract;
  if (!contract || typeof contract !== "object") {
    // Un build d'AVANT la poignee de main sert /api/health mais ne declare rien.
    // On ne devine pas ce qu'il manque : on dit ce qu'on sait.
    return {
      ok: false,
      kind: "no-contract",
      reason:
        `Le serveur API est un build antérieur à la poignée de main de contrat (${EXPECTED_CONTRACT_VERSION}) : ` +
        "il ne déclare aucune fonctionnalité. Redéployez le backend (build + migrations) depuis la branche à jour.",
      contract: null,
    };
  }

  const features = contract.features ?? {};
  const missing = REQUIRED_FEATURES.filter((name) => features[name] !== true);
  if (missing.length > 0) {
    return {
      ok: false,
      kind: "missing",
      reason:
        `Le serveur API (contrat ${contract.version ?? "?"}) ne sert pas : ${missing.join(", ")}. ` +
        "Redéployez le backend (build + migrations) pour qu'il corresponde au frontend.",
      contract,
    };
  }

  return { ok: true, kind: "ok", contract };
}
