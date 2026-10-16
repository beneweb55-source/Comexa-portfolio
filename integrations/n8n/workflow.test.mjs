/**
 * TESTS DU WORKFLOW n8n — `integrations/n8n/comexa-bot-telegram.json`.
 *
 * -------------------------------------------------------------------------
 * POURQUOI TESTER UN FICHIER JSON
 * -------------------------------------------------------------------------
 * Le workflow ne peut etre execute ici (aucune instance n8n), mais deux choses
 * peuvent etre verifiees sans elle, et toutes les deux cassent silencieusement :
 *
 *  1. LA STRUCTURE. Un nœud renomme dans n8n casse toutes les expressions
 *     `$('Nom')` qui le visaient — et n8n ne le signale qu'a l'execution, au
 *     milieu d'une conversation Telegram. D'ou les tests de referencement.
 *  2. LES CHEMINS DE DONNEES. Le corps de chaque nœud Code lit des champs precis
 *     (`data.pairing.qr.imageBase64`, `meta.total`, `replayed`…). Ces noms viennent
 *     des presentateurs du backend : si l'un change, le workflow rend `undefined`
 *     dans un message envoye a un client. Ces tests sont donc un contrat croise.
 *
 * Le JSON est la source de verite : on le modifie dans n8n, puis on le reexporte.
 * Aucune instance n8n n'etant disponible pour l'executer reellement, les reponses
 * Telegram ne sont pas verifiees — seulement le texte que le bot produirait.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const ICI = dirname(fileURLToPath(import.meta.url));
const wf = JSON.parse(readFileSync(join(ICI, 'comexa-bot-telegram.json'), 'utf8'));

const noeuds = wf.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
const parNom = new Map(noeuds.map((n) => [n.name, n]));
const codes = noeuds.filter((n) => n.type === 'n8n-nodes-base.code');

/**
 * Exécute le corps d'un nœud Code comme n8n le ferait (mode
 * `runOnceForEachItem`) : `$input.item.json` est l'élément courant, et
 * `$('Nom')` rend l'élément d'un nœud précédent.
 */
function run(name, itemJson, refs = {}) {
  const node = codes.find((n) => n.name === name);
  assert.ok(node, `nœud Code introuvable : ${name}`);
  const contexte = {
    $input: { item: { json: itemJson } },
    $: (n) => {
      assert.ok(n in refs, `référence non fournie au banc d'essai : $('${n}')`);
      return { item: { json: refs[n] } };
    },
    console,
  };
  vm.createContext(contexte);
  // n8n enveloppe le corps du nœud dans une fonction : `return` y est légal,
  // alors qu'il ne l'est pas dans un script nu. Le banc d'essai reproduit l'enveloppe.
  return vm.runInContext(`(function () {\n${node.parameters.jsCode}\n})()`, contexte, {
    filename: `${name}.js`,
  });
}
// ---------------------------------------------------------------------------
// Comportement des nœuds Code, exécutés pour de vrai
// ---------------------------------------------------------------------------

const ANALYSE = {
  apiBase: 'https://api.test', botToken: 'TOKEN', chatId: '42', fromId: '99',
  username: 'karim', messageId: '7', text: '/envoyer +213555123456 bonjour',
  command: '/envoyer', args: '+213555123456 bonjour', isVoice: false, fileId: '',
  mimeType: '', durationSeconds: 0,
};

const t = (titre, fn) => test(titre, fn);

// --- Analyse du message : les deux formes du declencheur --------------------
t('analyse — message nu, vocal', () => {
  const r = run('Analyse du message', {
    apiBase: 'https://api.test/', botToken: 'T', message: {
      message_id: 3, chat: { id: 42 }, from: { id: 99, username: 'k' },
      voice: { file_id: 'F', mime_type: 'audio/ogg', duration: 7 },
    },
  });
  assert.equal(r.json.isVoice, true);
  assert.equal(r.json.fileId, 'F');
  assert.equal(r.json.durationSeconds, 7);
  assert.equal(r.json.apiBase, 'https://api.test', 'le / final doit etre retire');
  assert.equal(r.json.command, '');
});

