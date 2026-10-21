/**
 * CIBLE DE BASE DE DONNÉES — pour l'exploitation, pas pour le métier.
 *
 * Incident 2026-10-21 : le backend interrogeait une base différente de celle
 * où l'on vérifiait les comptes, et rien dans les réponses ne permettait de le
 * voir — chaque diagnostic « le compte existe pourtant ! » s'est perdu dans
 * cette ignorance. Deux questions devaient avoir une réponse IMMÉDIATE :
 *
 *  1. « QUELLE base ce serveur interroge-t-il ? » → `GET /api/health` expose
 *     la FAMILLE d'hébergement (`supabase`, `neon`, `autre`) ;
 *  2. « Et moi, mon script local ? » → `admin:create` imprime le nom d'hôte
 *     de sa propre chaîne de connexion.
 *
 * On n'expose jamais l'URL complète (identifiants) ni même le nom d'hôte dans
 * `/api/health` : un endpoint public n'a pas à donner le projet Supabase/
 * Neon exact — la famille suffit à lever l'ambiguïté « Supabase ou Neon ? »,
 * la comparaison exacte se faisant en local et dans le tableau de bord Render.
 */

export type DatabaseTarget = 'supabase' | 'neon' | 'autre';

/**
 * Nom d'hôte d'une chaîne de connexion PostgreSQL, ou null si illisible.
 *
 * Exposé pour les scripts d'exploitation (imprimé dans un terminal local) ;
 * NE PAS l'intégrer dans une réponse API publique.
 */
export function hostOf(connectionString: string | undefined): string | null {
  if (!connectionString) return null;
  try {
    return new URL(connectionString).hostname || null;
  } catch {
    return null;
  }
}

/** Famille d'hébergement déduite du nom d'hôte. PURE, testée à l'unité. */
export function databaseTargetOf(connectionString: string | undefined): DatabaseTarget {
  const host = hostOf(connectionString);
  if (!host) return 'autre';
  if (host === 'supabase.co' || host.endsWith('.supabase.co')) return 'supabase';
  if (host === 'neon.tech' || host.endsWith('.neon.tech')) return 'neon';
  return 'autre';
}
