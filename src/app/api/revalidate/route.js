import { timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

/**
 * Purge à la demande du cache du site public.
 *
 * Appelée par l'API après chaque écriture du contenu (voir
 * `backend/src/modules/content/public-cache.ts`). Protégée par un secret partagé
 * (`REVALIDATE_SECRET`) : sans lui, n'importe qui pourrait vider le cache et
 * forcer le site à relire l'API à chaque visite.
 *
 * Cette route est un gestionnaire de fichier, donc elle passe AVANT la règle de
 * réécriture `/api/:path*` vers le backend (voir next.config.mjs).
 */
export const dynamic = "force-dynamic";

const MAX_ENTRIES = 20;

function secretMatches(provided, expected) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Liste de chaînes courtes, bornée en nombre : ce corps ne doit jamais servir à purger en masse. */
function cleanStrings(value, isValid) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string" && isValid(entry)).slice(0, MAX_ENTRIES);
}

const isTag = (entry) => entry.length > 0 && entry.length <= 100 && !entry.startsWith("/");
const isPath = (entry) => entry.startsWith("/") && entry.length <= 200;

export async function POST(request) {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "REVALIDATE_DISABLED" }, { status: 503 });
  }

  const provided = request.headers.get("x-revalidate-secret") ?? "";
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const tags = cleanStrings(body?.tags, isTag);
  const paths = cleanStrings(body?.paths, isPath);

  // expire: 0 = purge immédiate : la requête suivante reçoit la donnée fraîche.
  // (profile "max" servait l'ancienne version une fois pendant la régénération.)
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
  for (const path of paths) revalidatePath(path);

  return NextResponse.json({ revalidated: true, tags, paths });
}
