import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COUNTRY_DIAL_CODES,
  DELEGATION_CODE_PREFIX,
  canonicalJid,
  phoneNumberFromJid,
  delegationCodeMatches,
  generateDelegationCode,
  hashDelegationCode,
  isUsableSessionName,
  looksLikeDelegationCode,
  normalizeDelegationCode,
  normalizePhoneNumber,
  resolveRecipient,
  sessionNameFor,
} from './whatsapp-identity.js';

/**
 * CE QUE CES TESTS PROTEGENT.
 *
 * Une seule regle domine tout le fichier : UN NUMERO MAL LU ENVOIE LE MESSAGE A
 * QUELQU'UN D'AUTRE. Aucun de ces tests ne verifie une comodite de saisie ; ils
 * verifient que ce qui est ambigu est REFUSE, et que ce qui est accepte produit
 * le bon JID.
 *
 * Le second enjeu est le code d'autorisation : il engage le telephone d'un tiers.
 * Sa forme doit survivre a une recopie manuelle (tirets, prefixe, majuscules)
 * SANS que deux codes differents produisent la meme empreinte.
 */

describe('normalizePhoneNumber — ce qui est accepte', () => {
  it('lit le format international avec +', () => {
    const result = normalizePhoneNumber('+213555123456');

    assert.ok(result.ok);
    assert.equal(result.phone, '213555123456');
    assert.equal(result.jid, '213555123456@s.whatsapp.net');
  });

  it('ignore les espaces, tirets et points', () => {
    // Un numero copie depuis une signature de courriel arrive avec sa ponctuation.
    // La refuser couterait un aller-retour ; l'accepter ne change rien au JID.
    const result = normalizePhoneNumber('+213 555-12.34.56');

    assert.ok(result.ok);
    assert.equal(result.phone, '213555123456');
  });

  it('ne devine pas ce que vaut un « (0) » dans un numero international', () => {
    // `+213 (0) 555…` est une ecriture fautive : le 0 de sortie nationale ne se
    // compose pas apres l'indicatif pays. Le retirer silencieusement donnerait le
    // bon numero ici, et un numero FAUX le jour ou le 0 fait vraiment partie du
    // numero. Aucun caractere n'est retire : la ponctuation oui, les chiffres non.
    const result = normalizePhoneNumber('+213 (0) 555-12.34.56');

    assert.ok(result.ok);
    assert.equal(result.phone, '2130555123456');
    assert.notEqual(result.ok && result.phone, '213555123456');
  });

  it('lit le format international avec 00', () => {
    const result = normalizePhoneNumber('00213555123456');

    assert.ok(result.ok);
    assert.equal(result.phone, '213555123456');
  });

  it('applique l’indicatif par defaut a un numero local commence par 0', () => {
    const result = normalizePhoneNumber('0555123456', 'DZ');

    assert.ok(result.ok);
    assert.equal(result.phone, '213555123456');
  });

  it('accepte un numero international sans + quand l’indicatif correspond', () => {
    const result = normalizePhoneNumber('213555123456', 'DZ');

    assert.ok(result.ok);
    assert.equal(result.phone, '213555123456');
  });

  it('suit l’indicatif par defaut demande, pas celui du depot', () => {
    const result = normalizePhoneNumber('0612345678', 'FR');

    assert.ok(result.ok);
    assert.equal(result.phone, '33612345678');
  });
});

describe('normalizePhoneNumber — ce qui est refuse', () => {
  it('refuse un numero local sans 0 initial : le prefixer serait deviner', () => {
    // LE CAS LE PLUS DANGEREUX DU FICHIER. `555123456` pourrait etre un numero
    // algerien sans le 0, un numero francais, un poste interne. Choisir, c'est
    // envoyer le message d'un client a un inconnu.
    const result = normalizePhoneNumber('555123456', 'DZ');

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'AMBIGUOUS_FORMAT');
      assert.match(
        result.message,
        /\+213555123456/,
        'le message doit donner un exemple corrigible',
      );
    }
  });

  it('refuse un pays absent de la table', () => {
    const result = normalizePhoneNumber('0555123456', 'XX');

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'UNKNOWN_COUNTRY');
  });

  it('refuse une valeur vide', () => {
    const result = normalizePhoneNumber('   ');

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'EMPTY');
  });

  it('refuse une valeur sans aucun chiffre', () => {
    const result = normalizePhoneNumber('contact-principal');

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'NOT_A_NUMBER');
  });

  it('refuse un numero trop court', () => {
    const result = normalizePhoneNumber('+21355');

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'TOO_SHORT');
  });

  it('refuse un numero plus long que le maximum E.164', () => {
    const result = normalizePhoneNumber('+2135551234567890');

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'TOO_LONG');
  });
});

