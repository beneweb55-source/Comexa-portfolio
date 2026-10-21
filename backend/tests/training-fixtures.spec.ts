/**
 * AMORÇAGE DE LA BASE D'ENTRAÎNEMENT — miroir d'identités et fixtures.
 *
 * Ce que ces tests verrouillent, sur un faux client Prisma en mémoire :
 *  - la RÉCONCILIATION du miroir : une base d'entraînement qui contient déjà la
 *    même clé naturelle (`email`, `code`) sous un AUTRE identifiant ne bloque
 *    plus `enter` (panne réelle du 2026-10-21 : 409 « Cette valeur existe
 *    deja » à chaque clic, y compris après `POST /training/reset`) ;
 *  - l'idempotence des fixtures : rejouer `ensureSharedFixtures` ne duplique
 *    rien ;
 *  - la tolérance aux conflits : un `upsert` qui heurte un miroir concurrent
 *    (P2002) se réconcilie au lieu de propager l'erreur ;
 *  - la plage de références réservée aux dossiers clients : une tranche déjà
 *    prise allonge la référence au lieu de mourir sur la contrainte d'unicité.
 *
 * Le faux client implémente exactement la surface utilisée par
 * `training-fixtures.ts` (findFirst/findUnique/findMany/create/update/delete/
 * upsert, `include` minimal, `{ increment }`, clés composites et P2002).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ensureSharedFixtures,
  ensureUserFixtures,
  isUniqueConstraintError,
  mirrorIdentities,
  mirrorRow,
  type MirrorDelegate,
} from '../src/modules/training/training-fixtures.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';

type Row = Record<string, any>;

function prismaError(code: string): Error & { code: string } {
  const error = new Error(`Prisma ${code}`) as Error & { code: string };
  error.code = code;
  return error;
}

const OPERATORS = new Set(['startsWith', 'contains', 'gt', 'gte', 'lt', 'lte', 'in']);

function matchCondition(value: unknown, condition: unknown): boolean {
  if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
    const entries = Object.entries(condition);
    if (entries.every(([operator]) => OPERATORS.has(operator))) {
      return entries.every(([operator, arg]) => {
        if (operator === 'startsWith') {
          return typeof value === 'string' && value.startsWith(String(arg));
        }
        throw new Error(`Opérateur ${operator} non implémenté dans le faux client`);
      });
    }
    throw new Error('Condition inattendue dans le faux client');
  }
  return value === condition;
}

/** Where Prisma : égalités, opérateurs et clés composites (`scope_year`). */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key in row) return matchCondition(row[key], condition);
    if (condition && typeof condition === 'object') return matches(row, condition as Row);
    return false;
  });
}

interface FakeDbOptions {
  initial?: Record<string, Row[]>;
  uniques?: Record<string, string[][]>;
  /** `model.column` mis à jour quand un id de `model` change (onUpdate Cascade). */
  cascades?: Record<string, string[]>;
}

const DEFAULT_UNIQUES: Record<string, string[][]> = {
  permission: [['code']],
  role: [['code']],
  user: [['email']],
  userRole: [['userId', 'roleId']],
  service: [['slug']],
  prospect: [['reference']],
  client: [['reference']],
  quote: [['reference']],
  invoice: [['reference']],
  payment: [['reference']],
  counter: [['scope', 'year']],
};

