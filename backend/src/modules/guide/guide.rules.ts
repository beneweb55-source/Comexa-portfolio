/**
 * RÈGLES DU GUIDE — pures, sans base de données.
 *
 * Ce fichier ne connaît que des listes et des ensembles : quels espaces le
 * porteur peut ouvrir, quelles étapes sont visibles, ce que le navigateur a le
 * droit de recevoir. `guide.service.ts` y ajoute les `count` Prisma.
 */

import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { accessibleSpaces, effectivePermissions } from '../../common/spaces/space-policy.js';
import {
  GUIDE_SPACE_ORDER,
  type GuideProof,
  type GuideRecall,
  type GuideSpace,
  type GuideStepDefinition,
} from './guide.catalog.js';

/**
 * Espaces où le guide s'affiche.
 *
 * Même règle que le sélecteur d'espaces (`onboardingAreas`) : les
 * espaces accessibles au rôle, plus l'espace client pour un inscrit qui n'a pas
 * encore de rôle interne — il doit pouvoir suivre ses devis dès la première
 * connexion.
 */
export function guideSpaces(user: AuthenticatedUser): GuideSpace[] {
  const permissions = user.rolePermissions ?? user.permissions;
  const spaces = accessibleSpaces({ ...user, permissions }) as GuideSpace[];
  const isStaff = user.roles.some((role) => role !== 'CLIENT');
  if (!user.isIntegration && !isStaff && !spaces.includes('client')) {
    spaces.push('client');
  }
  return GUIDE_SPACE_ORDER.filter((space) => spaces.includes(space));
}

/** Droits EFFECTIFS dans un espace (les droits bruts pour l'espace client). */
export function permissionsFor(user: AuthenticatedUser, space: GuideSpace): ReadonlySet<string> {
  const permissions = user.rolePermissions ?? user.permissions;
  if (space === 'client') return permissions;
  return effectivePermissions(space, permissions);
}

/**
 * Étapes réellement proposables : l'espace doit être accessible ET l'étape
 * couverte par les droits. Une étape qu'on ne peut pas exécuter n'est jamais
 * affichée — un guide ne montre pas une porte fermée.
 */
export function visibleSteps(
  user: AuthenticatedUser,
  steps: readonly GuideStepDefinition[],
): GuideStepDefinition[] {
  const spaces = new Set(guideSpaces(user));
  return steps.filter((step) => {
    if (!spaces.has(step.space)) return false;
    if (!step.anyPermissions || step.anyPermissions.length === 0) return true;
    const permissions = permissionsFor(user, step.space);
    return step.anyPermissions.some((code) => permissions.has(code));
  });
}

/** Remplace `{{userId}}` dans un filtre de preuve (en profondeur). */
export function resolveProofWhere(
  where: Readonly<Record<string, unknown>>,
  userId: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where)) {
    out[key] = resolveValue(value, userId);
  }
  return out;
}

function resolveValue(value: unknown, userId: string): unknown {
  if (typeof value === 'string') return value === '{{userId}}' ? userId : value;
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, userId));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = resolveValue(inner, userId);
    return out;
  }
  return value;
}

/** Une preuve est satisfaite au-delà de `minCount` (défaut 1). */
export function proofSatisfied(proof: GuideProof, count: number): boolean {
  return count >= (proof.minCount ?? 1);
}

/** Réponse juste à une micro-question ? */
export function isCorrectAnswer(recall: GuideRecall, optionId: string): boolean {
  return recall.answerId === optionId;
}

/**
 * Étape telle qu'elle part au navigateur.
 *
 * `answerId` et la correction restent sur le serveur : le client reçoit la
 * question, les options et — seulement après réponse — l'explication.
 */
export interface GuideStepView {
  readonly id: string;
  readonly space: GuideSpace;
  readonly kind: 'action' | 'visit';
  readonly title: string;
  readonly prompt: string;
  readonly why: string;
  readonly href: string;
  readonly target?: string;
  readonly done: boolean;
  readonly recall?: { readonly question: string; readonly options: GuideRecall['options'] };
}

export function toStepView(step: GuideStepDefinition, done: boolean): GuideStepView {
  const view: GuideStepView = {
    id: step.id,
    space: step.space,
    kind: step.kind,
    title: step.title,
    prompt: step.prompt,
    why: step.why,
    href: step.href,
    ...(step.target ? { target: step.target } : {}),
    done,
  };
  if (!step.recall) return view;
  return {
    ...view,
    recall: { question: step.recall.question, options: step.recall.options },
  };
}