describe('resolveRecipient — numero, utilisateur, groupe', () => {
  it('rend kind=user pour un numero', () => {
    const result = resolveRecipient('+213555123456');

    assert.ok(result.ok);
    assert.equal(result.kind, 'user');
    assert.equal(result.phone, '213555123456');
  });

  it('rend kind=group pour un JID de groupe', () => {
    // La regle d'envoi refuse les groupes : encore faut-il que la resolution le
    // DISE. Un groupe rendu comme `user` passerait le controle, et un message
    // partirait vers des dizaines de personnes qui n'ont rien autorise.
    const result = resolveRecipient('120363001234567890@g.us');

    assert.ok(result.ok);
    assert.equal(result.kind, 'group');
    assert.equal(result.phone, null);
  });

  it('recupere le numero d’un JID utilisateur', () => {
    const result = resolveRecipient('213555123456@s.whatsapp.net');

    assert.ok(result.ok);
    assert.equal(result.kind, 'user');
    assert.equal(result.phone, '213555123456');
  });

  it('refuse un suffixe d’identifiant inconnu', () => {
    const result = resolveRecipient('213555123456@whatsapp.com');

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'UNKNOWN_JID');
  });

  it('propage le refus de normalizePhoneNumber', () => {
    const result = resolveRecipient('555123456', 'DZ');

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'AMBIGUOUS_FORMAT');
  });
});

describe('canonicalJid — une seule forme par destinataire', () => {
  it('traduit le suffixe historique @c.us', () => {
    // WAHA rend encore des JID en `@c.us`, alors que `resolveRecipient` produit
    // `@s.whatsapp.net`. Sans forme unique, le meme contact existe deux fois en
    // base et le plafond horaire compte deux destinataires pour une personne.
    assert.equal(canonicalJid('213555123456@c.us'), '213555123456@s.whatsapp.net');
  });

  it('laisse un JID deja canonique intact', () => {
    assert.equal(canonicalJid('213555123456@s.whatsapp.net'), '213555123456@s.whatsapp.net');
  });

  it('ne touche pas aux groupes, diffusions et identifiants sans numero', () => {
    // Reecrire un JID de groupe le rendrait injoignable : `@s.whatsapp.net` n'a
    // de sens que pour un utilisateur.
    assert.equal(canonicalJid('120363001234567890@g.us'), '120363001234567890@g.us');
    assert.equal(canonicalJid('status@broadcast'), 'status@broadcast');
    assert.equal(canonicalJid('123456789@lid'), '123456789@lid');
  });

  it('met en minuscules et retire les espaces', () => {
    assert.equal(canonicalJid('  213555123456@C.US '), '213555123456@s.whatsapp.net');
  });

  it('rend une chaine vide pour une valeur absente', () => {
    assert.equal(canonicalJid(null), '');
    assert.equal(canonicalJid(undefined), '');
    assert.equal(canonicalJid('   '), '');
  });

  it('produit la meme forme que resolveRecipient pour un meme numero', () => {
    const resolved = resolveRecipient('+213555123456');

    assert.ok(resolved.ok);
    assert.equal(canonicalJid('213555123456@c.us'), resolved.ok ? resolved.jid : '');
  });
});