/** Faux client Prisma : la surface utilisée par `training-fixtures.ts`. */
function makeDb(options: FakeDbOptions = {}) {
  const uniques = { ...DEFAULT_UNIQUES, ...options.uniques };
  const cascades = options.cascades ?? {};
  const store = new Map<string, Row[]>();
  for (const [model, rows] of Object.entries(options.initial ?? {})) {
    store.set(model, rows.map((row) => ({ ...row })));
  }
  let sequence = 0;

  const rowsOf = (model: string): Row[] => {
    let rows = store.get(model);
    if (!rows) {
      rows = [];
      store.set(model, rows);
    }
    return rows;
  };

  const conflictingKeys = (model: string, data: Row, ignoreId?: string): string[] | null => {
    for (const keys of uniques[model] ?? []) {
      const holder = rowsOf(model).find(
        (row) => row.id !== ignoreId && keys.every((key) => row[key] === data[key]),
      );
      if (holder) return keys;
    }
    return null;
  };

  const NESTED: Record<string, Record<string, [string, string]>> = {
    client: { contacts: ['contact', 'clientId'] },
    quote: { items: ['quoteItem', 'quoteId'] },
    invoice: { items: ['invoiceItem', 'invoiceId'] },
  };

  function create(model: string, data: Row): Row {
    const row: Row = { ...data, id: data.id ?? `${model}-${(sequence += 1)}` };
    const keys = conflictingKeys(model, row);
    if (keys) throw prismaError('P2002');
    for (const [field, [childModel, foreignKey]] of Object.entries(NESTED[model] ?? {})) {
      const nested = data[field] as { create?: Row | Row[] } | undefined;
      const children = nested?.create
        ? Array.isArray(nested.create)
          ? nested.create
          : [nested.create]
        : [];
      for (const child of children) create(childModel, { ...child, [foreignKey]: row.id });
      delete row[field];
    }
    rowsOf(model).push(row);
    return { ...row };
  }

  function update(model: string, where: Row, data: Row): Row {
    const target = rowsOf(model).find((row) => matches(row, where));
    if (!target) throw prismaError('P2025');
    const oldId = target.id;
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'increment' in value) {
        target[key] = (target[key] ?? 0) + (value as { increment: number }).increment;
      } else {
        target[key] = value;
      }
    }
    if (target.id !== oldId) {
      for (const reference of cascades[model] ?? []) {
        const [referenceModel, column] = reference.split('.');
        for (const row of rowsOf(referenceModel)) {
          if (row[column] === oldId) row[column] = target.id;
        }
      }
    }
    const keys = conflictingKeys(model, target, target.id);
    if (keys) throw prismaError('P2002');
    return { ...target };
  }

  function delegate(model: string) {
    return {
      findUnique: async (args: { where: Row; include?: Row }) => {
        const row = rowsOf(model).find((item) => matches(item, args.where));
        return row ? { ...row } : null;
      },
      findFirst: async (args: { where?: Row } = {}) => {
        const row = rowsOf(model).find((item) => matches(item, args.where ?? {}));
        return row ? { ...row } : null;
      },
      findMany: async (args: { where?: Row; include?: Row } = {}) => {
        return rowsOf(model)
          .filter((item) => matches(item, args.where ?? {}))
          .map((item) => {
            const clone = { ...item };
            if (model === 'userRole' && args.include?.role) {
              clone.role =
                rowsOf('role').find((role) => role.id === item.roleId) ?? null;
            }
            return clone;
          });
      },
      create: async (args: { data: Row }) => create(model, args.data),
      update: async (args: { where: Row; data: Row }) => update(model, args.where, args.data),
      delete: async (args: { where: Row }) => {
        const rows = rowsOf(model);
        const index = rows.findIndex((item) => matches(item, args.where));
        if (index === -1) throw prismaError('P2025');
        const [removed] = rows.splice(index, 1);
        return { ...removed };
      },
      upsert: async (args: { where: Row; create: Row; update: Row }) => {
        const existing = rowsOf(model).find((item) => matches(item, args.where));
        if (existing) return update(model, { id: existing.id }, args.update);
        return create(model, args.create);
      },
    };
  }

  const db = {
    permission: delegate('permission'),
    role: delegate('role'),
    user: delegate('user'),
    userRole: delegate('userRole'),
    service: delegate('service'),
    prospect: delegate('prospect'),
    client: delegate('client'),
    contact: delegate('contact'),
    project: delegate('project'),
    milestone: delegate('milestone'),
    quote: delegate('quote'),
    quoteItem: delegate('quoteItem'),
    invoice: delegate('invoice'),
    invoiceItem: delegate('invoiceItem'),
    payment: delegate('payment'),
    counter: delegate('counter'),
    task: delegate('task'),
    /** Lecture directe des tables, pour les assertions. */
    table: (model: string): Row[] => rowsOf(model).map((row) => ({ ...row })),
  };
  return db;
}

type FakeDb = ReturnType<typeof makeDb>;

function asClient(db: FakeDb): PrismaClient {
  return db as unknown as PrismaClient;
}

/** Liens user ↔ rôle, sans l'id substitut du faux client (clé composite en base). */
function linksOf(db: FakeDb): { userId: string; roleId: string }[] {
  return db
    .table('userRole')
    .map((link) => ({ userId: link.userId as string, roleId: link.roleId as string }));
}

const YEAR = new Date().getFullYear();

function prodIdentities() {
  return makeDb({
    initial: {
      user: [
        {
          id: 'u-prod',
          email: 'samy@comexa.dz',
          passwordHash: 'hash',
          firstName: 'Samy',
          lastName: 'Zaaboub',
          status: 'ACTIVE',
          clientId: null,
        },
      ],
      role: [{ id: 'r-prod', code: 'MEMBER', name: "Membre d'équipe", isSystem: true }],
      permission: [
        {
          id: 'p-prod',
          code: 'task:write:own',
          resource: 'task',
          action: 'write',
          scope: 'own',
          description: null,
        },
      ],
      userRole: [{ userId: 'u-prod', roleId: 'r-prod' }],
    },
  });
}