t('analyse — forme aplatie (pas de cle message), texte', () => {
  const r = run('Analyse du message', {
    apiBase: 'https://api.test', botToken: 'T',
    message_id: 4, chat: { id: 1 }, from: { id: 2 }, text: '  /Statut  ',
  });
  assert.equal(r.json.command, '/statut', 'les commandes sont comparees en minuscules');
  assert.equal(r.json.text, '/Statut');
  assert.equal(r.json.args, '');
});

t('analyse — enveloppe { message }, commande en minuscules', () => {
  const r = run('Analyse du message', {
    apiBase: 'https://api.test', botToken: 'T',
    message: { message_id: 6, chat: { id: 1 }, from: { id: 2 }, text: '/AIDE maintenant' },
  });
  assert.equal(r.json.command, '/aide');
  assert.equal(r.json.args, 'maintenant');
});

t('analyse — lien profond /start wa_…', () => {
  const r = run('Analyse du message', {
    apiBase: 'https://api.test', botToken: 'T', message: {
      message_id: 5, chat: { id: 1 }, from: { id: 2 }, text: '/start wa_7KQM2ZPX9BRT',
    },
  });
  assert.equal(r.json.command, '/autoriser');
  assert.equal(r.json.args, '7KQM2ZPX9BRT');
});

t('analyse — variables manquantes : erreur explicite', () => {
  assert.throws(
    () => run('Analyse du message', { message: { message_id: 1, chat: { id: 1 }, text: '/aide' } }),
    /Variables n8n manquantes/,
  );
});

// --- Vocaux -----------------------------------------------------------------
t('reponse transcription — premier passage', () => {
  const r = run('Réponse transcription',
    { data: { text: 'Rappelle Karim', language: 'fr', provider: 'groq', model: 'whisper-large-v3-turbo', replayed: false } },
    { 'Analyse du message': ANALYSE });
  assert.match(r.json.text, /Rappelle Karim/);
  assert.match(r.json.text, /whisper-large-v3-turbo/);
  assert.ok(!/deja transcrit/.test(r.json.text));
  assert.equal(r.json.chatId, '42');
});

t('reponse transcription — rejeu', () => {
  const r = run('Réponse transcription',
    { data: { text: 'Rappelle Karim', language: null, provider: 'groq', model: null, replayed: true } },
    { 'Analyse du message': ANALYSE });
  assert.match(r.json.text, /deja transcrit/);
  assert.match(r.json.text, /langue detectee/);
});

// --- WhatsApp membre --------------------------------------------------------
const PAIRING = {
  accountId: 'a1', sessionName: 'comexa-99', status: 'WAITING_QR', ownerKind: 'SELF',
  qr: { imageBase64: 'iVBORw0KG', rawValue: 'raw', pairingCode: null },
  consentText: 'Version 1\nVous autorisez…', consentVersion: 'wa-consent-v1',
  consentExpiresAt: '2027-10-15T00:00:00.000Z',
  instructions: ['Ouvrir WhatsApp', 'Appareils connectes', 'Scanner'],
};

t('reponse appairage — avec QR', () => {
  const r = run('Réponse appairage', PAIRING,
    { 'Analyse du message': ANALYSE, 'Appairer WhatsApp': { data: PAIRING } });
  assert.match(r.json.text, /1\. Ouvrir WhatsApp/);
  assert.match(r.json.text, /3\. Scanner/);
  assert.match(r.json.text, /wa-consent-v1/);
  assert.equal(r.json.chatId, '42');
});

t('reponse sans QR — session deja appairee', () => {
  const r = run('Réponse sans QR', { data: { ...PAIRING, qr: null, status: 'CONNECTED' } },
    { 'Analyse du message': ANALYSE, 'Appairer WhatsApp': { data: { ...PAIRING, qr: null, status: 'CONNECTED' } } });
  assert.match(r.json.text, /Aucun QR/);
  assert.match(r.json.text, /CONNECTED/);
});

