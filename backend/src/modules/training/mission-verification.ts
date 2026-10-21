/**
 * VÉRIFICATION DES MISSIONS — l'état réel des données d'exercice décide.
 *
 * Une mission n'est jamais réussie par un clic : le serveur interroge la base
 * d'ENTRAÎNEMENT (jamais la production) et décompte les lignes qui correspondent
 * aux critères déclarés dans `missions.ts`. L'interface ne peut que SUPPLIER
 * cette vérification, jamais la contourner.
 *
 * Les substitutions disponibles dans `where` :
 *   `{{userId}}` — l'identité RÉELLE du membre en formation (base prod),
 *   `{{now}}`    — la date courante.
 *
 * Le code d'évaluation est une fonction pure du catalogue : `evaluateCriteria`
 * reçoit un client Prisma (ou un faux, dans les tests) et rend un rapport
 * complet — utilisé par le coach (« l'action est-elle faite ? »), par la
 * validation finale (`POST /training/missions/:id/complete`) et par
 * l'évaluation sans assistance.
 */

import type { MissionCriterion } from './missions.js';

export interface CriterionResult {
  readonly id: string;
  readonly description: string;
  readonly met: boolean;
  readonly count: number;
}

export interface VerificationReport {
  readonly ok: boolean;
  readonly results: readonly CriterionResult[];
}

/** Minimal delegate Prisma requis (count sur un modèle). */
export interface CountableModel {
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

export type VerificationDb = Record<string, CountableModel | undefined>;

/**
 * Substitue `{{userId}}` et `{{now}}` en profondeur dans un filtre Prisma.
 * PURE.
 */
export function resolveWhere(
  where: Readonly<Record<string, unknown>>,
  userId: string,
  now: Date = new Date(),
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where)) {
    out[key] = resolveValue(value, userId, now);
  }
  return out;
}

function resolveValue(value: unknown, userId: string, now: Date): unknown {
  if (typeof value === 'string') {
    if (value === '{{userId}}') return userId;
    if (value === '{{now}}') return now;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, userId, now));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = resolveValue(inner, userId, now);
    }
    return out;
  }
  return value;
}

/** Vrai si le décompte satisfait le critère (minCount / expectCount). */
export function criterionMet(criterion: MissionCriterion, count: number): boolean {
  if (typeof criterion.expectCount === 'number') return count === criterion.expectCount;
  const min = criterion.minCount ?? 1;
  return count >= min;
}

/**
 * Évalue une liste de critères contre la base d'entraînement.
 *
 * Un modèle inconnu est un ERREUR PROGRAMMEUR : elle est levée, pas absorbée.
 * Un critère qui « passerait » parce que le modèle n'existe pas donnerait une
 * réussite fictive — exactement ce que ce système refuse.
 */
export async function evaluateCriteria(
  db: VerificationDb,
  criteria: readonly MissionCriterion[],
  userId: string,
  now: Date = new Date(),
): Promise<VerificationReport> {
  const results: CriterionResult[] = [];

  for (const criterion of criteria) {
    const model = db[criterion.model];
    if (!model) {
      throw new Error(
        `Critère de mission inconnu : le modèle « ${criterion.model} » n'existe pas dans la base d'entrainement.`,
      );
    }
    const where = resolveWhere(criterion.where, userId, now);
    const count = await model.count({ where });
    results.push({
      id: criterion.id,
      description: criterion.label,
      count,
      met: criterionMet(criterion, count),
    });
  }

  return { ok: results.every((r) => r.met), results };
}
