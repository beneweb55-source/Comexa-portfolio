import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALL_PERMISSION_CODES } from './permissions.catalogue.js';
import {
  INTEGRATION_MANAGED_CODES,
  INTEGRATION_TOKEN_PREFIX,
  MAX_INTEGRATION_SCOPES,
  displayPrefixOf,
  generateIntegrationToken,
  hashIntegrationToken,
  integrationEmailFor,
  integrationTokenMatches,
  isIntegrationTokenExpired,
  isValidIntegrationName,
  claimsIntegrationToken,
  looksLikeIntegrationToken,
  normalizeIntegrationScopes,
  slugifyIntegrationName,
} from './integration-token.js';

/** Catalogue factice : le module ne doit pas dependre du vrai catalogue. */
const CATALOGUE = new Set([
  'task:read:any',
  'task:write:any',
  'project:read:any',
  'integration:read:any',
  'integration:manage:any',
]);

describe('generation d’un jeton d’integration', () => {
  it('produit un jeton prefixe, long et aleatoire', () => {
    const token = generateIntegrationToken();

    assert.ok(token.startsWith(INTEGRATION_TOKEN_PREFIX), token);
    assert.ok(looksLikeIntegrationToken(token), token);
    // 32 octets en base64url : 43 caracteres apres le prefixe.
    assert.equal(token.length, INTEGRATION_TOKEN_PREFIX.length + 43);
  });

  it('ne produit JAMAIS deux fois le meme jeton', () => {
    // LE TEST DU SCENARIO REDOUTE : deux integrations qui partagent un secret
    // pourraient agir l'une pour l'autre, et la revocation de l'une couperait
    // l'autre sans que personne ne comprenne pourquoi.
    const drawn = new Set(Array.from({ length: 200 }, () => generateIntegrationToken()));

    assert.equal(drawn.size, 200);
  });
});

describe('reconnaissance de la forme d’un jeton', () => {
  it('accepte un jeton bien forme', () => {
    assert.equal(looksLikeIntegrationToken(generateIntegrationToken()), true);
  });

  it('refuse un JWT, une chaine vide et une saisie bidon', () => {
    // Sans ce tri, chaque requete sans session declencherait un hachage et une
    // lecture en base — y compris pour le JWT d'un utilisateur.
    for (const value of [
      '',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.signature',
      'cxi_',
      'cxi_trop-court',
      `cxi_${'a'.repeat(43)}!`, // caractere interdit
      'Bearer cxi_abc',
      undefined as unknown as string,
      null as unknown as string,
    ]) {
      assert.equal(looksLikeIntegrationToken(value), false, String(value));
    }
  });

  it('n’est pas dupe par un prefixe seul', () => {
    assert.equal(looksLikeIntegrationToken('cxi_' + 'a'.repeat(10)), false);
  });
});

describe('routage d’un jeton d’integration', () => {
  it('reconnait le prefixe, meme quand la forme est fausse', () => {
    // Le ROUTAGE se fait sur le prefixe : un jeton tronque ou corrompu doit
    // etre refuse par le chemin des integrations (« jeton d’integration
    // invalide »), et non passer par la verification JWT, qui ne parlerait
    // que d’un « jeton invalide » sans dire quoi corriger.
    assert.equal(claimsIntegrationToken('cxi_ceci-nest-pas-un-jeton'), true);
    assert.equal(claimsIntegrationToken('cxi_'), true);
    assert.equal(claimsIntegrationToken(generateIntegrationToken()), true);
  });

  it('ne confond pas un JWT ni une session', () => {
    for (const value of [
      '',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.signature',
      'Bearer cxi_abc',
      undefined as unknown as string,
      null as unknown as string,
    ]) {
      assert.equal(claimsIntegrationToken(value), false, String(value));
    }
  });
});

