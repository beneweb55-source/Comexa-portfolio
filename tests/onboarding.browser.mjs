// Tests du frontend réel avec réponses API contrôlées : ce n'est pas un test PostgreSQL.
// Lancer le frontend puis COMEXA_TEST_URL=http://127.0.0.1:3000 npm run test:onboarding:browser.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { trainingAccess } from '../backend/dist/modules/auth/onboarding.service.js';
import { ROLE_PERMISSIONS, ALL_PERMISSION_CODES } from '../backend/dist/common/auth/permissions.catalogue.js';
import { buildTrainingCourses } from '../src/lib/onboarding.mjs';
const baseURL = process.env.COMEXA_TEST_URL ?? 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE, args:['--no-sandbox','--no-zygote','--disable-dev-shm-usage']} : {}) });
let assertions = 0;
async function fixture(role = 'ADMIN', viewport = {width:1440,height:1000}, customPermissions) {
  const declared = ROLE_PERMISSIONS[role];
  const permissions = customPermissions ?? (declared === 'ALL' ? ALL_PERMISSION_CODES : declared);
  const user = {id:'training-user', email:'formation@example.test', firstName:'Test', lastName:'Formation', roles:[role], permissions:[...permissions], clientId:role === 'CLIENT' ? 'client-1' : null, status:'ACTIVE', mustChangePassword:false, isEmailVerified:true};
  const context = await browser.newContext({viewport, reducedMotion:'reduce'});
  const page = await context.newPage();
  const state = { access:trainingAccess({...user, permissions:new Set(user.permissions)}), rows:new Map(), writes:[], failSave:false, failAccess:false };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/socket.io/**', route => route.abort());
  await page.route('**/api/**', async route => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname.slice(4);
    const ok = data => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({success:true,data, meta:{page:1,perPage:50,total:0,lastPage:1}})});
    if (path === '/auth/refresh' || path === '/auth/login') return ok({accessToken:'training-test-token', user});
    if (path === '/auth/me') return ok(user);
    if (path === '/me/spaces') return ok({spaces:state.access.filter(space => space.id !== 'client'), defaultSpace:'team'});
    if (path === '/auth/onboarding/access') {
      if (state.failAccess) return route.fulfill({status:503, json:{success:false,error:{message:'Accès temporairement indisponibles'}}});
      return ok(state.access);
    }
    if (path === '/auth/onboarding') {
      if (req.method() === 'GET') return ok([...state.rows.values()]);
      const input = req.postDataJSON(); state.writes.push(input);
      if (state.failSave) return route.fulfill({status:503, json:{success:false,error:{message:'Sauvegarde indisponible'}}});
      const row = state.rows.get(input.area) ?? {area:input.area,revision:0,completedChapterIds:[],knownChapterIds:[],curriculumVersion:2};
      if (row.revision !== input.revision) return route.fulfill({status:409,json:{success:false,error:{message:'Progression modifiée sur un autre écran'}}});
      const done = new Set(row.completedChapterIds);
      if (input.operation === 'complete') done.add(input.chapterId);
      if (input.operation === 'reopen') done.delete(input.chapterId);
      if (input.operation === 'restart') for (const id of input.chapterIds) done.delete(id);
      const next = {...row, revision:row.revision + 1, currentChapterId:input.chapterId, completedChapterIds:[...done], knownChapterIds:[...new Set([...row.knownChapterIds,...input.chapterIds])], status: input.chapterIds.every(id => done.has(id)) ? 'completed' : input.operation === 'pause' ? 'paused' : 'active'};
      state.rows.set(input.area,next); return ok(next);
    }
    if (path === '/health') return ok({contract:{version:'2026-10-16.1',features:{timer:true,personalTasks:true,calendar:true,taskCreators:true,goals:true,timerTasks:true,taskAssignees:true}}});
    if (path.includes('summary')) return ok({unreadBySpace:{},unread:0});
    if (path === '/timer') return ok(null);
    if (path.startsWith('/dashboard')) return ok({});
    if (path.includes('telegram-link')) return ok({linked:false,status:'unlinked'});
    return ok([]);
  });
  return {page,context,state,user,errors};
}
async function openTraining(page, path = '/espace-equipe/compte') {
  await page.goto(`${baseURL}${path}`);
  await page.getByRole('button', {name:/Aide · Formation COMEXA/}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('group',{name:'Espaces de formation accessibles'})).toBeVisible();
}
async function validateIntro(page) {
  await page.getByRole('button',{name:'Reprendre le premier chapitre restant'}).click();
  await expect(page.getByRole('button',{name:'Valider ce chapitre'})).toBeDisabled();
  await page.getByRole('radio').nth(1).check();
  await page.getByRole('button',{name:'Vérifier ma réponse'}).click();
  await expect(page.getByRole('button',{name:'Valider ce chapitre'})).toBeDisabled();
  await page.getByRole('radio').first().check();
  await page.getByRole('button',{name:'Vérifier ma réponse'}).click();
  await expect(page.getByRole('button',{name:'Valider ce chapitre'})).toBeEnabled();
  await page.getByRole('button',{name:'Valider ce chapitre'}).click();
}
try {
  // Sept rôles réels : le sélecteur de formation ne révèle aucun espace interdit.
  for (const role of Object.keys(ROLE_PERMISSIONS)) {
    const f = await fixture(role);
    const path = role === 'CLIENT' ? '/espace-client/compte' : '/espace-equipe/compte';
    await openTraining(f.page,path);
    const buttons = f.page.locator('.sui-training__space');
    await expect(buttons).toHaveCount(f.state.access.length);
    for (const space of f.state.access) await expect(f.page.getByRole('button',{name:new RegExp(space.label)}).last()).toBeVisible();
    assert.equal(f.errors.length,0,`${role} : ${f.errors.join('; ')}`);
    assertions++; await f.context.close();
  }
  for (const viewport of [{width:1440,height:1000},{width:375,height:812}]) {
    const f = await fixture('ADMIN',viewport); const {page,state} = f;
    await openTraining(page);
    const dialog = page.getByRole('dialog');
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1);
    assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1);
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1),'pas de débordement horizontal');
    await validateIntro(page);
    await expect.poll(() => [...state.rows.values()].some(row => row.completedChapterIds.length === 1)).toBe(true);
    await page.getByRole('button',{name:'Reprendre plus tard'}).click();
    await expect(dialog).toBeHidden();
    assert.ok([...state.rows.values()].some(row => row.status === 'paused'));
    await page.reload(); await page.getByRole('button',{name:/Aide · Formation COMEXA/}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('.sui-training__space.is-active')).toContainText('1/');
    await page.getByRole('button',{name:'Recommencer cet espace'}).click();
    await page.getByRole('button',{name:'Confirmer le recommencement'}).click();
    await expect.poll(() => [...state.rows.values()].every(row => row.completedChapterIds.length === 0)).toBe(true);
    await page.getByRole('button',{name:'Passer sans valider'}).click();
    assert.ok([...state.rows.values()].every(row => row.completedChapterIds.length === 0));
    await page.getByRole('button',{name:'Tous les chapitres'}).click();
    await page.getByRole('button',{name:'Fermer',exact:true}).last().click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button',{name:/Aide · Formation COMEXA/}).click();
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), 'focus dans le dialogue');
    for (let i=0;i<20;i++) await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), 'focus piégé');
    await mkdir('.cache/training-qa',{recursive:true});
    await page.screenshot({path:`.cache/training-qa/formation-${viewport.width}.png`});
    assert.equal(f.errors.length,0,f.errors.join('; '));
    assertions++; await f.context.close();
  }
  // Première arrivée, pause, puis parcours terminé : pas de réouverture à chaque connexion.
  {
    const f = await fixture('CLIENT', {width:375,height:812});
    await f.page.goto(`${baseURL}/espace-client`);
    await expect(f.page.getByRole('dialog')).toBeVisible();
    await f.page.getByRole('button',{name:'Fermer',exact:true}).last().click();
    await expect(f.page.getByRole('dialog')).toBeHidden();
    assert.equal(f.state.rows.get('client').status, 'paused');
    await f.page.reload();
    await expect(f.page.getByRole('button',{name:/Aide · Formation COMEXA/})).toBeVisible();
    await expect(f.page.getByRole('dialog')).toHaveCount(0);
    const course = buildTrainingCourses(f.state.access)[0];
    f.state.rows.set('client', {area:'client',revision:2,status:'completed',curriculumVersion:2,completedChapterIds:course.chapters.map(ch => ch.id),knownChapterIds:course.chapters.map(ch => ch.id)});
    await f.page.reload();
    await expect(f.page.getByRole('button',{name:/Aide · Formation COMEXA/})).toContainText(`${course.chapters.length}/${course.chapters.length}`);
    await expect(f.page.getByRole('dialog')).toHaveCount(0);
    assertions++; await f.context.close();
  }
  // Ajout et retrait d’accès à chaud : le parcours terminé ne perd aucun acquis.
  {
    const f = await fixture('SALES', {width:1440,height:1000}, ['quote:read:any','user:read:own']);
    const course = buildTrainingCourses(f.state.access).find(entry => entry.id === 'team');
    f.state.rows.set('team',{area:'team',revision:1,status:'completed',curriculumVersion:2,completedChapterIds:course.chapters.map(ch => ch.id),knownChapterIds:course.chapters.map(ch => ch.id)});
    await openTraining(f.page);
    const before = f.state.rows.get('team').completedChapterIds.length;
    f.user.permissions = ['quote:read:any','quote:send:any','user:read:own'];
    f.state.access = trainingAccess({...f.user,permissions:new Set(f.user.permissions)});
    await f.page.getByRole('button',{name:'Actualiser mes accès'}).click();
    await f.page.locator('.sui-training__module summary').filter({hasText:/^Devis ·/}).click();
    await expect(f.page.getByRole('button',{name:/Envoyer la proposition au client/})).toBeVisible();
    assert.equal(f.state.rows.get('team').completedChapterIds.length,before);
    f.user.permissions = ['quote:read:any','user:read:own'];
    f.state.access = trainingAccess({...f.user,permissions:new Set(f.user.permissions)});
    await f.page.getByRole('button',{name:'Actualiser mes accès'}).click();
    await expect(f.page.getByRole('button',{name:/Envoyer la proposition au client/})).toHaveCount(0);
    f.user.permissions.push('service:read:any');
    f.state.access = trainingAccess({...f.user,permissions:new Set(f.user.permissions)});
    await f.page.getByRole('button',{name:'Actualiser mes accès'}).click();
    await expect(f.page.locator('.sui-training__space')).toHaveCount(2);
    assert.equal(f.state.rows.get('team').completedChapterIds.length,before);
    f.state.failSave = true;
    await f.page.getByRole('button',{name:'Consulter le parcours terminé'}).click();
    await expect(f.page.getByRole('dialog').getByRole('alert')).toContainText('Sauvegarde indisponible');
    f.state.failAccess = true;
    await f.page.getByRole('button',{name:'Actualiser mes accès'}).click();
    await expect(f.page.locator('.sui-training__space')).toHaveCount(0);
    await expect(f.page.getByRole('dialog').getByRole('alert')).toContainText('Accès temporairement indisponibles');
    assertions++; await f.context.close();
  }
  console.log(`PASS : ${assertions} scénarios navigateur (7 rôles, ordinateur/mobile, quiz, sauvegarde, reprise, relancement, accès et erreurs).`);
} finally { await browser.close(); }
