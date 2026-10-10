/**
 * Lecture du contenu public côté SERVEUR (Server Components) : le HTML envoyé contient déjà
 * les données, ce qui sert le référencement. Cache de 1 heure (`revalidate`), purgeable à la demande par tag.
 * Ne lève jamais d'exception : en cas d'échec, `items` vaut null et la vue garde son contenu de repli.
 */
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";
export const PUBLIC_REVALIDATE_SECONDS = 3600;
/** Tag porté par toutes les lectures publiques : la purge à la demande l'invalide (voir app/api/revalidate). */
export const PUBLIC_CONTENT_TAG = "public-content";

export async function getPublicList(path) {
  try {
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      headers: { accept: "application/json" },
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [PUBLIC_CONTENT_TAG] },
    });
    if (!res.ok) return { items: null, error: `HTTP ${res.status}` };
    const body = await res.json();
    return { items: Array.isArray(body?.data) ? body.data : [], error: null };
  } catch {
    return { items: null, error: "Contenu indisponible" };
  }
}