describe('phoneNumberFromJid — un groupe n’est pas un numero', () => {
  it('extrait le numero d’un JID utilisateur', () => {
    assert.equal(phoneNumberFromJid('213555123456@s.whatsapp.net'), '213555123456');
    assert.equal(phoneNumberFromJid('213555123456@c.us'), '213555123456');
  });

  it('rend null pour un JID de groupe', () => {
    // Sans ce refus, l'identifiant d'un groupe serait recopie dans la colonne
    // `phoneNumber` : une recherche par numero tomberait sur un groupe, et un
    // envoi construit depuis cette colonne viserait tous ses membres.
    assert.equal(phoneNumberFromJid('120363001234567890@g.us'), null);
  });

  it('rend null pour une diffusion ou un identifiant sans numero', () => {
    assert.equal(phoneNumberFromJid('status@broadcast'), null);
    assert.equal(phoneNumberFromJid('123456789@lid'), null);
  });

  it('rend null pour une valeur absente ou sans suffixe', () => {
    assert.equal(phoneNumberFromJid(null), null);
    assert.equal(phoneNumberFromJid(''), null);
    assert.equal(phoneNumberFromJid('213555123456'), null);
  });

  it('rend null pour un nombre de chiffres hors bornes E.164', () => {
    assert.equal(phoneNumberFromJid('123@s.whatsapp.net'), null);
    assert.equal(phoneNumberFromJid(`${'9'.repeat(20)}@s.whatsapp.net`), null);
  });
});

describe('sessionNameFor — un nom qui ne revele rien', () => {
  it('produit <prefixe>-<alea>, sans identifiant de membre', () => {
    // Le nom apparait dans les journaux de la passerelle, un service distinct.
    // Y recopier l'identifiant Comexa d'un membre y exporterait une donnee qui ne
    // la regarde pas — d'ou l'alea, et ce test.
    const name = sessionNameFor('comexa', 'aBcDeFgHiJkL');

    assert.equal(name, 'comexa-abcdefghijkl');
    assert.ok(isUsableSessionName(name));
  });

  it('nettoie un prefixe contenant des caracteres interdits', () => {
    const name = sessionNameFor('Comexa Prod!', 'xyz123');

    assert.equal(name, 'comexaprod-xyz123');
  });

  it('retombe sur « comexa » quand le prefixe ne laisse rien d’utilisable', () => {
    const name = sessionNameFor('!!!', 'xyz123');

    assert.equal(name, 'comexa-xyz123');
  });

  it('borne la longueur a 40 caracteres', () => {
    // Les deux pilotes limitent les noms d'instance ; un nom trop long est refuse
    // par la passerelle, donc apres que la ligne existe en base.
    const name = sessionNameFor('un-prefixe-vraiment-trop-long-pour-etre-honnete', 'abcdefghijkl');

    assert.ok(name.length <= 40, `nom trop long : ${name}`);
  });

  it('produit des noms differents a chaque appel', () => {
    // Un membre peut detenir plusieurs autorisations (la sienne, plus celle d'un
    // tiers) : deux noms identiques croiraient deux telephones.
    const names = new Set(Array.from({ length: 25 }, () => sessionNameFor('comexa')));

    assert.equal(names.size, 25);
  });
});

describe('isUsableSessionName', () => {
  it('accepte un nom conforme', () => {
    assert.equal(isUsableSessionName('comexa-abc123'), true);
  });

  it('refuse les majuscules, les espaces, le vide et les noms trop courts', () => {
    assert.equal(isUsableSessionName('Comexa-ABC'), false);
    assert.equal(isUsableSessionName('comexa abc'), false);
    assert.equal(isUsableSessionName(''), false);
    assert.equal(isUsableSessionName(null), false);
    assert.equal(isUsableSessionName('ab'), false);
    assert.equal(isUsableSessionName('a'.repeat(41)), false);
  });

  it('refuse un nom commence par un tiret', () => {
    assert.equal(isUsableSessionName('-comexa-abc'), false);
  });
});