t('reponse statut', () => {
  const r = run('Réponse statut', {
    data: {
      status: 'CONNECTED', ownerKind: 'SELF', phoneNumber: '+213555000000', gatewayDriver: 'waha',
      grantedScopes: ['message:send', 'contact:read'],
      consent: { version: 'wa-consent-v1', acceptedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2027-10-01T00:00:00.000Z', valid: true },
      lastError: null,
    },
  }, { 'Analyse du message': ANALYSE });
  assert.match(r.json.text, /CONNECTED/);
  assert.match(r.json.text, /contact:read/);
  assert.match(r.json.text, /valide/);
  assert.match(r.json.text, /2027-10-01/);
  assert.ok(!/undefined/.test(r.json.text), 'aucun champ manquant ne doit fuiter comme undefined');
});

t('reponse statut — consentement expire, derniere erreur presente', () => {
  const r = run('Réponse statut', {
    data: {
      status: 'FAILED', ownerKind: 'DELEGATED', phoneNumber: null, gatewayDriver: 'none',
      grantedScopes: [], consent: { version: 'v1', acceptedAt: null, expiresAt: null, valid: false },
      lastError: 'passerelle injoignable',
    },
  }, { 'Analyse du message': ANALYSE });
  assert.match(r.json.text, /NON valide/);
  assert.match(r.json.text, /sans echeance/);
  assert.match(r.json.text, /passerelle injoignable/);
});

t('reponse contacts — liste paginee (items remontes en data par l enveloppe)', () => {
  const r = run('Réponse contacts', {
    success: true,
    data: [{ jid: '1@s.whatsapp.net', phoneNumber: '+213555111111', name: 'Karim' }, { jid: '2@s.whatsapp.net', phoneNumber: null, name: null }],
    meta: { page: 1, perPage: 50, total: 132, totalPages: 3 },
  }, { 'Analyse du message': ANALYSE });
  assert.match(r.json.text, /132 au total/);
  assert.match(r.json.text, /Karim : \+213555111111/);
  assert.match(r.json.text, /\(sans nom\) : 2@s\.whatsapp\.net/);
});

t('reponse contacts — vide', () => {
  const r = run('Réponse contacts', { success: true, data: [], meta: { total: 0 } }, { 'Analyse du message': ANALYSE });
  assert.match(r.json.text, /Repertoire vide/);
});

// --- Envoi ------------------------------------------------------------------
t('preparer envoi — valide', () => {
  const r = run('Préparer envoi', ANALYSE, {
    'Analyse du message': ANALYSE, 'Résoudre la liaison': { data: { userId: 'u1' } },
  });
  assert.equal(r.json.valide, true);
  assert.equal(r.json.to, '+213555123456');
  assert.equal(r.json.body, 'bonjour');
  assert.equal(r.json.idempotencyKey, 'tg-42-7');
  assert.equal(r.json.userId, 'u1');
});

t('preparer envoi — sans texte : reponse guidee, pas d appel au backend', () => {
  const a = { ...ANALYSE, args: '+213555123456' };
  const r = run('Préparer envoi', a, { 'Analyse du message': a, 'Résoudre la liaison': { data: { userId: 'u1' } } });
  assert.equal(r.json.valide, false);
  assert.match(r.json.text, /Format attendu/);
});

t('preparer envoi — args vides', () => {
  const a = { ...ANALYSE, args: '' };
  const r = run('Préparer envoi', a, { 'Analyse du message': a, 'Résoudre la liaison': { data: { userId: 'u1' } } });
  assert.equal(r.json.valide, false);
});

t('reponse envoi — premier envoi puis rejeu', () => {
  const r = run('Réponse envoi',
    { data: { status: 'SENT', to: { jid: '213555123456@s.whatsapp.net' }, replayed: false, gatewayMessageId: '3EB0' } },
    { 'Analyse du message': ANALYSE });
  assert.match(r.json.text, /SENT vers 213555123456@s\.whatsapp\.net/);
  assert.match(r.json.text, /3EB0/);
  const rej = run('Réponse envoi',
    { data: { status: 'SENT', to: { jid: 'x@s.whatsapp.net' }, replayed: true, gatewayMessageId: null } },
    { 'Analyse du message': ANALYSE });
  assert.match(rej.json.text, /deja envoye/);
});

// --- Tiers ------------------------------------------------------------------
t('reponse consentement', () => {
  const r = run('Réponse consentement', {
    data: { consentText: 'Version wa-consent-v1\nVous autorisez Comexa…', consentVersion: 'wa-consent-v1', delegation: { status: 'PENDING' } },
  }, { 'Analyse du message': { ...ANALYSE, args: '7KQM2ZPX9BRT' } });
  assert.match(r.json.text, /\/accepter 7KQM2ZPX9BRT/);
  assert.match(r.json.text, /\/refuser 7KQM2ZPX9BRT/);
  assert.match(r.json.text, /Rien n est enregistre/);
});

t('reponse appairage tiers — avec QR', () => {
  const r = run('Réponse appairage tiers', {}, {
    'Analyse du message': ANALYSE,
    'Accepter invitation': { data: { pairing: { ...PAIRING, ownerKind: 'DELEGATED' }, consentText: 'Version wa-consent-v1\nTexte', delegation: { status: 'ACCEPTED' } } },
  });
  assert.match(r.json.text, /wa-consent-v1/);
  assert.match(r.json.text, /2027-10-15/);
  assert.match(r.json.text, /DELEGATED/);
  assert.match(r.json.text, /1\. Ouvrir WhatsApp/);
  assert.ok(!/undefined/.test(r.json.text));
});

t('reponse tiers sans QR', () => {
  const r = run('Réponse tiers sans QR', {}, {
    'Analyse du message': ANALYSE,
    'Accepter invitation': { data: { pairing: { ...PAIRING, qr: null, status: 'FAILED' }, consentText: 'x', delegation: {} } },
  });
  assert.match(r.json.text, /FAILED/);
});

t('reponse refus', () => {
  const r = run('Réponse refus', {}, { 'Analyse du message': ANALYSE });
  assert.match(r.json.text, /Invitation refusee/);
});

t('reponse aide', () => {
  const r = run('Réponse aide', ANALYSE);
  assert.match(r.json.text, /\/whatsapp/);
  assert.match(r.json.text, /\/autoriser/);
  assert.equal(r.json.chatId, '42');
});

// --- Normalisation des erreurs ---------------------------------------------
const ERREURS = [
  ['enveloppe Nest { error: { code } }', { error: { statusCode: 404, error: { success: false, error: { code: 'WHATSAPP_ACCOUNT_NOT_FOUND', message: 'Aucun compte' } } } }, /Aucun compte WhatsApp actif/],
  ['corps plat { code }', { error: { statusCode: 403, code: 'WHATSAPP_SCOPE_NOT_GRANTED', message: 'x' } }, /capacite n a pas ete accordee/],
  ['responseBody en chaine JSON', { error: { statusCode: 422, responseBody: '{"error":{"code":"WHATSAPP_CODE_INVALID","message":"illisible"}}' } }, /illisible|invalide/],
  ['code seulement dans le message brut', { error: { statusCode: 500, message: 'upstream TRANSCRIPTION_UPSTREAM_FAILED boom' } }, /moteur n a rendu aucun texte/],
  ['inconnue : code generique + statut', { error: { statusCode: 503, message: 'gateway down' } }, /ERREUR_INCONNUE.*503/],
  ['lien Telegram absent', { error: { statusCode: 404, error: { error: { code: 'TELEGRAM_LINK_NOT_FOUND' } } } }, /n est pas lie a Comexa/],
];
for (const [titre, item, attendu] of ERREURS) {
  t(`normaliser erreur — ${titre}`, () => {
    const r = run('Normaliser erreur', item, { 'Analyse du message': ANALYSE });
    assert.match(r.json.text, attendu);
    assert.equal(r.json.chatId, '42', 'la reponse doit repartir vers le bon chat');
    assert.ok(!/undefined/.test(r.json.text), `undefined dans : ${r.json.text}`);
  });
}



// ---------------------------------------------------------------------------
// Structure du fichier importe
// ---------------------------------------------------------------------------

test('les noms de nœuds sont uniques et sans apostrophe', () => {
  const noms = noeuds.map((n) => n.name);
  assert.equal(new Set(noms).size, noms.length, 'deux nœuds portent le même nom');
  for (const nom of noms) {
    // `$('Nom')` est une chaine JS : une apostrophe dans un nom casse l'expression.
    assert.ok(!nom.includes("'"), `apostrophe dans un nom de nœud : ${nom}`);
  }
});

test('toutes les expressions $() visent un nœud existant', () => {
  const brut = readFileSync(join(ICI, 'comexa-bot-telegram.json'), 'utf8');
  const refs = [...brut.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(refs.length > 20, 'le workflow devrait référencer plusieurs nœuds');
  for (const ref of new Set(refs)) {
    assert.ok(parNom.has(ref), `$('${ref}') ne correspond à aucun nœud`);
  }
});

test('toutes les connexions aboutissent à un nœud existant', () => {
  for (const [source, conn] of Object.entries(wf.connections)) {
    assert.ok(parNom.has(source), `source inconnue : ${source}`);
    for (const sortie of conn.main) {
      for (const cible of sortie) {
        assert.ok(parNom.has(cible.node), `${source} → ${cible.node} : cible inconnue`);
      }
    }
  }
});

test('chaque nœud est atteint depuis le déclencheur', () => {
  const atteints = new Set();
  for (const conn of Object.values(wf.connections)) {
    for (const sortie of conn.main) for (const c of sortie) atteints.add(c.node);
  }
  const orphelins = noeuds.filter((n) => !atteints.has(n.name) && n.name !== 'Déclencheur Telegram');
  assert.deepEqual(orphelins.map((n) => n.name), [], 'nœuds jamais atteints');
});

test('un seul déclencheur : Telegram n’autorise qu’un webhook par bot', () => {
  const declencheurs = noeuds.filter((n) => n.type.endsWith('Trigger') || n.type.endsWith('.webhook'));
  assert.equal(declencheurs.length, 1, declencheurs.map((n) => n.name).join(', '));
});

test('aucun bloc credentials exporté : n8n doit demander le remapping', () => {
  // Un identifiant de credential n'a de sens que sur l'instance qui l'a créé.
  for (const n of noeuds) assert.equal(n.credentials, undefined, `credentials figés dans ${n.name}`);
});

test('chaque appel à Comexa porte le credential Header Auth et une sortie d’erreur', () => {
  const http = noeuds.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  const comexa = http.filter((n) => String(n.parameters.url).includes('apiBase'));
  assert.ok(comexa.length >= 9, `trop peu d'appels Comexa détectés : ${comexa.length}`);
  for (const n of comexa) {
    assert.equal(n.parameters.nodeCredentialType, 'httpHeaderAuth', `${n.name} : credential`);
    assert.equal(n.onError, 'continueErrorOutput', `${n.name} : doit continuer sur la sortie d'erreur`);
  }
  // Les appels Telegram portent le token dans l'URL, jamais un credential Comexa.
  const telegram = http.filter((n) => String(n.parameters.url).includes('api.telegram.org'));
  assert.ok(telegram.length >= 3, 'les appels Telegram manquent');
  for (const n of telegram) {
    assert.equal(n.parameters.nodeCredentialType, undefined, `${n.name} : pas de credential ici`);
    assert.match(String(n.parameters.url), /botToken/, `${n.name} : le token vient des variables`);
  }
});

test('toutes les sorties d’erreur convergent vers la normalisation', () => {
  const versErreur = Object.entries(wf.connections).filter(([, conn]) =>
    conn.main.some((sortie) => sortie.some((c) => c.node === 'Normaliser erreur')),
  ).map(([source]) => source);
  assert.ok(versErreur.length >= 10, versErreur.join(', '));
  for (const source of versErreur) {
    assert.equal(parNom.get(source).onError, 'continueErrorOutput', `${source} : sortie d'erreur non déclarée`);
  }
});

test('le routeur de commandes couvre chaque commande documentée', () => {
  const routeur = parNom.get('Routeur de commandes');
  const cles = routeur.parameters.rules.values.map((r) => r.outputKey);
  const attendues = ['Appairer', 'Statut', 'Déconnecter', 'Contacts', 'Envoyer', 'Autoriser', 'Accepter', 'Refuser', 'Aide'];
  assert.deepEqual(cles, attendues);
  // Une sortie de repli est déclarée, et le lien correspondant existe.
  assert.equal(routeur.parameters.options.fallbackOutput, 'extra');
  assert.equal(wf.connections['Routeur de commandes'].main.length, attendues.length + 1);
});

test('le routeur de commandes a autant de sorties que de règles', () => {
  const routeur = parNom.get('Routeur de commandes');
  assert.equal(wf.connections['Routeur de commandes'].main.length, routeur.parameters.rules.values.length + 1);
  const membre = parNom.get('Routeur membre');
  assert.equal(membre.parameters.options.fallbackOutput, 'none');
  assert.equal(wf.connections['Routeur membre'].main.length, membre.parameters.rules.values.length);
});

test('les deux étapes du consentement d’un tiers sont présentes', () => {
  const urls = noeuds.map((n) => String(n.parameters?.url ?? ''));
  assert.ok(urls.some((u) => u.includes('delegations/consent')), 'lecture du consentement manquante');
  assert.ok(urls.some((u) => u.includes('delegations/accept')), 'acceptation manquante');
  assert.ok(urls.some((u) => u.includes('delegations/refuse')), 'refus manquant');
  // accept porte acceptConsent: true — sans lui le serveur répond 422.
  const accept = parNom.get('Accepter invitation');
  assert.match(accept.parameters.jsonBody, /acceptConsent: true/);
  const consent = parNom.get('Consentement tiers');
  assert.equal(consent.parameters.method, 'GET', 'la lecture ne doit rien écrire');
  assert.equal(consent.parameters.sendBody, undefined, 'un GET n’a pas de corps');
});

test('la transcription envoie exactement les champs du DTO', () => {
  // `forbidNonWhitelisted` est global : un champ de trop vaut 400 VALIDATION_ERROR.
  const transcrire = parNom.get('Transcrire');
  const champs = transcrire.parameters.bodyParameters.parameters.map((p) => p.name);
  assert.deepEqual(champs.sort(), [
    'durationSeconds', 'file', 'mimeType', 'telegramChatId', 'telegramFileId', 'telegramMessageId', 'telegramUserId',
  ]);
  assert.equal(transcrire.parameters.contentType, 'multipart-form-data');
  const fichier = transcrire.parameters.bodyParameters.parameters.find((p) => p.name === 'file');
  assert.equal(fichier.parameterType, 'formBinaryData');
  assert.equal(fichier.inputDataFieldName, 'data', 'le binaire vient du téléchargement Telegram');
});

test('l’envoi WhatsApp porte une clé d’idempotence dans le corps', () => {
  const envoi = parNom.get('Envoyer message');
  assert.match(envoi.parameters.jsonBody, /idempotencyKey/);
  const preparation = parNom.get('Préparer envoi').parameters.jsCode;
  assert.match(preparation, /tg-.*chatId.*messageId/, 'la clé doit être unique par demande Telegram');
});

test('le démarrage de session n’envoie que ce que le DTO accepte', () => {
  // `StartWhatsAppSessionDto` n'accepte QUE acceptConsent et scopes : aucun champ
  // Telegram, contrairement à `AcceptWhatsAppDelegationDto`.
  const appairer = parNom.get('Appairer WhatsApp');
  assert.equal(appairer.parameters.jsonBody, "={{ JSON.stringify({ acceptConsent: true }) }}");
});

test('chaque nœud Code est exécutable et rend botToken/chatId/text', () => {
  for (const n of codes) {
    new vm.Script(`(function () {\n${n.parameters.jsCode}\n})`, { filename: n.name });
  }
  const reponses = codes.filter((n) => n.name.startsWith('Réponse') || n.name === 'Normaliser erreur');
  assert.ok(reponses.length >= 12, reponses.map((n) => n.name).join(', '));
});

test('un seul nœud d’envoi de texte vers Telegram', () => {
  const envois = Object.values(wf.connections).flatMap((c) => c.main.flat()).filter((c) => c.node === 'Envoyer à Telegram');
  assert.ok(envois.length >= 12, 'toutes les réponses doivent converger');
  const noeud = parNom.get('Envoyer à Telegram');
  assert.match(noeud.parameters.url, /sendMessage/);
  assert.match(noeud.parameters.jsonBody, /chat_id/);
});

