import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { AppException, ErrorCode } from '../../common/errors/app-error.js';
import { effectivePermissions, type SpaceId } from '../../common/spaces/space-policy.js';
import {
  TRAINING_MISSIONS,
  findMission,
  filterMissionsFor,
  type AssistanceLevel,
  type TrainingMission,
  type TrainingSpace,
} from './missions.js';
import {
  evaluateCriteria,
  type VerificationDb,
  type VerificationReport,
} from './mission-verification.js';
import {
  ensureSharedFixtures,
  ensureUserFixtures,
  isUniqueConstraintError,
  mirrorIdentities,
  wipeTrainingData,
} from './training-fixtures.js';
import { TrainingTokenService } from './training-token.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { PrismaClient } from '../../generated/prisma/client.js';

/**
 * FORMATION — orchestration du parcours par rôle.
 *
 * Ce service coordonne quatre pièces, chacune avec sa frontière :
 *
 *  - le CATALOGUE (`missions.ts`) : quoi apprendre, fondé sur les permissions
 *    réelles ; filtré pour ne proposer jamais l'impossible ;
 *  - l'ENVIRONNEMENT (`training-fixtures.ts`) : un bac à sable fictif dans la
 *    base d'entraînement, réinitialisable, que les services métier RÉELS
 *    manipulent pendant les exercices ;
 *  - la VÉRIFICATION (`mission-verification.ts`) : la réussite se lit sur
 *    l'état des données d'exercice, jamais sur un clic ;
 *  - la PROGRESSION (modèles `training_*`, base de production) : ce que le
 *    membre a accompli est une donnée réelle, conservée à travers les
 *    réinitialisations du bac à sable.
 */

const SPACES_FOR_CATALOG: readonly TrainingSpace[] = ['personal', 'team', 'comexa', 'client'];

export interface MissionProgressView {
  status: string;
  attempts: number;
  startedAt: Date | null;
  completedAt: Date | null;
  evaluationPassed: boolean | null;
  evaluationScore: number | null;
}

export interface CatalogEntry extends TrainingMission {
  progress: MissionProgressView | null;
}

@Injectable()
export class TrainingService {
  private readonly logger = new Logger(TrainingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingTokens: TrainingTokenService,
  ) {}

