/**
 * Appairage Telegram : interpretation de `/lier` ET logique reelle du service.
 *
 * Les tests de service tournent sur une base EN MEMOIRE minimale (seules les
 * requetes que le service emet sont simulees). Ils reproduisent le parcours
 * signale le 15/10/2026 — `/lier <code>` refuse — et en verrouillent la cause :
 * apres une deconnexion, `revokedAt` n'etait jamais leve, si bien que TOUS les
 * codes suivants etaient rejetes comme « invalides ou expires ».
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { AppException } from '../../common/errors/app-error.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import {
  normalizePairingCode,
  normalizeTelegramId,
  outcomeForErrorCode,
  parseTelegramMessage,
  telegramReply,
} from './telegram-command.js';
import { TelegramLinkService } from './telegram-link.service.js';

// -----------------------------------------------------------------------------
// 1. Interpretation des messages (fonctions pures)
// -----------------------------------------------------------------------------

describe('telegram-command — lecture de /lier', () => {
  it('reconnait la forme documentee et ses variantes Telegram', () => {
    assert.deepEqual(parseTelegramMessage('/lier 944330'), { kind: 'link', code: '944330' });
    assert.deepEqual(parseTelegramMessage('/lier@ComexaWork_bot 944330'), {
      kind: 'link',
      code: '944330',
    });
    assert.deepEqual(parseTelegramMessage('/LIER   944 330 '), { kind: 'link', code: '944330' });
    assert.deepEqual(parseTelegramMessage('/lier 944-330'), { kind: 'link', code: '944330' });
    assert.deepEqual(parseTelegramMessage('lier 944330'), { kind: 'link', code: '944330' });
    assert.deepEqual(parseTelegramMessage('/start lier_012345'), { kind: 'link', code: '012345' });
  });

  it('accepte les chiffres arabes orientaux saisis sur un clavier arabe', () => {
    assert.deepEqual(parseTelegramMessage('/lier ٩٤٤٣٣٠'), { kind: 'link', code: '944330' });
  });

  it('explique la marche a suivre sans code, et refuse un code mal forme', () => {
    assert.deepEqual(parseTelegramMessage('/lier'), { kind: 'link-usage' });
    assert.deepEqual(parseTelegramMessage('/lier@ComexaWork_bot'), { kind: 'link-usage' });
    assert.deepEqual(parseTelegramMessage('/lier 12345'), {
      kind: 'link-invalid',
      argument: '12345',
    });
    assert.deepEqual(parseTelegramMessage('/lier abcdef'), {
      kind: 'link-invalid',
      argument: 'abcdef',
    });
  });

  it("laisse a l'agent les messages libres et les autres commandes", () => {
    assert.deepEqual(parseTelegramMessage('Bonjour, je veux lier mon compte'), { kind: 'text' });
    assert.deepEqual(parseTelegramMessage('lier mon compte'), { kind: 'text' });
    assert.deepEqual(parseTelegramMessage('/start'), { kind: 'other-command', command: 'start' });
    assert.deepEqual(parseTelegramMessage('/aide'), { kind: 'other-command', command: 'aide' });
    assert.deepEqual(parseTelegramMessage('/lier@AutreBot 944330'), { kind: 'foreign-bot' });
    assert.deepEqual(parseTelegramMessage(''), { kind: 'text' });
    assert.deepEqual(parseTelegramMessage(undefined), { kind: 'text' });
  });

  it('normalise les codes et identifiants transmis par n8n', () => {
    assert.equal(normalizePairingCode('944330'), '944330');
    assert.equal(normalizePairingCode(' 944 330 '), '944330');
    assert.equal(
      normalizePairingCode(12345),
      '012345',
      'un nombre perd ses zeros de tete : on les restitue',
    );
    assert.equal(normalizePairingCode(1234567), null);
    assert.equal(normalizePairingCode('94433'), null);
    assert.equal(normalizePairingCode(null), null);
    assert.equal(normalizeTelegramId(111222333), '111222333');
    assert.equal(normalizeTelegramId(' 111222333 '), '111222333');
    assert.equal(normalizeTelegramId('-1001234'), '-1001234');
    assert.equal(normalizeTelegramId('abc'), null);
  });

  it('traduit chaque erreur metier en issue, et tout inconnu en erreur serveur', () => {
    assert.equal(outcomeForErrorCode('TELEGRAM_CODE_INVALID'), 'invalid_code');
    assert.equal(outcomeForErrorCode('TELEGRAM_CODE_EXPIRED'), 'expired_code');
    assert.equal(outcomeForErrorCode('TELEGRAM_ALREADY_LINKED'), 'conflict');
    assert.equal(outcomeForErrorCode('TELEGRAM_LINK_UNUSABLE'), 'account_inactive');
    assert.equal(outcomeForErrorCode('PRISMA_DOWN'), 'server_error');
  });

  it('ne formule une confirmation que pour une liaison reussie', () => {
    for (const failure of [
      'invalid_code',
      'expired_code',
      'conflict',
      'server_error',
      'usage',
    ] as const) {
      const text = telegramReply(failure);
      assert.doesNotMatch(text, /est maintenant lié/, `« ${failure} » ne doit rien confirmer`);
    }
    assert.match(telegramReply('linked', { firstName: 'Thomas' }), /maintenant lié/);
  });
});

// -----------------------------------------------------------------------------
// 2. Service reel sur une base en memoire
// -----------------------------------------------------------------------------

interface LinkRow {
  id: string;
  userId: string;
  telegramUserId: string | null;
  telegramChatId: string | null;
  telegramUsername: string | null;
  pairingCodeHash: string | null;
  pairingExpiresAt: Date | null;
  pairedAt: Date | null;
  revokedAt: Date | null;
}

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  isServiceAccount: boolean;
  deletedAt: Date | null;
}

const hash = (code: string) => createHash('sha256').update(code, 'utf8').digest('hex');

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'NOT') {
      return !matches(row, condition as Record<string, unknown>);
    }
    const value = row[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const c = condition as { gt?: Date; not?: unknown };
      if ('not' in c && c.not === null && (value === null || value === undefined)) return false;
      if (c.gt !== undefined) return value instanceof Date && value.getTime() > c.gt.getTime();
      return true;
    }
    return value === condition;
  });
}

function fakeDatabase() {
  const links: LinkRow[] = [];
  const users: UserRow[] = [
    {
      id: 'u-thomas',
      email: 'thomas@comexa.example',
      firstName: 'Thomas',
      lastName: 'Lefevre',
      status: 'ACTIVE',
      isServiceAccount: false,
      deletedAt: null,
    },
    {
      id: 'u-ines',
      email: 'ines@comexa.example',
      firstName: 'Ines',
      lastName: 'Moreau',
      status: 'ACTIVE',
      isServiceAccount: false,
      deletedAt: null,
    },
    {
      id: 'u-gone',
      email: 'gone@comexa.example',
      firstName: 'Ex',
      lastName: 'Membre',
      status: 'SUSPENDED',
      isServiceAccount: false,
      deletedAt: null,
    },
  ];
  const audits: Array<{ action: string }> = [];
  let sequence = 0;

  const prisma = {
    telegramLink: {
      // Copies, comme Prisma : une ecriture ulterieure ne modifie pas une
      // ligne deja lue par le service.
      async findUnique({ where }: { where: Partial<LinkRow> }) {
        const row = links.find((candidate) => matches(candidate as never, where as never));
        return row ? { ...row } : null;
      },
      async findFirst({ where }: { where: Record<string, unknown> }) {
        const row = links.find((candidate) => matches(candidate as never, where));
        return row ? { ...row } : null;
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: { userId: string };
        create: Partial<LinkRow>;
        update: Partial<LinkRow>;
      }) {
        const existing = links.find((row) => row.userId === where.userId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row: LinkRow = {
          id: `link-${++sequence}`,
          userId: where.userId,
          telegramUserId: null,
          telegramChatId: null,
          telegramUsername: null,
          pairingCodeHash: null,
          pairingExpiresAt: null,
          pairedAt: null,
          revokedAt: null,
          ...create,
        };
        links.push(row);
        return row;
      },
      async update({ where, data }: { where: Record<string, unknown>; data: Partial<LinkRow> }) {
        const row = links.find((candidate) => matches(candidate as never, where));
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
      async updateMany({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<LinkRow>;
      }) {
        const targets = links.filter((row) => matches(row as never, where));
        for (const row of targets) {
          if (
            data.telegramUserId &&
            links.some((other) => other !== row && other.telegramUserId === data.telegramUserId)
          ) {
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          }
          Object.assign(row, data);
        }
        return { count: targets.length };
      },
    },
    user: {
      async findFirst({ where }: { where: { id: string } }) {
        const user = users.find(
          (candidate) => candidate.id === where.id && candidate.deletedAt === null,
        );
        if (!user) return null;
        return {
          ...user,
          roles: [
            {
              role: {
                code: 'DEVELOPER',
                permissions: [{ permission: { code: 'task:read:assigned' } }],
              },
            },
          ],
        };
      },
    },
  };
  const audit = {
    async record(entry: { action: string }) {
      audits.push(entry);
    },
  };
  return { prisma, audit, links, users, audits };
}

const BOT: AuthenticatedUser = {
  id: 'svc-bot',
  email: 'n8n@integrations.comexa.local',
  firstName: 'n8n',
  lastName: 'bot',
  roles: [],
  permissions: new Set(['telegram:link:any']),
  clientId: null,
  mustChangePassword: false,
  isIntegration: true,
};

const member = (id: string): AuthenticatedUser => ({
  id,
  email: `${id}@comexa.example`,
  firstName: id,
  lastName: 'Test',
  roles: ['DEVELOPER' as never],
  permissions: new Set(['user:read:own']),
  clientId: null,
  mustChangePassword: false,
});

const META = { ipAddress: '127.0.0.1', userAgent: 'spec' };

function service() {
  const db = fakeDatabase();
  return { db, links: new TelegramLinkService(db.prisma as never, db.audit as never) };
}

const errorCode = (error: unknown) => (error instanceof AppException ? error.code : String(error));

describe('TelegramLinkService — liaison par code', () => {
  it('lie un compte avec un code valide, puis refuse le meme code rejoue', async () => {
    const { links } = service();
    const { code } = await links.createCode(member('u-thomas'));
    const result = await links.verifyCode(
      { code, telegramUserId: '111', telegramChatId: '111', telegramUsername: '@thomas_dev' },
      BOT,
      META,
    );
    assert.equal(result.userId, 'u-thomas');
    assert.equal(result.linkStatus, 'linked');
    await assert.rejects(
      links.verifyCode({ code, telegramUserId: '111', telegramChatId: '111' }, BOT, META),
      (error) => errorCode(error) === 'TELEGRAM_CODE_INVALID',
    );
  });

  it('REGRESSION 15/10/2026 : un nouveau code fonctionne apres une deconnexion', async () => {
    const { links, db } = service();
    const first = await links.createCode(member('u-thomas'));
    await links.verifyCode(
      { code: first.code, telegramUserId: '111', telegramChatId: '111' },
      BOT,
      META,
    );
    await links.revokeForSelf(member('u-thomas'), META);
    assert.ok(db.links[0]!.revokedAt, 'la revocation est bien posee');

    const second = await links.createCode(member('u-thomas'));
    assert.equal(db.links[0]!.revokedAt, null, 'un nouveau code leve la revocation');
    const state = await links.getState(member('u-thomas'));
    assert.equal(state.linked, false, 'lever la revocation ne retablit pas la liaison');

    const result = await links.verifyCode(
      { code: second.code, telegramUserId: '111', telegramChatId: '111' },
      BOT,
      META,
    );
    assert.equal(result.linkStatus, 'linked');
    assert.equal((await links.getState(member('u-thomas'))).linked, true);
  });

  it('accepte aussi un code emis AVANT le correctif sur une liaison revoquee', async () => {
    const { links, db } = service();
    const { code } = await links.createCode(member('u-thomas'));
    db.links[0]!.revokedAt = new Date(Date.now() - 60_000); // etat laisse par l'ancien code
    const result = await links.verifyCode(
      { code, telegramUserId: '111', telegramChatId: '111' },
      BOT,
      META,
    );
    assert.equal(result.linkStatus, 'linked');
  });

  it("distingue un code expire d'un code inconnu", async () => {
    const { links, db } = service();
    const { code } = await links.createCode(member('u-thomas'));
    db.links[0]!.pairingExpiresAt = new Date(Date.now() - 1000);
    await assert.rejects(
      links.verifyCode({ code, telegramUserId: '111', telegramChatId: '111' }, BOT, META),
      (error) =>
        errorCode(error) === 'TELEGRAM_CODE_EXPIRED' && (error as AppException).getStatus() === 410,
    );
    await assert.rejects(
      links.verifyCode(
        {
          code: '000000' === code ? '000001' : '000000',
          telegramUserId: '111',
          telegramChatId: '111',
        },
        BOT,
        META,
      ),
      (error) => errorCode(error) === 'TELEGRAM_CODE_INVALID',
    );
  });

  it('tolere un code envoye avec espaces ou comme nombre', async () => {
    const { links } = service();
    const { code } = await links.createCode(member('u-thomas'));
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    const result = await links.verifyCode(
      { code: spaced, telegramUserId: 111, telegramChatId: 111 },
      BOT,
      META,
    );
    assert.equal(result.telegramChatId, '111');
  });

  it('refuse un compte Telegram deja lie a un autre profil (409)', async () => {
    const { links } = service();
    const a = await links.createCode(member('u-thomas'));
    await links.verifyCode(
      { code: a.code, telegramUserId: '111', telegramChatId: '111' },
      BOT,
      META,
    );
    const b = await links.createCode(member('u-ines'));
    await assert.rejects(
      links.verifyCode({ code: b.code, telegramUserId: '111', telegramChatId: '111' }, BOT, META),
      (error) => errorCode(error) === 'TELEGRAM_ALREADY_LINKED',
    );
  });

  it("remplace le compte Telegram d'un membre qui change d'appareil", async () => {
    const { links } = service();
    const a = await links.createCode(member('u-thomas'));
    await links.verifyCode(
      { code: a.code, telegramUserId: '111', telegramChatId: '111', telegramUsername: 'ancien' },
      BOT,
      META,
    );
    const b = await links.createCode(member('u-thomas'));
    const result = await links.verifyCode(
      { code: b.code, telegramUserId: '222', telegramChatId: '222' },
      BOT,
      META,
    );
    assert.equal(result.linkStatus, 'relinked');
    assert.equal(result.previousTelegramUsername, 'ancien');
  });

  it('refuse un compte Comexa inactif avec un 403, jamais un 401', async () => {
    const { links } = service();
    const { code } = await links.createCode(member('u-gone'));
    await assert.rejects(
      links.verifyCode({ code, telegramUserId: '333', telegramChatId: '333' }, BOT, META),
      (error) =>
        errorCode(error) === 'TELEGRAM_LINK_UNUSABLE' &&
        (error as AppException).getStatus() === 403,
    );
  });

  it('exige le scope telegram:link:any', async () => {
    const { links } = service();
    await assert.rejects(
      links.verifyCode(
        { code: '123456', telegramUserId: '1', telegramChatId: '1' },
        { ...BOT, permissions: new Set() },
        META,
      ),
      (error) => (error as AppException).getStatus() === 403,
    );
  });
});

describe('TelegramLinkService — commande /lier', () => {
  it('lie et confirme seulement apres ecriture', async () => {
    const { links, db } = service();
    const { code } = await links.createCode(member('u-thomas'));
    const reply = await links.handleCommand(
      { text: `/lier ${code}`, telegramUserId: '111', telegramChatId: '111', chatType: 'private' },
      BOT,
      META,
    );
    assert.equal(reply.handled, true);
    assert.equal(reply.ok, true);
    assert.equal(reply.status, 'linked');
    assert.match(reply.reply ?? '', /maintenant lié/);
    assert.equal(db.links[0]!.telegramUserId, '111');
  });

  it('repond clairement a un code invalide, sans rien confirmer', async () => {
    const { links } = service();
    const reply = await links.handleCommand(
      { text: '/lier 944330', telegramUserId: '111', telegramChatId: '111' },
      BOT,
      META,
    );
    assert.equal(reply.handled, true);
    assert.equal(reply.ok, false);
    assert.equal(reply.status, 'invalid_code');
    assert.equal(reply.profile, null);
  });

  it('signale « deja lie » quand le code est refuse mais la liaison existe', async () => {
    const { links } = service();
    const { code } = await links.createCode(member('u-thomas'));
    await links.handleCommand(
      { text: `/lier ${code}`, telegramUserId: '111', telegramChatId: '111' },
      BOT,
      META,
    );
    const again = await links.handleCommand(
      { text: `/lier ${code}`, telegramUserId: '111', telegramChatId: '111' },
      BOT,
      META,
    );
    assert.equal(again.status, 'already_linked');
    assert.equal(again.ok, true);
  });

  it('refuse la liaison dans un groupe, sans consommer le code', async () => {
    const { links, db } = service();
    const { code } = await links.createCode(member('u-thomas'));
    const reply = await links.handleCommand(
      { text: `/lier ${code}`, telegramUserId: '111', telegramChatId: '-100', chatType: 'group' },
      BOT,
      META,
    );
    assert.equal(reply.status, 'group_chat');
    assert.equal(reply.ok, false);
    assert.ok(db.links[0]!.pairingCodeHash, 'le code reste utilisable en prive');
  });

  it("rend la main a l'agent pour un message libre", async () => {
    const { links } = service();
    const reply = await links.handleCommand(
      { text: 'Quelles sont mes taches ?', telegramUserId: '111', telegramChatId: '111' },
      BOT,
      META,
    );
    assert.deepEqual(reply, {
      handled: false,
      command: null,
      status: null,
      ok: false,
      reply: null,
      profile: null,
    });
  });

  it('rapporte une panne inattendue sans confirmer', async () => {
    const { links, db } = service();
    const { code } = await links.createCode(member('u-thomas'));
    db.prisma.telegramLink.updateMany = async () => {
      throw new Error('connexion perdue');
    };
    const reply = await links.handleCommand(
      { text: `/lier ${code}`, telegramUserId: '111', telegramChatId: '111' },
      BOT,
      META,
    );
    assert.equal(reply.status, 'server_error');
    assert.equal(reply.ok, false);
  });

  it("garde l'empreinte SHA-256 comme seule trace du code", async () => {
    const { links, db } = service();
    const { code } = await links.createCode(member('u-thomas'));
    assert.equal(db.links[0]!.pairingCodeHash, hash(code));
    assert.notEqual(db.links[0]!.pairingCodeHash, code);
  });
});
