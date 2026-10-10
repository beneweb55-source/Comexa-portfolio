/**
 * Lecture du contenu public côté SERVEUR (Server Components) : le HTML envoyé contient déjà
 * les données, ce qui sert le référencement. Cache de 1 heure (`revalidate`).
 * Ne lève jamais d'exception : en cas d'échec, `items` vaut null et la vue garde son contenu de repli.
 */
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";
export const PUBLIC_REVALIDATE_SECONDS = 3600;

export async function getPublicList(path) {
  try {
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      headers: { accept: "application/json" },
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS },
    });
    if (!res.ok) return { items: null, error: `HTTP ${res.status}` };
    const body = await res.json();
    return { items: Array.isArray(body?.data) ? body.data : [], error: null };
  } catch {
    return { items: null, error: "Contenu indisponible" };
  }
}
