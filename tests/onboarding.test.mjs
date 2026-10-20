import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { buildTrainingCourses, courseProgress, permits, shouldProposeTraining, buildOnboarding } from '../src/lib/onboarding.mjs';
import { PROCEDURES, CONTENT_PROCEDURES, ADDITIONAL_PROCEDURES } from '../src/lib/onboarding-curriculum.mjs';
import { allowedPath } from '../src/lib/access.js';
import { visibleNavigation } from '../src/lib/space-navigation.js';
import { ROLE_PERMISSIONS, ALL_PERMISSION_CODES } from '../backend/dist/common/auth/permissions.catalogue.js';
import { accessibleSpaces } from '../backend/dist/common/spaces/space-policy.js';
import { OnboardingDto } from '../backend/dist/modules/auth/dto/onboarding.dto.js';
import { OnboardingService, trainingAccess } from '../backend/dist/modules/auth/onboarding.service.js';
import { AuthController } from '../backend/dist/modules/auth/auth.controller.js';
import { validate } from '../backend/node_modules/class-validator/cjs/index.js';

const actor = (permissions = ALL_PERMISSION_CODES, roles = ['ADMIN'], id = 'one') => ({ id, roles, permissions: new Set(permissions), clientId: null });
const catalogue = [...PROCEDURES, ...CONTENT_PROCEDURES, ...ADDITIONAL_PROCEDURES];
function checkCourses(user) {
  const access = trainingAccess(user);
  const courses = buildTrainingCourses(access);
  const expected = accessibleSpaces(user);
  if (!user.isIntegration && !user.roles.some(role => role !== 'CLIENT')) expected.push('client');
  assert.deepEqual(courses.map(course => course.id), expected);
  for (const course of courses) {
    const rights = new Set(access.find(space => space.id === course.id).permissions);
    const ids = course.chapters.map(chapter => chapter.id);
    assert.equal(new Set(ids).size, ids.length, 'identifiants uniques');
    for (const chapter of course.chapters) {
      assert.ok(chapter.id.startsWith(`${course.id}:`));
      assert.ok(permits(chapter, rights, course.id));
      assert.ok(chapter.steps.length >= 3 && chapter.example && chapter.pitfalls && chapter.result && chapter.quiz);
      if (!chapter.href) { assert.equal(chapter.module, 'introduction'); continue; }
      const route = chapter.href.split('?')[0];
      assert.ok(existsSync(`src/app/(session)${route}/page.jsx`), `route réelle : ${route}`);
      assert.ok(allowedPath({ ...user, permissions: [...user.permissions] }, route), `route autorisée : ${route}`);
    }
    if (course.id !== 'client') {
      for (const item of visibleNavigation(course.id, rights).flatMap(group => group.items)) {
        assert.ok(course.chapters.some(chapter => chapter.module === item.section), `module couvert : ${item.section}`);
      }
    }
  }
  return courses;
}
for (const [role, declared] of Object.entries(ROLE_PERMISSIONS)) {
  test(`${role}: tous les espaces autorisés, modules et procédures filtrés`, () => checkCourses(actor(declared === 'ALL' ? ALL_PERMISSION_CODES : declared, [role])));
}
test('inscrit sans rôle, machine et compte multirôle', () => {
  assert.deepEqual(checkCourses(actor([], [])).map(course => course.id), ['client']);
  assert.deepEqual(checkCourses({ ...actor(), isIntegration: true }), []);
  assert.ok(!checkCourses(actor(ALL_PERMISSION_CODES, ['ADMIN', 'CLIENT'])).some(course => course.id === 'client'));
});
test('combinaisons personnalisées : chaque permission isolée et chaque droit retiré au catalogue', () => {
  for (const code of ALL_PERMISSION_CODES) {
    checkCourses(actor([code], ['DEVELOPER']));
    checkCourses(actor(ALL_PERMISSION_CODES.filter(entry => entry !== code), ['SALES']));
  }
});
test('chaque prérequis de procédure doit être réel, retrait de all et groupes any ferme le chapitre', () => {
  for (const lesson of catalogue) {
    for (const code of [...lesson.all ?? [], ...lesson.any ?? [], ...(lesson.requiresAny ?? []).flat()]) {
      assert.ok(ALL_PERMISSION_CODES.includes(code), `permission du catalogue : ${code}`);
    }
    const area = lesson.areas?.[0] ?? 'team';
    for (const code of lesson.all ?? []) assert.equal(permits(lesson, ALL_PERMISSION_CODES.filter(entry => entry !== code), area), false, `${lesson.key} sans ${code}`);
    for (const group of [lesson.any, ...(lesson.requiresAny ?? [])].filter(Boolean)) assert.equal(permits(lesson, ALL_PERMISSION_CODES.filter(entry => !group.includes(entry)), area), false);
  }
});
test('lecture seule, écriture sans lecture, catalogue manquant et périmètres propres', () => {
  const read = checkCourses(actor(['quote:read:any', 'invoice:read:any'], ['SALES']));
  assert.ok(!read.flatMap(course => course.chapters).some(chapter => chapter.level === 'sensible' && ['devis', 'factures'].includes(chapter.module)));
  const content = checkCourses(actor(['service:write:any'], ['COMMUNICATION_MANAGER']));
  assert.ok(!content.flatMap(course => course.chapters).some(chapter => chapter.key === 'services-write'));
  const role = checkCourses(actor(['role:read:any', 'role:manage:any'], ['ADMIN']));
  assert.ok(!role.flatMap(course => course.chapters).some(chapter => chapter.key === 'permissions'));
  const personal = checkCourses(actor(['task:read:personal', 'time:read:own', 'time:write:own'], ['DEVELOPER']));
  assert.ok(!personal.flatMap(course => course.chapters).some(chapter => chapter.key === 'timer'));
});
test('compatibilité de lecture du premier guide', () => {
  const groups = visibleNavigation('team', ['quote:read:any']);
  assert.equal(buildOnboarding(groups).length, groups.flatMap(group => group.items).length);
});
test('acquis stables après réordonnancement, nouveau droit, retrait et réattribution', () => {
  const before = buildTrainingCourses(trainingAccess(actor(['quote:read:any'], ['SALES']))).find(course => course.id === 'team');
  const completed = before.chapters.map(chapter => chapter.id);
  const saved = { completedChapterIds: completed, knownChapterIds: completed, status:'completed', curriculumVersion:2 };
  const after = buildTrainingCourses(trainingAccess(actor(['quote:read:any', 'quote:send:any'], ['SALES']))).find(course => course.id === 'team');
  assert.equal(courseProgress(after, saved).done, completed.length);
  assert.ok(courseProgress(after, saved).added.some(chapter => chapter.key === 'send'));
  assert.ok(shouldProposeTraining(after, saved));
  assert.equal(courseProgress({ ...after, chapters:[...after.chapters].reverse() }, saved).done, completed.length);
  assert.equal(courseProgress(before, saved).remaining.length, 0);
  assert.equal(shouldProposeTraining(before, saved), false);
  assert.equal(shouldProposeTraining(after, { ...saved, status:'paused' }), false);
  assert.equal(shouldProposeTraining(after, { status:'completed', curriculumVersion:1 }), false);
});

