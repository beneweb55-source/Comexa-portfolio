import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONSENT_VERSION,
  WHATSAPP_GRANT_SCOPES,
  describeConsent,
  evaluateConsent,
  hasGrantedScope,
  isKnownGrantScope,
  normalizeGrantScopes,
  scopeLabel,
  type ConsentState,
} from './consent.js';

/**
 * CE QUE CES TESTS PROTEGENT.
 *
 * Le consentement est la SEULE chose qui distingue « envoyer depuis le telephone
 * de quelqu'un qui l'a accepte » de « envoyer depuis le telephone de quelqu'un
 * sans le lui avoir demande ». Chaque test correspond a une facon de se tromper :
 *
 *   - annoncer une autorisation retiree comme simplement perimee (le titulaire
 *     croit que son retrait n'a pas marche) ;
 *   - accepter un consentement pris sur une version precedente du texte (la
 *     capacite demandee n'y etait peut-etre pas) ;
 *   - accorder la lecture du repertoire a un compte qui n'a autorise que l'envoi.
 *
 * `describeConsent` est teste AUSSI, et pas seulement pour sa forme : ce texte est
 * celui qu'un tiers lit avant d'engager son numero. Un texte qui omettrait le
 * plafond d'envois ou la duree laisserait croire a une autorisation illimitee.
 */

/** Date figee : une regle qui depend de l'horloge du processus n'est pas testable. */
const NOW = new Date('2026-10-15T12:00:00.000Z');

function state(overrides: Partial<ConsentState> = {}): ConsentState {
  return {
    consentVersion: CONSENT_VERSION,
    consentAcceptedAt: new Date('2026-10-01T09:00:00.000Z'),
    consentExpiresAt: new Date('2026-12-31T23:59:59.000Z'),
    revokedAt: null,
    grantedScopes: ['message:send'],
    ...overrides,
  };
}

describe('evaluateConsent — ordre des controles', () => {
  it('accepte un consentement en vigueur', () => {
    assert.deepEqual(evaluateConsent(state(), NOW), { ok: true });
  });

  it('accepte une autorisation sans date d’expiration', () => {
    // `WHATSAPP_CONSENT_TTL` vide => aucune echeance. C'est un choix explicite,
    // pas un oubli : le test le fixe.
    assert.deepEqual(evaluateConsent(state({ consentExpiresAt: null }), NOW), { ok: true });
  });

  it('annonce REVOQUEE avant tout le reste', () => {
    // Une autorisation peut etre a la fois revoquee et perimee. Dire « perimee »
    // laisserait croire que le retrait n'a pas ete pris en compte — et le
    // titulaire rappellerait pour rien.
    const verdict = evaluateConsent(
      state({
        revokedAt: new Date('2026-10-10T08:00:00.000Z'),
        consentExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
        consentVersion: 'ancienne-version',
        consentAcceptedAt: null,
      }),
      NOW,
    );

    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.code, 'CONSENT_REVOKED');
  });

  it('annonce MANQUANTE quand aucune acceptation n’est enregistree', () => {
    const verdict = evaluateConsent(state({ consentAcceptedAt: null }), NOW);

    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.code, 'CONSENT_MISSING');
  });

  it('annonce PERIMEE a l’echeance atteinte, pas seulement depassee', () => {
    // `>=` et non `>` : a la seconde meme de l'echeance, l'autorisation est
    // terminee. Un envoi accepte exactement a cette seconde partirait depuis un
    // numero dont l'autorisation vient de s'eteindre.
    const verdict = evaluateConsent(state({ consentExpiresAt: NOW }), NOW);

    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.code, 'CONSENT_EXPIRED');
  });

  it('annonce OBSOLETE quand la version du texte a change', () => {
    const verdict = evaluateConsent(state({ consentVersion: '2020-01-01.1' }), NOW);

    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.code, 'CONSENT_OUTDATED');
      assert.match(verdict.message, /2020-01-01\.1/, 'la version acceptee doit etre nommee');
      assert.match(
        verdict.message,
        new RegExp(CONSENT_VERSION.replace(/\./g, '\\.')),
        'la version en vigueur doit etre nommee',
      );
    }
  });

  it('place l’echeance avant la version : perimee est la reponse utile', () => {
    const verdict = evaluateConsent(
      state({ consentExpiresAt: new Date('2026-01-01T00:00:00.000Z'), consentVersion: 'ancienne' }),
      NOW,
    );

    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.code, 'CONSENT_EXPIRED');
  });
});