describe('empreinte et comparaison', () => {
  it('ne stocke jamais le jeton lui-meme', () => {
    const token = generateIntegrationToken();
    const hash = hashIntegrationToken(token);

    assert.equal(hash.includes(token), false);
    assert.equal(hash.length, 64, 'sha256 en hexadecimale');
  });

  it('reconnait le bon jeton et refuse les autres', () => {
    const token = generateIntegrationToken();
    const hash = hashIntegrationToken(token);

    assert.equal(integrationTokenMatches(token, hash), true);
    assert.equal(integrationTokenMatches(generateIntegrationToken(), hash), false);
    assert.equal(integrationTokenMatches(token.slice(0, -1) + 'x', hash), false);
  });

  it('rend une decision fiable face a une empreinte de longueur inattendue', () => {
    // `timingSafeEqual` LEVE sur deux tailles differentes : sans la garde, une
    // empreinte corrompue en base deviendrait une erreur 500 au lieu d'un 401.
    const token = generateIntegrationToken();

    assert.equal(integrationTokenMatches(token, 'xyz'), false);
    assert.equal(integrationTokenMatches(token, ''), false);
    assert.equal(integrationTokenMatches(token, 'a'.repeat(128)), false);
  });

  it('donne la meme empreinte pour le meme jeton (determinisme)', () => {
    const token = 'cxi_' + 'a'.repeat(43);

    assert.equal(hashIntegrationToken(token), hashIntegrationToken(token));
  });
});

describe('affichage et comptes techniques', () => {
  it('n’expose qu’un fragment court du jeton', () => {
    const token = generateIntegrationToken();
    const shown = displayPrefixOf(token);

    assert.ok(shown.startsWith(INTEGRATION_TOKEN_PREFIX));
    assert.ok(shown.length < token.length / 2, 'le fragment doit rester court');
  });

  it('fabrique un courriel inutilisable pour se connecter', () => {
    // Le domaine `.invalid` est reserve : aucun compte technique ne peut recevoir
    // de courriel ni se connecter par le formulaire, meme avec un mot de passe.
    assert.equal(integrationEmailFor('n8n-production'), 'n8n-production@integrations.invalid');
    assert.equal(integrationEmailFor('Agent Veille'), 'agent-veille@integrations.invalid');
  });

  it('normalise un nom accentue en identifiant sûr', () => {
    assert.equal(slugifyIntegrationName('Agent Véille ÏA'), 'agent-veille-ia');
    assert.equal(slugifyIntegrationName('  n8n__Prod  '), 'n8n-prod');
  });

  it('n’accepte qu’un nom reconnaissable', () => {
    for (const name of ['n8n-production', 'agent-veille', 'n8n2']) {
      assert.equal(isValidIntegrationName(name), true, name);
    }
    for (const name of ['', 'a', 'N8n', 'n8n production', 'n8n_prod', 'très-long'.repeat(10)]) {
      assert.equal(isValidIntegrationName(name), false, name);
    }
  });
});

describe('expiration', () => {
  it('sans date d’expiration, le jeton ne perime jamais', () => {
    assert.equal(isIntegrationTokenExpired(null), false);
    assert.equal(isIntegrationTokenExpired(undefined), false);
  });

  it('a l’instant de l’expiration, le jeton ne passe plus', () => {
    const now = new Date('2026-10-13T10:00:00.000Z');

    // Encore valide : l'echeance est APRES maintenant.
    assert.equal(isIntegrationTokenExpired(new Date('2026-10-13T10:00:00.001Z'), now), false);
    // A l'instant exact, le jeton tombe : une tolerance d'une seconde serait une
    // seconde ou un jeton qu'on croit coupe fonctionne encore.
    assert.equal(isIntegrationTokenExpired(new Date('2026-10-13T10:00:00.000Z'), now), true);
    assert.equal(isIntegrationTokenExpired(new Date('2026-10-13T09:59:59.999Z'), now), true);
  });

  it('traite une date illisible comme perimee (echec ferme)', () => {
    assert.equal(isIntegrationTokenExpired('pas-une-date'), true);
  });
});