test('mirrorIdentities repointe les lignes périmées (même clé naturelle, autre id)', async () => {
  const prod = prodIdentities();
  // Base d'entraînement semée indépendamment : mêmes codes et e-mails, mais
  // des identifiants différents — l'état qui bloquait `enter` en 409.
  const training = makeDb({
    cascades: { user: ['task.assigneeId', 'userRole.userId'], role: ['userRole.roleId'] },
    initial: {
      user: [
        {
          id: 'u-old',
          email: 'samy@comexa.dz',
          passwordHash: 'hash',
          firstName: 'Fantome',
          lastName: 'Semé',
          status: 'ACTIVE',
          clientId: null,
        },
      ],
      role: [{ id: 'r-old', code: 'MEMBER', name: 'Ancien libellé', isSystem: false }],
      permission: [
        {
          id: 'p-old',
          code: 'task:write:own',
          resource: 'task',
          action: 'read',
          scope: 'own',
          description: 'semé',
        },
      ],
      task: [{ id: 't-1', title: 'Travail en cours', assigneeId: 'u-old' }],
    },
  });

  await mirrorIdentities(asClient(prod), asClient(training));

  const users = training.table('user');
  assert.equal(users.length, 1);
  assert.equal(users[0].id, 'u-prod');
  assert.equal(users[0].firstName, 'Samy');
  // Les écritures d'exercice déjà liées suivent le changement d'identifiant.
  assert.equal(training.table('task')[0].assigneeId, 'u-prod');

  const roles = training.table('role');
  assert.deepEqual(
    roles.map((role) => role.id),
    ['r-prod'],
  );
  assert.equal(roles[0].name, "Membre d'équipe");
  assert.equal(roles[0].isSystem, true);

  const permissions = training.table('permission');
  assert.deepEqual(
    permissions.map((permission) => permission.id),
    ['p-prod'],
  );
  assert.equal(permissions[0].action, 'write');

  assert.deepEqual(linksOf(training), [{ userId: 'u-prod', roleId: 'r-prod' }]);
});

test('mirrorIdentities supprime le doublon périmé quand l’id production est présent', async () => {
  const prod = prodIdentities();
  const training = makeDb({
    initial: {
      user: [
        { id: 'u-prod', email: 'temporaire@comexa.dz', passwordHash: 'h', firstName: 'Samy', lastName: 'Z', status: 'ACTIVE', clientId: null },
        { id: 'u-old', email: 'samy@comexa.dz', passwordHash: 'h', firstName: 'Fantome', lastName: 'S', status: 'ACTIVE', clientId: null },
      ],
    },
  });

  await mirrorIdentities(asClient(prod), asClient(training));

  const users = training.table('user');
  assert.equal(users.length, 1);
  assert.equal(users[0].id, 'u-prod');
  assert.equal(users[0].email, 'samy@comexa.dz');
});

test('mirrorIdentities crée aux identifiants de production sur base vide', async () => {
  const prod = prodIdentities();
  const training = makeDb();

  await mirrorIdentities(asClient(prod), asClient(training));

  assert.deepEqual(
    training.table('user').map((user) => user.id),
    ['u-prod'],
  );
  assert.deepEqual(
    training.table('role').map((role) => role.id),
    ['r-prod'],
  );
  assert.deepEqual(
    training.table('permission').map((permission) => permission.id),
    ['p-prod'],
  );
  assert.deepEqual(
    linksOf(training),
    [{ userId: 'u-prod', roleId: 'r-prod' }],
  );
});

test('mirrorIdentities est idempotent (second passage sans duplication)', async () => {
  const prod = prodIdentities();
  const training = makeDb();

  await mirrorIdentities(asClient(prod), asClient(training));
  await mirrorIdentities(asClient(prod), asClient(training));

  assert.equal(training.table('user').length, 1);
  assert.equal(training.table('role').length, 1);
  assert.equal(training.table('permission').length, 1);
  assert.equal(training.table('userRole').length, 1);
});

test('ensureSharedFixtures : rejouer l’amorçage ne duplique rien', async () => {
  const db = makeDb();

  await ensureSharedFixtures(asClient(db));
  const afterFirst = {
    services: db.table('service').length,
    prospects: db.table('prospect').length,
    clients: db.table('client').length,
    projects: db.table('project').length,
    milestones: db.table('milestone').length,
    quotes: db.table('quote').length,
    invoices: db.table('invoice').length,
    payments: db.table('payment').length,
  };

  await ensureSharedFixtures(asClient(db));

  assert.deepEqual(afterFirst, {
    services: 6,
    prospects: 2,
    clients: 3,
    projects: 2,
    milestones: 1,
    quotes: 1,
    invoices: 1,
    payments: 1,
  });
  assert.deepEqual(
    {
      services: db.table('service').length,
      prospects: db.table('prospect').length,
      clients: db.table('client').length,
      projects: db.table('project').length,
      milestones: db.table('milestone').length,
      quotes: db.table('quote').length,
      invoices: db.table('invoice').length,
      payments: db.table('payment').length,
    },
    afterFirst,
  );
  // Le devis fautif porte bien ses deux lignes, dont la ligne erronée.
  const items = db.table('quoteItem');
  assert.equal(items.length, 2);
  assert.ok(items.some((item) => item.title === 'Maintenance et évolution'));
});