describe('hasGrantedScope — une capacite, pas toutes', () => {
  it('accepte une capacite accordee', () => {
    assert.deepEqual(hasGrantedScope({ grantedScopes: ['message:send'] }, 'message:send'), {
      ok: true,
    });
  });

  it('refuse la lecture du repertoire quand seul l’envoi est accorde', () => {
    // LE CAS CONCRET : copier le repertoire d'un telephone recueille les donnees
    // de personnes qui n'ont rien demande. Sans acceptation explicite, non.
    const verdict = hasGrantedScope({ grantedScopes: ['message:send'] }, 'contact:read');

    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.code, 'SCOPE_NOT_GRANTED');
      assert.match(verdict.message, /contact:read/, 'la capacite manquante doit etre nommee');
    }
  });

  it('refuse quand aucune capacite n’est enregistree', () => {
    const verdict = hasGrantedScope({ grantedScopes: [] }, 'message:send');

    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.code, 'SCOPE_NOT_GRANTED');
  });
});

describe('normalizeGrantScopes', () => {
  it('conserve les capacites connues, dans l’ordre demande', () => {
    // L'ordre est CELUI DE L'APPELANT, pas celui du catalogue : le texte de
    // consentement liste les capacites dans l'ordre de la demande, donc un
    // tri implicite ici reordonnerait ce que le tiers lit sans raison.
    assert.deepEqual(normalizeGrantScopes(['contact:read', 'message:send']), [
      'contact:read',
      'message:send',
    ]);
    assert.deepEqual(normalizeGrantScopes(['message:send', 'contact:read']), [
      'message:send',
      'contact:read',
    ]);
  });

  it('ignore une capacite inconnue au lieu de la recopier', () => {
    // Une colonne TEXT[] peut recevoir n'importe quoi (migration, correction
    // manuelle). Recopier `contact:delete` ferait croire a une capacite que le
    // code ne sait pas exercer — et qu'un test de perimetre ne couvrirait jamais.
    assert.deepEqual(normalizeGrantScopes(['message:send', 'contact:delete']), ['message:send']);
  });

  it('retombe sur l’envoi seul quand rien ne subsiste', () => {
    assert.deepEqual(normalizeGrantScopes([]), ['message:send']);
    assert.deepEqual(normalizeGrantScopes(undefined), ['message:send']);
    assert.deepEqual(normalizeGrantScopes(['inconnu']), ['message:send']);
  });

  it('dedoublonne', () => {
    assert.deepEqual(normalizeGrantScopes(['message:send', 'message:send']), ['message:send']);
  });
});

describe('isKnownGrantScope et scopeLabel', () => {
  it('reconnait exactement le catalogue', () => {
    for (const scope of WHATSAPP_GRANT_SCOPES) {
      assert.equal(isKnownGrantScope(scope), true, `${scope} doit etre connu`);
      assert.ok(scopeLabel(scope).length > 0, `${scope} doit avoir un libelle`);
    }

    assert.equal(isKnownGrantScope('contact:delete'), false);
    assert.equal(isKnownGrantScope(''), false);
  });

  it('ne laisse aucune capacite sans libelle', () => {
    // Un libelle manquant rendrait `undefined` dans le texte de consentement :
    // le tiers lirait une phrase trouee juste avant d'engager son numero.
    for (const scope of WHATSAPP_GRANT_SCOPES) {
      assert.equal(typeof scopeLabel(scope), 'string');
      assert.ok(!scopeLabel(scope).includes('undefined'), scope);
    }
  });
});