  /** État courant : la formation est-elle configurée, une session est-elle ouverte ? */
  async status(actor: AuthenticatedUser): Promise<{
    configured: boolean;
    activeSessionId: string | null;
    banner: string;
  }> {
    const active = await this.prisma.prodClient.trainingSession.findFirst({
      where: { userId: actor.id, endedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { startedAt: 'desc' },
    });
    return {
      configured: this.prisma.isTrainingConfigured(),
      activeSessionId: active?.id ?? null,
      banner: 'MODE FORMATION — DONNÉES FICTIVES',
    };
  }

  /**
   * ENTRE EN MODE FORMATION : amorce la base d'exercice et émet le jeton.
   *
   * Le jeton de formation est la SEULE façon d'atteindre la base fictive (le
   * garde marque le scope) ; les appels faits avec le jeton ordinaire restent
   * sur la production. L'amorçage est idempotent : les identités sont
   * rafraîchies, les données partagées créées si absentes, les objets du
   * membre (dossier client, tâche assignée) assurés.
   */
  async enter(
    actor: AuthenticatedUser,
    missionId?: string,
  ): Promise<{
    token: string;
    sessionId: string;
    expiresAt: Date;
    banner: string;
  }> {
    this.requireConfigured();
    const training = await this.prisma.connectTraining();

    await this.seedEnvironment(training, actor.id);

    // Une seule session de formation vivante par membre : rouvrir
    // l'environnement ferme la précédente. Sans cela, les sessions (et leurs
    // jetons, valables 4 h) s'empilaient à chaque entrée — et un ancien jeton
    // encore présenté par un onglet resté ouvert continuait d'être accepté
    // alors que l'utilisateur croyait être reparti de zéro.
    await this.trainingTokens.endSessions(actor.id);

    const issued = await this.trainingTokens.issue(actor.id, missionId ?? null);
    this.logger.log(`Session de formation ouverte pour ${actor.id}`);
    return {
      token: issued.token,
      sessionId: issued.sessionId,
      expiresAt: issued.expiresAt,
      banner: 'MODE FORMATION — DONNÉES FICTIVES',
    };
  }

  /**
   * Amorce le bac à sable (miroir d'identités + fixtures), SÉQUENCÉ par processus
   * et avec UNE seconde chance si un conflit d'unicité survit à la
   * réconciliation interne.
   *
   * LE VERROU : `enter` est appelé par le navigateur, parfois en plusieurs
   * exemplaires parallèles (double clic, coach qui entre en formation avant de
   * démarrer une mission, deux onglets). Deux amorçages simultanés qui testent
   * « existe-t-il ? » en même temps répondent tous les deux « non » et créent
   * deux fois le même objet fictif (un client de fixture n'a PAS de contrainte
   * d'unicité sur son nom — c'est légitime en production). Sérialiser
   * l'amorçage dans le processus rend chaque `enter` suivant spectateur du
   * premier ; le filet P2002 ci-dessous couvre le cas résiduel de deux
   * processus distincts. Sans ces deux garde-fous, la panne se voyait côté
   * navigateur en « Cette valeur existe deja » sur le bouton d'entrée.
   */
  private seedLock: Promise<unknown> = Promise.resolve();

  private seedEnvironment(training: PrismaClient, actorId: string): Promise<void> {
    const run = this.seedLock.then(() => this.seedWithConflictRetry(training, actorId));
    this.seedLock = run.catch(() => undefined);
    return run;
  }

  private async seedWithConflictRetry(training: PrismaClient, actorId: string): Promise<void> {
    const seed = async (): Promise<void> => {
      await mirrorIdentities(this.prisma.prodClient, training);
      await ensureSharedFixtures(training);
      await ensureUserFixtures(training, actorId);
    };
    try {
      await seed();
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      this.logger.warn(
        `Conflit d'unicite pendant l'amorcage de la base d'entrainement (${actorId}) : reconciliation rejouee.`,
      );
      await seed();
    }
  }

  /** QUITTE le mode formation : ferme les sessions actives (production). */
  async exit(actor: AuthenticatedUser): Promise<{ closed: number }> {
    const closed = await this.trainingTokens.endSessions(actor.id);
    return { closed };
  }

  /**
   * RÉINITIALISE l'environnement de formation : vide la base d'entraînement,
   * la réamorce. La base de production (et la progression pédagogique) n'est
   * jamais touchée — c'est entièrement du SQL sur le client d'entraînement.
   */
  async reset(actor: AuthenticatedUser): Promise<{ tablesWiped: number; message: string }> {
    this.requireConfigured();
    const training = await this.prisma.connectTraining();

    const tablesWiped = await wipeTrainingData(training);
    await this.seedEnvironment(training, actor.id);

    this.logger.log(`Environnement de formation réinitialisé par ${actor.id}`);
    return {
      tablesWiped,
      message:
        'Environnement de formation réinitialisé : données fictives recréées, votre progression est conservée.',
    };
  }

  /**
   * CATALOGUE PERSONNALISÉ : les missions exécutables par CE membre, pour un
   * espace donné (ou tous), avec sa progression.
   */
  async catalog(actor: AuthenticatedUser, spaceFilter?: string): Promise<CatalogEntry[]> {
    const rolePermissions = actor.rolePermissions ?? actor.permissions;
    const progressRows = await this.prisma.prodClient.trainingMissionProgress.findMany({
      where: { userId: actor.id },
    });
    const progressByMission = new Map(progressRows.map((row) => [row.missionId, row]));

    const entries: CatalogEntry[] = [];
    for (const space of SPACES_FOR_CATALOG) {
      if (spaceFilter && spaceFilter !== space) continue;
      const permissions =
        space === 'client'
          ? rolePermissions
          : effectivePermissions(space as SpaceId, rolePermissions);
      for (const mission of filterMissionsFor(TRAINING_MISSIONS, space, permissions)) {
        const row = progressByMission.get(mission.id);
        entries.push({
          ...mission,
          progress: row
            ? {
                status: row.status,
                attempts: row.attempts,
                startedAt: row.startedAt,
                completedAt: row.completedAt,
                evaluationPassed: row.evaluationPassed,
                evaluationScore: row.evaluationScore,
              }
            : null,
        });
      }
    }
    return entries;
  }

  /** Démarre (ou reprend) une mission : trace la tentative. */
  async start(
    actor: AuthenticatedUser,
    missionId: string,
    assistance: AssistanceLevel = 'full',
  ): Promise<{ progress: MissionProgressView; attemptId: string }> {
    const mission = await this.requireMission(actor, missionId);

    const progress = await this.prisma.prodClient.trainingMissionProgress.upsert({
      where: { userId_missionId: { userId: actor.id, missionId: mission.id } },
      create: {
        userId: actor.id,
        missionId: mission.id,
        space: mission.space,
        status: 'IN_PROGRESS',
        attempts: 1,
        startedAt: new Date(),
      },
      update: {
        status: 'IN_PROGRESS',
        attempts: { increment: 1 },
        startedAt: { set: new Date() },
      },
    });

    const attempt = await this.prisma.prodClient.trainingAttempt.create({
      data: {
        progressId: progress.id,
        userId: actor.id,
        missionId: mission.id,
        assistanceLevel: assistance,
      },
    });

    return {
      progress: this.toProgressView(progress),
      attemptId: attempt.id,
    };
  }

  /**
   * VÉRIFICATION COURANTE : où en est l'utilisateur sur les critères ?
   * Lue sur la base d'ENTRAÎNEMENT — la production n'est jamais interrogée par
   * un critère de mission.
   */
  async check(
    actor: AuthenticatedUser,
    missionId: string,
    evaluation: boolean,
  ): Promise<VerificationReport> {
    const mission = await this.requireMission(actor, missionId);
    const criteria = evaluation ? mission.evaluation.criteria : mission.criteria;
    return this.verify(criteria, actor.id);
  }

  /**
   * VALIDATION FINALE : la mission n'est réussie QUE si les critères sont
   * satisfaits sur les données d'exercice. Aucun « Terminer » ne suffit.
   *
   * En cas d'échec : rien n'est marqué réussi, la tentative est tracée avec les
   * critères manquants (pour proposer de reprendre les étapes concernées).
   */
  async complete(
    actor: AuthenticatedUser,
    missionId: string,
    assistance: AssistanceLevel = 'full',
  ): Promise<{
    ok: boolean;
    report: VerificationReport;
    progress: MissionProgressView;
  }> {
    const mission = await this.requireMission(actor, missionId);
    const isEvaluation = assistance === 'none';
    const criteria = isEvaluation ? mission.evaluation.criteria : mission.criteria;
    const report = await this.verify(criteria, actor.id);

    const now = new Date();
    const progress = await this.prisma.prodClient.trainingMissionProgress.upsert({
      where: { userId_missionId: { userId: actor.id, missionId: mission.id } },
      create: {
        userId: actor.id,
        missionId: mission.id,
        space: mission.space,
        status: report.ok ? 'COMPLETED' : 'IN_PROGRESS',
        attempts: 1,
        startedAt: now,
        completedAt: report.ok ? now : null,
        evaluationPassed: isEvaluation ? report.ok : null,
        evaluationScore: isEvaluation ? (report.ok ? 100 : 0) : null,
        evaluationDetails: (isEvaluation ? this.toEvaluationDetails(report) : undefined) as never,
      },
      update: {
        status: report.ok ? 'COMPLETED' : 'IN_PROGRESS',
        completedAt: report.ok ? { set: now } : undefined,
        ...(isEvaluation
          ? {
              evaluationPassed: report.ok,
              evaluationScore: report.ok ? 100 : 0,
              evaluationDetails: this.toEvaluationDetails(report) as never,
            }
          : {}),
      },
    });

    // Trace de tentative : succès, ou échec avec les étapes à reprendre.
    const lastAttempt = await this.prisma.prodClient.trainingAttempt.findFirst({
      where: { userId: actor.id, missionId: mission.id, finishedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    const errors = report.ok
      ? undefined
      : report.results.filter((r) => !r.met).map((r) => ({ step: r.id, message: r.description }));
    if (lastAttempt) {
      await this.prisma.prodClient.trainingAttempt.update({
        where: { id: lastAttempt.id },
        data: { finishedAt: now, success: report.ok, errors: errors ?? undefined },
      });
    }

    return { ok: report.ok, report, progress: this.toProgressView(progress) };
  }

  /**
   * BILAN DE FIN DE PARCOURS : ce que le membre a démontré, ce qui reste, la
   * checklist opérationnelle de son rôle et les raccourcis vers les modules
   * RÉELS (passage explicite vers la production).
   */
  async report(actor: AuthenticatedUser): Promise<{
    mastered: {
      missionId: string;
      title: string;
      module: string;
      completedAt: Date | null;
      evaluationPassed: boolean | null;
    }[];
    remaining: { missionId: string; title: string; module: string; level: number }[];
    checklist: { missionId: string; items: string[] }[];
    toConfirm: string[];
    realLinks: { label: string; href: string }[];
  }> {
    const catalog = await this.catalog(actor);
    const mastered = catalog
      .filter((entry) => entry.progress?.status === 'COMPLETED')
      .map((entry) => ({
        missionId: entry.id,
        title: entry.title,
        module: entry.module,
        completedAt: entry.progress?.completedAt ?? null,
        evaluationPassed: entry.progress?.evaluationPassed ?? null,
      }));
    const remaining = catalog
      .filter((entry) => entry.progress?.status !== 'COMPLETED')
      .map((entry) => ({
        missionId: entry.id,
        title: entry.title,
        module: entry.module,
        level: entry.level,
      }));
    const checklist = catalog
      .filter((entry) => entry.progress?.status === 'COMPLETED')
      .map((entry) => ({ missionId: entry.id, items: [...entry.checklist] }));
    const toConfirm = catalog.flatMap((entry) => [...(entry.toConfirm ?? [])]);
    const realLinks = catalog.map((entry) => ({
      label: entry.title,
      href: entry.realModuleHref,
    }));
    return { mastered, remaining, checklist, toConfirm, realLinks };
  }

  // -------------------------------------------------------------------------

  private requireConfigured(): void {
    if (!this.prisma.isTrainingConfigured()) {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'La formation n’est pas configurée sur ce serveur : TRAINING_DATABASE_URL est absente ' +
          '(voir docs/FORMATION.md). La production reste pleinement accessible.',
      );
    }
  }

  private async requireMission(
    actor: AuthenticatedUser,
    missionId: string,
  ): Promise<TrainingMission> {
    const mission = findMission(missionId);
    if (!mission) {
      throw AppException.notFound('TRAINING_MISSION_NOT_FOUND', 'Cette mission est introuvable.');
    }
    const catalog = await this.catalog(actor, mission.space);
    if (!catalog.some((entry) => entry.id === mission.id)) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'Cette mission n’est pas ouverte avec vos permissions actuelles.',
      );
    }
    return mission;
  }

  private async verify(
    criteria: Parameters<typeof evaluateCriteria>[1],
    userId: string,
  ): Promise<VerificationReport> {
    if (!this.prisma.isTrainingConfigured()) {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Vérification impossible : la base d’entraînement n’est pas configurée.',
      );
    }
    const training = await this.prisma.connectTraining();
    return evaluateCriteria(training as unknown as VerificationDb, criteria, userId);
  }

  private toProgressView(row: {
    status: string;
    attempts: number;
    startedAt: Date | null;
    completedAt: Date | null;
    evaluationPassed: boolean | null;
    evaluationScore: number | null;
  }): MissionProgressView {
    return {
      status: row.status,
      attempts: row.attempts,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      evaluationPassed: row.evaluationPassed,
      evaluationScore: row.evaluationScore,
    };
  }

  private toEvaluationDetails(report: VerificationReport): object {
    return {
      results: report.results.map((r) => ({ id: r.id, met: r.met, count: r.count })),
      evaluatedAt: new Date().toISOString(),
    };
  }
}
