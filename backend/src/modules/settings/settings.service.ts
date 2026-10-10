import { Injectable } from '@nestjs/common';
import { AccessPolicy, SCOPE_ANY, type AuthenticatedUser } from '../../common/auth/principal.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SettingsQueryDto, UpdateSettingsDto } from './dto/settings.dto.js';
import {
  auditSettingValue,
  assertSettingKey,
  assertSettingValueSize,
  isInternalSetting,
  normalizeSettingValue,
  sameSettingValue,
  type JsonValue,
} from './settings-policy.js';

/**
 * SERVICE DES PARAMETRES.
 *
 * La table `settings` est une configuration cle/valeur : peu de lignes, lues
 * souvent, ecrites rarement. Deux consequences pour ce service :
 *
 *  - la lecture est bornee (`MAX_SETTING_ROWS`) et renvoie le total reel, pour
 *    qu'une troncature eventuelle soit VISIBLE dans la reponse plutot que
 *    silencieuse ;
 *  - une modification est une operation de CONFIGURATION : plusieurs parametres
 *    arrivent ensemble depuis un formulaire, et ils doivent etre ecrits ensemble.
 *    Un enregistrement a moitie applique laisserait l'application dans un etat
 *    que personne n'a choisi.
 *
 * La permission est verifiee deux fois, comme partout : par le garde de la route
 * (l'URL), et ici par `requireScope` (les donnees). Sur cette ressource les deux
 * se ressemblent parce que le catalogue ne connait que le scope `any` — mais le
 * jour ou un `setting:read:own` apparaitrait, c'est ici que la part de chaque
 * porteur se deciderait, pas dans un decorateur.
 */

/** Nombre maximal de lignes lues en une fois. */
export const MAX_SETTING_ROWS = 500;

export interface SettingView {
  readonly key: string;
  readonly value: unknown;
  readonly description: string | null;
  readonly internal: boolean;
  readonly updatedAt: string;
  readonly updatedById: string | null;
}

export interface SettingsList {
  readonly settings: readonly SettingView[];
  /** Nombre total de parametres en base, avant filtrage et avant borne. */
  readonly total: number;
}

export interface SettingsUpdateResult {
  readonly settings: readonly SettingView[];
  /** Cles dont la valeur a reellement change. */
  readonly updated: readonly string[];
  /** Cles renvoyees a l'identique : rien a journaliser. */
  readonly unchanged: readonly string[];
}

interface SettingRow {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: Date;
  updatedById: string | null;
}

function toView(row: SettingRow): SettingView {
  return {
    key: row.key,
    value: row.value,
    description: row.description,
    internal: isInternalSetting(row.key),
    updatedAt: row.updatedAt.toISOString(),
    updatedById: row.updatedById,
  };
}

/**
 * Valeur telle que Prisma l'ecrit dans une colonne `Json`.
 *
 * `JsonValue` est en lecture seule — tableaux et cles marques `readonly` : c'est
 * ce qui garantit qu'une valeur validee ne peut plus etre modifiee apres coup.
 * Prisma attend des tableaux mutables, d'ou la conversion, qui ne change que le
 * type : la valeur n'est ni copiee ni transformee. Meme convention que
 * `snapshotToJson` cote rapports.
 */