describe('permissions accordees a un jeton', () => {
  it('epure, dedoublonne et trie les ports demandes', () => {
    const result = normalizeIntegrationScopes(
      ['task:write:any', ' task:read:any ', 'task:read:any', ''],
      CATALOGUE,
    );

    assert.deepEqual(result, { ok: true, scopes: ['task:read:any', 'task:write:any'] });
  });

  it('REFUSE un code inconnu au lieu de l’ignorer', () => {
    // Un code inconnu ignore donnerait un jeton qui a l'air autorise et ne peut
    // rien faire — ou, pire, qui correspondrait plus tard a une vraie permission.
    const result = normalizeIntegrationScopes(['task:read:any', 'task:reed:any'], CATALOGUE);

    assert.deepEqual(result, { ok: false, unknown: ['task:reed:any'], forbidden: [] });
  });

  it('REFUSE qu’une machine distribue des acces', () => {
    // Sans cette regle, un jeton vole dans un workflow permettrait de s'en creer
    // d'autres, et la revocation ne servirait plus a rien.
    const result = normalizeIntegrationScopes(
      ['task:read:any', 'integration:manage:any'],
      CATALOGUE,
    );

    assert.deepEqual(result, {
      ok: false,
      unknown: [],
      forbidden: ['integration:manage:any'],
    });
  });

  it('refuse une liste vide de permissions', () => {
    const result = normalizeIntegrationScopes([], CATALOGUE);

    assert.deepEqual(result, { ok: true, scopes: [] });
  });

  it('accepte l’integralite des permissions attribuables du catalogue', () => {
    // LE TEST QUI MANQUAIT AVEC L'ANCIEN PLAFOND. A 40, un jeton ne pouvait
    // porter qu'un tiers du catalogue : une integration d'agence — projets,
    // taches, agenda, CRM et facturation — devait choisir ce qu'elle abandonnait.
    // Le plafond est donc verifie ici contre la REALITE du catalogue, et non
    // contre une liste de codes fictifs inventes pour le test.
    const managed = new Set(INTEGRATION_MANAGED_CODES);
    const assignable = ALL_PERMISSION_CODES.filter((code) => !managed.has(code));

    assert.ok(
      assignable.length <= MAX_INTEGRATION_SCOPES,
      `${assignable.length} permissions attribuables pour un plafond de ${MAX_INTEGRATION_SCOPES}`,
    );

    const result = normalizeIntegrationScopes(assignable, ALL_PERMISSION_CODES);

    assert.deepEqual(result, { ok: true, scopes: [...assignable].sort() });
    assert.equal(result.ok === true && result.scopes.length, assignable.length);
  });

  it('refuse tout de meme les deux codes d’administration du catalogue reel', () => {
    // Le catalogue entier passe, mais JAMAIS les deux codes qui permettraient a
    // une machine de se remplacer elle-meme : la regle des droits refuses est
    // independante du plafond.
    const result = normalizeIntegrationScopes(ALL_PERMISSION_CODES, ALL_PERMISSION_CODES);

    assert.equal(result.ok, false);
    assert.deepEqual(result.ok === false && result.forbidden, [...INTEGRATION_MANAGED_CODES]);
  });

  it('plafonne le nombre de permissions', () => {
    // Le plafond borne toujours une liste absurde : il refuse, il ne tronque
    // jamais en silence.
    const tooMany = new Set<string>();
    for (let i = 0; i < MAX_INTEGRATION_SCOPES + 1; i += 1) tooMany.add(`permission:fictive:${i}`);
    const result = normalizeIntegrationScopes([...tooMany], new Set([...CATALOGUE, ...tooMany]));

    assert.equal(result.ok, false);
  });

  it('accepte exactement le plafond, et une seule permission de plus que lui', () => {
    const atCeiling = new Set<string>();
    for (let i = 0; i < MAX_INTEGRATION_SCOPES; i += 1) atCeiling.add(`permission:fictive:${i}`);
    const catalogue = new Set([...CATALOGUE, ...atCeiling]);

    // Juste AU plafond : accepte. Au-dessus : refuse. La frontiere est
    // verifiee des deux cotes, sinon un `>` ecrit `>=` ne se verrait pas.
    assert.equal(normalizeIntegrationScopes([...atCeiling], catalogue).ok, true);

    const oneMore = [...atCeiling, 'permission:fictive:supplementaire'];
    assert.equal(
      normalizeIntegrationScopes(oneMore, new Set([...catalogue, ...oneMore])).ok,
      false,
    );
  });
});