test('ensureUserFixtures : la tâche assignée n’est créée qu’une fois', async () => {
  const training = makeDb({
    initial: {
      user: [
        { id: 'u-prod', email: 'samy@comexa.dz', passwordHash: 'h', firstName: 'Samy', lastName: 'Z', status: 'ACTIVE', clientId: null },
      ],
      role: [{ id: 'r-prod', code: 'MEMBER', name: "Membre d'équipe", isSystem: true }],
      userRole: [{ userId: 'u-prod', roleId: 'r-prod' }],
    },
  });
  await ensureSharedFixtures(asClient(training));

  await ensureUserFixtures(asClient(training), 'u-prod');
  await ensureUserFixtures(asClient(training), 'u-prod');

  const tasks = training.table('task').filter((task) => task.title === 'Préparer la maquette');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].assigneeId, 'u-prod');
});

test('ensureUserFixtures : référence réservée prise → tranche allongée, pas de 409', async () => {
  const taken = `CLI-${YEAR}-9ABCD`;
  const training = makeDb({
    initial: {
      user: [
        { id: 'u-client', email: 'lina@client.dz', passwordHash: 'h', firstName: 'Lina', lastName: 'C', status: 'ACTIVE', clientId: 'cid-abcd' },
      ],
      role: [{ id: 'r-client', code: 'CLIENT', name: 'Client', isSystem: true }],
      userRole: [{ userId: 'u-client', roleId: 'r-client' }],
      // Une AUTRE ligne occupe la tranche courte réservée au dossier.
      client: [{ id: 'client-other', reference: taken, companyName: 'Autre dossier' }],
    },
  });

  await ensureUserFixtures(asClient(training), 'u-client');

  const dossier = training.table('client').find((client) => client.id === 'cid-abcd');
  assert.ok(dossier, 'le dossier du compte client est créé');
  assert.notEqual(dossier.reference, taken);
  assert.ok(dossier.reference.startsWith(`CLI-${YEAR}-9`));
  // Le dossier a son projet propre et ses deux devis de mission.
  const projects = training.table('project').filter((project) => project.clientId === 'cid-abcd');
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, 'Portail client');
  const subjects = training
    .table('quote')
    .filter((quote) => quote.clientId === 'cid-abcd')
    .map((quote) => quote.subject)
    .sort();
  assert.deepEqual(subjects, ['Site vitrine', 'Évolution catalogue']);
});

test('mirrorRow réconcilie un upsert heurté par un miroir concurrent (P2002)', async () => {
  const rows: Row[] = [];
  let upsertCalls = 0;
  const delegate: MirrorDelegate = {
    findUnique: async ({ where }) => rows.find((row) => row.id === where.id) ?? null,
    findFirst: async ({ where }) => rows.find((row) => row.email === where?.email) ?? null,
    create: async ({ data }) => {
      rows.push({ ...(data as Row) });
      return data;
    },
    update: async ({ where, data }) => {
      const row = rows.find((item) => item.id === where.id);
      Object.assign(row as Row, data);
      return row as Row;
    },
    delete: async ({ where }) => {
      const index = rows.findIndex((row) => row.id === where.id);
      return rows.splice(index, 1)[0];
    },
    upsert: async ({ where, create }) => {
      upsertCalls += 1;
      const existing = rows.find((row) => row.id === where.id);
      if (existing) return existing;
      if (upsertCalls === 1) {
        // Un autre processus miroir la même ligne entre-temps.
        rows.push({ id: 'race', email: (create as Row).email });
        throw prismaError('P2002');
      }
      if (rows.some((row) => row.email === (create as Row).email)) throw prismaError('P2002');
      rows.push({ ...(create as Row) });
      return create;
    },
  };

  await mirrorRow(delegate, {
    id: 'u-prod',
    naturalKey: { email: 'samy@comexa.dz' },
    create: { id: 'u-prod', email: 'samy@comexa.dz' },
    update: { email: 'samy@comexa.dz' },
  });

  assert.equal(upsertCalls, 2);
  assert.deepEqual(rows, [{ id: 'u-prod', email: 'samy@comexa.dz' }]);
});

test('isUniqueConstraintError reconnaît P2002 et seulement lui', () => {
  assert.equal(isUniqueConstraintError(prismaError('P2002')), true);
  assert.equal(isUniqueConstraintError(prismaError('P2025')), false);
  assert.equal(isUniqueConstraintError(new Error('autre')), false);
  assert.equal(isUniqueConstraintError(null), false);
});