describe('describeConsent — le texte lu par le tiers', () => {
  it('nomme le demandeur, les capacites et le plafond', () => {
    const text = describeConsent({
      requestedBy: 'Karim Benali',
      scopes: ['message:send'],
      maxMessagesPerHour: 40,
    });

    assert.match(text, /Karim Benali/);
    assert.match(text, /message:send|envoi/i);
    assert.match(text, /40/, 'le plafond doit etre chiffre');
  });

  it('nomme le tiers quand il est connu', () => {
    const text = describeConsent({
      requestedBy: 'Karim Benali',
      delegatorName: 'Amina Haddad',
      scopes: ['message:send'],
    });

    assert.match(text, /Amina Haddad/);
  });

  it('annonce l’echeance quand il y en a une, et son absence sinon', () => {
    const withExpiry = describeConsent({
      requestedBy: 'Karim Benali',
      scopes: ['message:send'],
      expiresAt: new Date('2027-01-15T00:00:00.000Z'),
    });
    const withoutExpiry = describeConsent({
      requestedBy: 'Karim Benali',
      scopes: ['message:send'],
    });

    assert.match(withExpiry, /2027-01-15/);
    assert.ok(
      !withoutExpiry.includes('2027-01-15'),
      'sans echeance, aucune date ne doit apparaitre',
    );
  });

  it('annonce la capacite de lire le repertoire quand elle est demandee', () => {
    // C'est la capacite la plus sensible : elle doit etre LISIBLE dans le texte,
    // pas noyee dans une liste de codes.
    const text = describeConsent({
      requestedBy: 'Karim Benali',
      scopes: ['message:send', 'contact:read'],
    });

    assert.match(text, /contact|repertoire/i);
  });

  it('mentionne la version du texte', () => {
    // La version est ce qui rend un consentement obsolete quand le texte change :
    // un texte qui ne l'affiche pas empeche le tiers de verifier ce qu'il accepte.
    const text = describeConsent({ requestedBy: 'Karim Benali', scopes: ['message:send'] });

    assert.ok(text.includes(CONSENT_VERSION), `version absente du texte : ${text.slice(0, 200)}`);
  });

  it('avertit du risque de suspension du numero', () => {
    // CETTE PHRASE EST LA RAISON D'ETRE DU TEXTE. Connecter un compte personnel a
    // un automate est contraire aux conditions de WhatsApp et peut couter le
    // numero definitivement. Un consentement qui ne le dit pas n'est pas un
    // consentement : c'est une surprise.
    const text = describeConsent({ requestedBy: 'Karim Benali', scopes: ['message:send'] });

    assert.match(text, /conditions d.utilisation/i);
    assert.match(text, /WhatsApp/);
    assert.match(text, /suspension/i);
  });

  it('dit que les messages partent du numero du titulaire', () => {
    // La difference avec un envoi « depuis Comexa » : le destinataire voit un
    // message de la personne. Le tiers doit le savoir avant d'accepter.
    const text = describeConsent({ requestedBy: 'Karim Benali', scopes: ['message:send'] });

    assert.match(text, /DE VOTRE NUMERO/);
  });

  it('annonce la revocation et la suppression des contacts copies', () => {
    const text = describeConsent({
      requestedBy: 'Karim Benali',
      scopes: ['message:send', 'contact:read'],
    });

    assert.match(text, /retirer cette autorisation/);
    assert.match(text, /supprimes/);
  });

  it('n’annonce pas la lecture des contacts quand elle n’est pas demandee', () => {
    // Le texte dit explicitement que la conversation n'est pas lue. Si la
    // capacite n'est pas demandee, annoncer quand meme une copie du repertoire
    // ferait accepter plus que ce qui sera exerce — et l'inverse, en demander
    // une sans la nommer, serait une collecte cachee.
    const text = describeConsent({ requestedBy: 'Karim Benali', scopes: ['message:send'] });

    assert.ok(
      !text.includes('lire et copier la liste de vos contacts'),
      'la capacite contact:read ne doit pas apparaitre si elle n’est pas demandee',
    );
  });
});
