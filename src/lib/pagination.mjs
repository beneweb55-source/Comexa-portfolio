export const API_MAX_PER_PAGE = 100;
export const DEFAULT_MAX_PAGES = 500;

/**
 * Lit toutes les pages d'une route à pagination offset (`page`/`perPage`).
 * Les écrans qui affichent un agrégat complet doivent appeler cette fonction :
 * une première page valide n'implique pas un résultat exhaustif.
 *
 * En cas de dépassement du garde-fou, la fonction échoue explicitement au lieu
 * de renvoyer silencieusement un agrégat tronqué.
 */
export async function fetchAllPages(request, path, { perPage = API_MAX_PER_PAGE, maxPages = DEFAULT_MAX_PAGES, signal } = {}) {
  if (typeof request !== "function") throw new TypeError("Une fonction request est requise.");
  if (typeof path !== "string" || !path.startsWith("/")) throw new TypeError("Le chemin paginé doit être une route relative commençant par /.");

  const [route, rawQuery = ""] = path.split("?", 2);
  const params = new URLSearchParams(rawQuery.split("#", 1)[0]);
  const requestedPerPage = Number(params.get("perPage")) || perPage;
  const pageSize = Math.min(API_MAX_PER_PAGE, Math.max(1, Math.floor(requestedPerPage)));
  const pageLimit = Math.max(1, Math.floor(Number(maxPages) || DEFAULT_MAX_PAGES));
  params.set("perPage", String(pageSize));

  const items = [];
  let firstMeta = null;
  let expectedPages = null;

  for (let page = 1; page <= pageLimit; page += 1) {
    if (signal?.aborted) throw abortError();
    params.set("page", String(page));
    const query = params.toString();
    const response = await request(`${route}?${query}`, signal ? { signal } : undefined);
    const rows = response?.data;
    if (!Array.isArray(rows)) throw new TypeError(`La route ${route} n'a pas renvoyé une liste.`);

    if (page === 1) {
      firstMeta = response.meta ?? null;
      const totalPages = Number(firstMeta?.totalPages);
      expectedPages = Number.isFinite(totalPages) && totalPages >= 0 ? Math.floor(totalPages) : null;
      if (expectedPages !== null && expectedPages > pageLimit) {
        throw new RangeError(`La route ${route} contient ${expectedPages} pages ; limite de sécurité : ${pageLimit}.`);
      }
    }

    items.push(...rows);
    if (expectedPages !== null) {
      if (page >= expectedPages) break;
    } else if (rows.length < pageSize || rows.length === 0) {
      break;
    }

    if (page === pageLimit) {
      throw new RangeError(`La route ${route} dépasse la limite de ${pageLimit} pages ; résultat incomplet refusé.`);
    }
  }

  const expectedTotal = Number(firstMeta?.total);
  if (Number.isFinite(expectedTotal) && expectedTotal >= 0 && items.length < expectedTotal) {
    throw new RangeError(`La route ${route} annonce ${expectedTotal} éléments, mais seulement ${items.length} ont été récupérés.`);
  }

  return { items, meta: firstMeta };
}

function abortError() {
  if (typeof DOMException !== "undefined") return new DOMException("La requête a été annulée.", "AbortError");
  const error = new Error("La requête a été annulée.");
  error.name = "AbortError";
  return error;
}
