// Intégration sur PostgreSQL embarqué (PGlite/WASM), avec le vrai client Prisma
// et le vrai OnboardingService. Ne remplace pas la recette du serveur PostgreSQL déployé.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { OnboardingService } from '../dist/modules/auth/onboarding.service.js';
import { ALL_PERMISSION_CODES } from '../dist/common/auth/permissions.catalogue.js';
let db, prisma, service;
const user = (id = 'alice', permissions = ALL_PERMISSION_CODES) => ({id, roles:['ADMIN'], permissions:new Set(permissions), clientId:null});
const ids = ['team:introduction:v2','team:devis:read'];
const input = (operation, revision, chapterId = ids[0]) => ({area:'team',operation,revision,chapterId,chapterIds:ids});
before(async () => {
  db = new PGlite();
  await db.exec('CREATE TABLE "users" ("id" TEXT PRIMARY KEY); INSERT INTO "users" VALUES (\'alice\'), (\'bob\'), (\'legacy\');');
  await db.exec(await readFile(new URL('../prisma/migrations/20261020195000_onboarding/migration.sql', import.meta.url),'utf8'));
  await db.exec('INSERT INTO "onboarding_progress" ("userId","area","step","status") VALUES (\'legacy\',\'team\',7,\'completed\');');
  await db.exec(await readFile(new URL('../prisma/migrations/20261020210000_onboarding_chapters/migration.sql', import.meta.url),'utf8'));
  prisma = new PrismaClient({adapter:new PrismaPGlite(db)});
  service = new OnboardingService(prisma);
});
after(async () => { await prisma?.$disconnect(); if (db && !db.closed) await db.close(); });

test('SQL : les deux migrations préservent une progression historique', async () => {
  const [row] = await service.list(user('legacy'));
  assert.equal(row.step,7); assert.equal(row.status,'completed'); assert.equal(row.curriculumVersion,1);
  assert.deepEqual(row.completedChapterIds,[]); assert.equal(row.revision,0);
});
test('Prisma/SQL : progression relue, isolation entre comptes et espaces', async () => {
  const saved = await service.save(user(), input('complete',0));
  assert.deepEqual(saved.completedChapterIds,[ids[0]]); assert.equal(saved.revision,1);
  const newServiceInstance = new OnboardingService(prisma);
  assert.deepEqual((await newServiceInstance.list(user()))[0].completedChapterIds,[ids[0]]);
  assert.equal((await service.list(user('bob'))).length,0);
  const paused = await service.save(user(),input('pause',1,ids[1]));
  assert.equal(paused.status,'paused'); assert.equal(paused.currentChapterId,ids[1]);
  const completed = await service.save(user(),input('complete',2,ids[1]));
  assert.equal(completed.status,'completed');
  assert.equal((await prisma.onboardingProgress.findMany({where:{userId:'alice',area:'personal'}})).length,0);
});
test('Prisma/SQL : une révision périmée est refusée sans altérer les acquis', async () => {
  await assert.rejects(service.save(user(), input('restart',0)), error => error.getStatus() === 409);
  const row = await prisma.onboardingProgress.findUniqueOrThrow({where:{userId_area:{userId:'alice',area:'team'}}});
  assert.equal(row.revision,3); assert.deepEqual(row.completedChapterIds,ids);
});
test('Prisma/SQL : un nouveau chapitre ne retire aucun acquis, retrait et réattribution de droits', async () => {
  const added = 'team:devis:send:v2';
  const saved = await service.save(user(), {...input('visit',3,added), chapterIds:[...ids,added]});
  assert.equal(saved.status,'active'); assert.deepEqual(saved.completedChapterIds,ids);
  assert.equal((await service.list(user('alice',[]))).length,0);
  await assert.rejects(service.save(user('alice',[]), input('resume',4)), error => error.getStatus() === 403);
  assert.deepEqual((await service.list(user()))[0].completedChapterIds,ids);
});
test('Prisma/SQL : recommencer un espace conserve les acquis hors de son instantané', async () => {
  const row = await service.save(user(), {...input('restart',4),chapterIds:[ids[0]]});
  assert.deepEqual(row.completedChapterIds,[ids[1]]);
  assert.ok(row.knownChapterIds.includes('team:devis:send:v2'));
});
test('SQL : clés étrangères et suppression en cascade du compte', async () => {
  await assert.rejects(service.save(user('absent'),input('visit',0)));
  await service.save(user('bob'),input('visit',0));
  await db.query('DELETE FROM "users" WHERE "id" = $1',['bob']);
  assert.equal((await prisma.onboardingProgress.findMany({where:{userId:'bob'}})).length,0);
  assert.ok((await service.list(user())).length > 0);
});