describe('code d’autorisation — generation, normalisation, empreinte', () => {
  it('genere la forme WA-XXXX-XXXX-XXXX', () => {
    const code = generateDelegationCode();

    assert.match(code, /^WA-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('n’emploie aucun caractere ambigu', () => {
    // Le code est recopie a la main depuis un courriel : 0/O et 1/I produiraient
    // des echecs d'appairage dont personne ne trouverait la cause.
    const alphabet = new Set<string>();
    for (let i = 0; i < 400; i++) {
      for (const char of generateDelegationCode().replace(/-/g, '')) alphabet.add(char);
    }

    assert.equal(alphabet.has('0'), false);
    assert.equal(alphabet.has('O'), false);
    assert.equal(alphabet.has('1'), false);
    assert.equal(alphabet.has('I'), false);
  });

  it('normalise tirets, espaces, casse et prefixe', () => {
    const code = generateDelegationCode();

    assert.equal(normalizeDelegationCode(code), normalizeDelegationCode(code.toLowerCase()));
    assert.equal(
      normalizeDelegationCode(` ${code.replace(/-/g, ' ')} `),
      normalizeDelegationCode(code),
    );
    // Sans le prefixe : meme empreinte, sinon un code saisi tel quel serait
    // toujours refuse.
    assert.equal(
      normalizeDelegationCode(code.slice(DELEGATION_CODE_PREFIX.length + 1)),
      normalizeDelegationCode(code),
    );
  });

  it('rend null sur une valeur vide', () => {
    assert.equal(normalizeDelegationCode(''), null);
    assert.equal(normalizeDelegationCode('  -  '), null);
    assert.equal(normalizeDelegationCode(undefined), null);
  });

  it('reconnait la forme d’un code, et seulement elle', () => {
    const code = generateDelegationCode();

    assert.equal(looksLikeDelegationCode(code), true);
    assert.equal(looksLikeDelegationCode(code.replace(/-/g, '')), true);
    assert.equal(looksLikeDelegationCode('WA-1234'), false);
    assert.equal(looksLikeDelegationCode('bonjour'), false);
    assert.equal(looksLikeDelegationCode(''), false);
  });

  it('produit une empreinte stable et differente d’un code a l’autre', () => {
    const code = generateDelegationCode();

    assert.equal(hashDelegationCode(code), hashDelegationCode(code.toLowerCase()));
    assert.notEqual(hashDelegationCode(code), hashDelegationCode(generateDelegationCode()));
    assert.match(hashDelegationCode(code), /^[0-9a-f]{64}$/);
  });

  it('compare a duree constante, sans lever sur une empreinte de mauvaise taille', () => {
    // `timingSafeEqual` LEVE sur deux buffers de longueurs differentes. Sans la
    // garde, un code invalide produirait un 500 — et un 500 sur une route de
    // consentement dit a un attaquant que sa saisie a atteint autre chose qu'un
    // simple refus.
    const code = generateDelegationCode();
    const hash = hashDelegationCode(code);

    assert.equal(delegationCodeMatches(code, hash), true);
    assert.equal(delegationCodeMatches(code.toUpperCase(), hash), true);
    assert.equal(delegationCodeMatches(generateDelegationCode(), hash), false);
    assert.equal(delegationCodeMatches(code, 'trop-court'), false);
    assert.equal(delegationCodeMatches(code, ''), false);
  });
});

describe('COUNTRY_DIAL_CODES — coherence de la table', () => {
  it('contient les pays utilises par defaut dans ce depot', () => {
    assert.equal(COUNTRY_DIAL_CODES.DZ, 213);
    assert.equal(COUNTRY_DIAL_CODES.FR, 33);
  });

  it('n’a aucune valeur vide ni non numerique', () => {
    // Une entree fautive ne casserait rien a la compilation : elle rendrait
    // `String(dialCode)` absurde, donc un numero invalide — silencieusement.
    for (const [country, dial] of Object.entries(COUNTRY_DIAL_CODES)) {
      assert.equal(typeof dial, 'number', `${country} n'est pas un nombre`);
      assert.ok(Number.isInteger(dial) && dial > 0, `${country} : indicatif ${dial}`);
      assert.match(country, /^[A-Z]{2}$/, `${country} n'est pas un code ISO a deux lettres`);
    }
  });
});
