/**
 * Resolver de test : permet d'importer une route Next.js (`next/server`) dans
 * `node --test` sans lancer Next. Seuls deux alias connus sont resolus ; tout
 * le reste suit la resolution Node normale.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") {
    return nextResolve("next/dist/server/web/exports/index.js", context);
  }
  if (specifier.startsWith("@/")) {
    const target = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
    return nextResolve(target, context);
  }
  return nextResolve(specifier, context);
}
