import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import {
  GUIDE_SPACE_LABELS,
  GUIDE_STEPS,
  PROOF_MODELS,
  type GuideProof,
  type GuideSpace,
  type GuideStepDefinition,
} from './guide.catalog.js';
import {
  guideSpaces,
  isCorrectAnswer,
  proofSatisfied,
  resolveProofWhere,
  toStepView,
  visibleSteps,
  type GuideStepView,
} from './guide.rules.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * GUIDE DE DÉMARRAGE — service.
 *
 * Trois responsabilités, rien de plus :
 *  1. `overview` : les étapes visibles + leur état, relu dans les VRAIES
 *     données (aucun environnement fictif) ;
 *  2. `complete` : valider une étape. Une étape `action` n'est validée que si
 *     le serveur compte la ligne attendue ; une étape `visit` l'est par une
 *     micro-question corrigée ici ;
 *  3. mémoriser ce qui a été vu, dans la progression personnelle déjà en base
 *     (`onboarding_progress`) — aucune migration, aucune nouvelle table.
 *
 * Toutes les lectures et écritures passent par `prodClient` : le guide parle du
 * travail réel du membre, jamais d'un bac à sable.
 */
@Injectable()
export class GuideService {
  private readonly logger = new Logger(GuideService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** État complet du guide pour ce porteur. */
  async overview(actor: AuthenticatedUser): Promise<GuideOverview> {
    const steps = visibleSteps(actor, GUIDE_STEPS);
    const acknowledged = await this.acknowledgedIds(actor.id);
    const views = await Promise.all(
      steps.map(async (step) => toStepView(step, await this.isDone(step, actor.id, acknowledged))),
    );

    const spaces = guideSpaces(actor)
      .map((space) => {
        const spaceSteps = views.filter((step) => step.space === space);
        return {
          id: space,
          label: GUIDE_SPACE_LABELS[space],
          done: spaceSteps.filter((step) => step.done).length,
          total: spaceSteps.length,
          steps: spaceSteps,
        };
      })
      .filter((space) => space.steps.length > 0);

    const done = views.filter((step) => step.done).length;
    const next = views.find((step) => !step.done) ?? null;
    return {
      spaces,
      done,
      total: views.length,
      nextStepId: next?.id ?? null,
    };
  }

  /**
   * Valide une étape.
   *
   *  - `action` : la preuve est recalculée ici. Si elle manque, on répond 409
   *    avec la consigne exacte — le guide ne dit jamais « bien joué » à vide.
   *  - `visit`  : si une micro-question existe, `optionId` est exigé ; une
   *    mauvaise réponse renvoie la correction sans valider l'étape.
   */
  async complete(
    actor: AuthenticatedUser,
    stepId: string,
    optionId?: string,
  ): Promise<CompleteGuideResult> {
    const step = this.requireVisibleStep(actor, stepId);

    if (step.kind === 'action') {
      if (!(await this.isDone(step, actor.id, new Set()))) {
        throw new AppException(
          'GUIDE_ACTION_ATTENDUE',
          `Pas encore détecté : ${step.prompt}`,
          HttpStatus.CONFLICT,
        );
      }
      await this.acknowledge(actor.id, step);
      return { ok: true, stepId: step.id, overview: await this.overview(actor) };
    }

    if (step.recall) {
      if (!optionId) {
        throw new AppException(
          'GUIDE_REPONSE_REQUISE',
          'Choisissez une réponse pour valider cette étape.',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!isCorrectAnswer(step.recall, optionId)) {
        return {
          ok: false,
          stepId: step.id,
          correction: {
            optionId: step.recall.answerId,
            explanation: step.recall.explanation,
          },
          overview: await this.overview(actor),
        };
      }
      await this.acknowledge(actor.id, step);
      return {
        ok: true,
        stepId: step.id,
        explanation: step.recall.explanation,
        overview: await this.overview(actor),
      };
    }

    await this.acknowledge(actor.id, step);
    return { ok: true, stepId: step.id, overview: await this.overview(actor) };
  }

  // -------------------------------------------------------------------------

  private requireVisibleStep(actor: AuthenticatedUser, stepId: string): GuideStepDefinition {
    const step = visibleSteps(actor, GUIDE_STEPS).find((entry) => entry.id === stepId);
    if (!step) {
      throw AppException.notFound('GUIDE_STEP_NOT_FOUND', 'Cette étape n’existe pas dans votre guide.');
    }
    return step;
  }

  /** Une étape est-elle faite ? Preuve en base pour `action`, mémoire pour `visit`. */
  private async isDone(
    step: GuideStepDefinition,
    userId: string,
    acknowledged: ReadonlySet<string>,
  ): Promise<boolean> {
    if (step.kind === 'action' && step.proof) {
      return this.proofMet(step.proof, userId);
    }
    return acknowledged.has(step.id);
  }

  /**
   * Compte les lignes qui prouvent l'action, sur les données de PRODUCTION.
   *
   * Fail-closed : un modèle hors liste, un delegate absent ou une erreur de
   * lecture rendent `false`. Une étape ne se coche jamais par accident.
   */
  private async proofMet(proof: GuideProof, userId: string): Promise<boolean> {
    if (!PROOF_MODELS.has(proof.model)) {
      this.logger.warn(`Preuve de guide ignorée : modèle inconnu « ${proof.model} ».`);
      return false;
    }
    const db = this.prisma.prodClient as unknown as Record<
      string,
      { count?: (args: { where: Record<string, unknown> }) => Promise<number> } | undefined
    >;
    const delegate = db[proof.model];
    if (!delegate || typeof delegate.count !== 'function') return false;
    try {
      const count = await delegate.count({ where: resolveProofWhere(proof.where, userId) });
      return proofSatisfied(proof, count);
    } catch (error) {
      this.logger.warn(`Preuve de guide illisible (${proof.model}) : ${(error as Error).message}`);
      return false;
    }
  }

  /** Étapes déjà vues, par espace (progression personnelle existante). */
  private async acknowledgedIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.prodClient.onboardingProgress.findMany({
      where: { userId },
      select: { completedChapterIds: true },
    });
    return new Set(rows.flatMap((row) => row.completedChapterIds));
  }

  /**
   * Mémorise une étape vue.
   *
   * `push` atomique de la liste : deux onglets ouverts ne se perdent pas. Un
   * doublon éventuel est neutralisé à la lecture (ensemble).
   */
  private async acknowledge(userId: string, step: GuideStepDefinition): Promise<void> {
    const area: GuideSpace = step.space;
    await this.prisma.prodClient.onboardingProgress.upsert({
      where: { userId_area: { userId, area } },
      create: {
        userId,
        area,
        completedChapterIds: [step.id],
        currentChapterId: step.id,
      },
      update: {
        completedChapterIds: { push: step.id },
        currentChapterId: step.id,
        revision: { increment: 1 },
      },
    });
  }
}

export interface GuideOverview {
  readonly spaces: {
    readonly id: GuideSpace;
    readonly label: string;
    readonly done: number;
    readonly total: number;
    readonly steps: readonly GuideStepView[];
  }[];
  readonly done: number;
  readonly total: number;
  readonly nextStepId: string | null;
}

export interface CompleteGuideResult {
  readonly ok: boolean;
  readonly stepId: string;
  readonly explanation?: string;
  readonly correction?: { readonly optionId: string; readonly explanation: string };
  readonly overview: GuideOverview;
}