function asJsonInput(value: JsonValue): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Liste les parametres.
   *
   * Les parametres internes ne sortent QUE si l'appelant le demande
   * explicitement ET detient `setting:write:any` : celui qui peut ecrire un
   * secret est aussi celui qui peut le relire, mais un simple lecteur de
   * parametres ne doit pas le voir passer.
   */
  async list(user: AuthenticatedUser, query: SettingsQueryDto): Promise<SettingsList> {
    const policy = new AccessPolicy(user);
    policy.requireScope('setting', 'read', [SCOPE_ANY]);

    const includeInternal = query.includeInternal === true;

    if (includeInternal && !policy.has('setting:write:any')) {
      throw AppException.forbidden(
        'Les parametres internes sont reserves aux porteurs du droit de modification.',
      );
    }

    const [rows, total] = await Promise.all([
      this.prisma.setting.findMany({
        select: {
          key: true,
          value: true,
          description: true,
          updatedAt: true,
          updatedById: true,
        },
        orderBy: { key: 'asc' },
        take: MAX_SETTING_ROWS,
      }),
      this.prisma.setting.count(),
    ]);

    const settings = rows
      .map((row) => toView(row))
      .filter((view) => includeInternal || !view.internal);

    return { settings, total };
  }

  /**
   * Cree ou modifie un lot de parametres, en une seule transaction.
   *
   * L'ordre est : valider TOUT, puis ecrire. Un lot dont le troisieme parametre
   * est invalide ne doit pas laisser les deux premiers enregistres — c'est le
   * sens de la validation avant la transaction, et pas a l'interieur.
   */
  async update(user: AuthenticatedUser, dto: UpdateSettingsDto): Promise<SettingsUpdateResult> {
    const policy = new AccessPolicy(user);
    policy.requireScope('setting', 'write', [SCOPE_ANY]);

    const items = dto.settings.map((item) => {
      const key = assertSettingKey(item.key);
      const value = assertSettingValueSize(normalizeSettingValue(item.value));
      return { key, value, description: item.description };
    });

    const keys = items.map((item) => item.key);
    const duplicated = keys.find((key, index) => keys.indexOf(key) !== index);
    if (duplicated !== undefined) {
      // Deux ecritures du meme parametre dans un seul appel : l'ordre du tableau
      // deciderait de la valeur finale. On refuse plutot que de trancher a la
      // place de l'appelant.
      throw AppException.badRequest(
        'SETTING_KEY_DUPLICATED',
        `Le parametre « ${duplicated} » apparait plusieurs fois dans la requete.`,
      );
    }

    const existingRows = await this.prisma.setting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true, description: true },
    });
    const existing = new Map(existingRows.map((row) => [row.key, row]));

    const writes = items.map((item) =>
      this.prisma.setting.upsert({
        where: { key: item.key },
        create: {
          key: item.key,
          value: asJsonInput(item.value),
          description: item.description ?? null,
          updatedById: policy.userId,
        },
        update: {
          value: asJsonInput(item.value),
          // `undefined` laisse la description en place : un appel qui ne parle
          // pas de la description ne doit pas l'effacer.
          description: item.description ?? undefined,
          updatedById: policy.userId,
        },
      }),
    );

    await this.prisma.$transaction(writes);

    const changed: string[] = [];
    const unchanged: string[] = [];

    for (const item of items) {
      const previous = existing.get(item.key);
      const internal = isInternalSetting(item.key);
      const descriptionChanged =
        item.description !== undefined && item.description !== (previous?.description ?? null);
      const valueChanged = previous === undefined || !sameSettingValue(previous.value, item.value);

      if (!valueChanged && !descriptionChanged) {
        unchanged.push(item.key);
        continue;
      }

      changed.push(item.key);

      await this.audit.record({
        actorId: policy.userId,
        action: 'SETTING_UPDATED',
        entityType: 'Setting',
        entityId: item.key,
        // La valeur d'un parametre interne ne part JAMAIS dans le journal : il
        // est lisible par tous les administrateurs et conserve pour toujours.
        before:
          previous === undefined
            ? null
            : {
                value: auditSettingValue(previous.value, internal),
                description: previous.description,
              },
        after: {
          value: auditSettingValue(item.value, internal),
          description: item.description ?? previous?.description ?? null,
        },
      });
    }

    const updatedRows = await this.prisma.setting.findMany({
      where: { key: { in: changed } },
      select: { key: true, value: true, description: true, updatedAt: true, updatedById: true },
      orderBy: { key: 'asc' },
    });

    return {
      settings: updatedRows.map((row) => toView(row)),
      updated: changed,
      unchanged,
    };
  }
}