function memoryPrisma() {
  const rows = new Map();
  const keyOf = ({userId, area}) => `${userId}/${area}`;
  const table = {
    findMany: async ({where}) => [...rows.values()].filter(row => row.userId === where.userId && where.area.in.includes(row.area)),
    upsert: async ({where, create}) => {
      const key = keyOf(where.userId_area);
      if (!rows.has(key)) rows.set(key, { step:0, status:'active', revision:0, curriculumVersion:1, currentChapterId:null, knownChapterIds:[], completedChapterIds:[], ...create });
      return structuredClone(rows.get(key));
    },
    updateMany: async ({where, data}) => {
      const key = keyOf(where);
      const row = rows.get(key);
      if (row.revision !== where.revision) return {count:0};
      rows.set(key, {...row, ...data, revision:row.revision + data.revision.increment});
      return {count:1};
    },
    findUniqueOrThrow: async ({where}) => structuredClone(rows.get(keyOf(where.userId_area))),
  };
  return { rows, onboardingProgress:table, $transaction: async fn => fn({onboardingProgress:table}) };
}
test('service : pause, reprise, validation, réouverture et recommencement ciblé', async () => {
  const prisma = memoryPrisma(); const service = new OnboardingService(prisma); const user = actor();
  let revision = 0;
  async function save(operation, chapterId, chapterIds = ['team:first', 'team:second']) {
    const row = await service.save(user, {area:'team', operation, chapterId, chapterIds, revision}); revision = row.revision; return row;
  }
  assert.equal((await save('visit', 'team:first')).currentChapterId, 'team:first');
  assert.deepEqual((await save('complete', 'team:first')).completedChapterIds, ['team:first']);
  assert.equal((await save('pause', 'team:second')).status, 'paused');
  assert.equal((await save('resume', 'team:second')).status, 'active');
  assert.equal((await save('complete', 'team:second')).status, 'completed');
  assert.deepEqual((await save('reopen', 'team:first')).completedChapterIds, ['team:second']);
  await save('complete', 'team:first');
  const restarted = await save('restart', 'team:first', ['team:first']);
  assert.deepEqual(restarted.completedChapterIds, ['team:second'], 'les acquis temporairement masqués restent conservés');
  assert.equal((await service.list(actor([], [], 'two'))).length, 0, 'isolation entre comptes');
});
test('service : retrait d’espace refuse écriture et masque la progression sans l’effacer', async () => {
  const prisma = memoryPrisma(); const service = new OnboardingService(prisma);
  await service.save(actor(), {area:'comexa', operation:'complete', chapterId:'comexa:test', chapterIds:['comexa:test'], revision:0});
  const limited = actor(['quote:read:any'], ['DEVELOPER']);
  assert.equal((await service.list(limited)).length, 0);
  await assert.rejects(service.save(limited, {area:'comexa', step:0, status:'active'}), error => error.getStatus() === 403);
  assert.equal((await service.list(actor()))[0].completedChapterIds[0], 'comexa:test');
});
test('service : concurrence entre appareils et absence de mélange entre espaces', async () => {
  const service = new OnboardingService(memoryPrisma());
  const input = {area:'team', operation:'complete', chapterId:'team:test', chapterIds:['team:test'], revision:0};
  await service.save(actor(), input);
  await assert.rejects(service.save(actor(), input), error => error.getStatus() === 409);
  await assert.rejects(service.save(actor(), {...input, area:'personal', revision:0}), error => error.getStatus() === 400);
  await assert.rejects(service.save(actor(), {...input, chapterId:'team:unknown', revision:1}), error => error.getStatus() === 400);
});
test('contrat historique : step/status conservés sans effacer les nouveaux acquis', async () => {
  const service = new OnboardingService(memoryPrisma());
  const controller = new AuthController(service, {}, {});
  await controller.saveOnboarding(actor(), {area:'team', step:2, status:'paused'});
  const row = (await controller.onboarding(actor()))[0];
  assert.equal(row.step, 2); assert.equal(row.status, 'paused');
  assert.ok((await controller.onboardingAccess(actor())).length > 1);
});
test('DTO : validation stricte des tailles, identifiants, opérations et compte cible', async () => {
  const valid = {area:'team', operation:'complete', chapterId:'team:test', chapterIds:['team:test'], revision:0};
  assert.equal((await validate(Object.assign(new OnboardingDto(), valid))).length, 0);
  for (const input of [
    {...valid, userId:'victim'}, {...valid, area:'other'}, {...valid, revision:-1}, {...valid, revision:undefined},
    {...valid, chapterId:undefined}, {...valid, chapterIds:undefined}, {...valid, chapterIds:[]},
    {...valid, chapterIds:['team:test','team:test']}, {...valid, chapterIds:['<script>']},
    {...valid, chapterIds:Array.from({length:401}, (_,i) => `team:${i}`)}, {...valid, operation:'deleteAccount'},
    {area:'team', step:-1}, {area:'team', status:'invalid'},
  ]) assert.ok((await validate(Object.assign(new OnboardingDto(), input), {whitelist:true, forbidNonWhitelisted:true})).length, JSON.stringify(input));
});
test('migration additive : garde les champs historiques et ajoute les acquis par identifiant', () => {
  const sql = readFileSync('backend/prisma/migrations/20261020210000_onboarding_chapters/migration.sql', 'utf8');
  assert.ok(sql.includes('completedChapterIds') && sql.includes('revision'));
  assert.ok(!/DROP|TRUNCATE/.test(sql));
});
