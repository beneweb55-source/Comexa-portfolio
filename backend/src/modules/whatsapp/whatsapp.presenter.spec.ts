import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PAIRING_INSTRUCTIONS,
  toWhatsAppAccountView,
  toWhatsAppContactView,
  toWhatsAppDelegationView,
  toWhatsAppMessageView,
} from './whatsapp.presenter.js';

/**
 * CE QUE CES TESTS PROTEGENT.
 *
 * -------------------------------------------------------------------------
 * 1. CE QUI NE SORT PAS
 * -------------------------------------------------------------------------
 * Trois valeurs existent en base et ne doivent JAMAIS apparaitre dans une
 * reponse :
 *
 *   - `consentIpAddress` : l'adresse IP de la personne qui a accepte. Elle sert a
 *     prouver un consentement, pas a etre redistribuee — la rendre dans une liste
 *     d'administration l'exposerait a tous les gestionnaires de communication.
 *   - `code` et `codeHash` : le code d'autorisation d'un tiers. Le code ne se lit
 *     QU'UNE FOIS, a la creation ; son empreinte ne se lit jamais. Les rendre
 *     permettrait a quiconque lit la liste des invitations de se substituer au
 *     tiers — donc de connecter SON telephone a la place du titulaire.
 *
 * Les tests passent ces champs DANS la ligne, volontairement : une ligne de plus
 * dans un `select` Prisma est facile a ajouter par inadvertance, et le presenter
 * est le dernier rempart avant la reponse HTTP.
 *
 * -------------------------------------------------------------------------
 * 2. LES DATES SONT DES CHAINES ISO
 * -------------------------------------------------------------------------
 * Un objet `Date` serialise en JSON donne bien une chaine, mais un presenter qui
 * rend des `Date` rend une forme qui depend du serialiseur. Le contrat d'API
 * (`shared/api/openapi.json`) annonce des `date-time` : le test verifie la forme,
 * pas l'intention.
 *
 * -------------------------------------------------------------------------
 * 3. `consent.valid` EST TRANSMIS, PAS RECALCULE
 * -------------------------------------------------------------------------
 * La regle vit dans `consent.ts`. Un presenter qui la reimplementerait finirait
 * par ne plus etre d'accord avec elle : deux reponses differentes a « ce compte
 * peut-il envoyer ? » seraient pires qu'une seule, meme fausse.
 */

const NOW = new Date('2026-10-15T12:34:56.789Z');

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc_1',
    ownerKind: 'SELF',
    status: 'CONNECTED',
    phoneNumber: '213555123456',
    pushName: 'Karim',
    grantedScopes: ['message:send'],
    gatewayDriver: 'waha',
    sessionName: 'comexa-abc123',
    consentVersion: '2026-10-15.1',
    consentAcceptedAt: NOW,
    consentExpiresAt: new Date('2027-10-15T00:00:00.000Z'),
    pairedAt: NOW,
    revokedAt: null,
    lastStatusAt: NOW,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    user: { id: 'usr_1', firstName: 'Karim', lastName: 'Benali' },
    delegation: null,
    ...overrides,
  };
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    direction: 'OUTBOUND',
    toJid: '213555123456@s.whatsapp.net',
    toPhoneNumber: '213555123456',
    body: 'Bonjour, votre devis est pret.',
    status: 'SENT',
    gatewayMessageId: '3EB0ABC',
    errorCode: null,
    errorMessage: null,
    telegramChatId: '748291034',
    telegramMessageId: '99',
    idempotencyKey: 'n8n-run-1',
    sentAt: NOW,
    createdAt: NOW,
    requestedBy: { id: 'usr_1', firstName: 'Karim', lastName: 'Benali' },
    ...overrides,
  };
}

function delegationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dlg_1',
    status: 'PENDING',
    delegatorName: 'Amina Haddad',
    delegatorEmail: 'amina@example.com',
    delegatorPhone: '+213661234567',
    note: 'Envois de devis',
    grantedScopes: ['message:send'],
    codeExpiresAt: new Date('2026-10-18T12:00:00.000Z'),
    acceptedAt: null,
    refusedAt: null,
    revokedAt: null,
    expiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    requestedBy: { id: 'usr_1', firstName: 'Karim', lastName: 'Benali' },
    account: null,
    ...overrides,
  };
}

describe('toWhatsAppAccountView', () => {
  it('transmet consent.valid sans le recalculer', () => {
    // `false` sur une ligne par ailleurs parfaite doit rester `false` : c'est le
    // service qui a applique la regle, pas le presenter.
    assert.equal(toWhatsAppAccountView(accountRow(), false).consent.valid, false);
    assert.equal(toWhatsAppAccountView(accountRow(), true).consent.valid, true);
  });

  it('normalise ownerKind en SELF ou DELEGATED, jamais autre chose', () => {
    assert.equal(
      toWhatsAppAccountView(accountRow({ ownerKind: 'DELEGATED' }), true).ownerKind,
      'DELEGATED',
    );
    assert.equal(toWhatsAppAccountView(accountRow({ ownerKind: 'SELF' }), true).ownerKind, 'SELF');
    // Une valeur inattendue (colonne ajoutée plus tard) retombe sur SELF : c'est
    // le cas le plus restrictif, celui qui n'implique aucun tiers.
    assert.equal(toWhatsAppAccountView(accountRow({ ownerKind: 'AUTRE' }), true).ownerKind, 'SELF');
  });

  it('NE REND PAS l’adresse IP du consentement', () => {
    // Le champ est passe exprès : si un `select` Prisma l'ajoute un jour, la
    // reponse ne doit pas suivre.
    const view = toWhatsAppAccountView(
      accountRow({ consentIpAddress: '41.100.12.34' }) as never,
      true,
    );

    assert.ok(!('consentIpAddress' in view), 'consentIpAddress ne doit pas sortir');
    assert.ok(
      !JSON.stringify(view).includes('41.100.12.34'),
      'l’adresse IP ne doit apparaitre nulle part dans la reponse',
    );
  });

  it('rend les dates en ISO 8601', () => {
    const view = toWhatsAppAccountView(accountRow(), true);

    assert.equal(view.createdAt, '2026-10-15T12:34:56.789Z');
    assert.equal(view.consent.acceptedAt, '2026-10-15T12:34:56.789Z');
    assert.equal(view.pairedAt, '2026-10-15T12:34:56.789Z');
    assert.equal(view.lastStatusAt, '2026-10-15T12:34:56.789Z');
  });

  it('rend null pour les dates absentes, jamais une chaine vide', () => {
    const view = toWhatsAppAccountView(
      accountRow({ revokedAt: null, pairedAt: null, lastStatusAt: null, consentExpiresAt: null }),
      true,
    );

    assert.equal(view.revokedAt, null);
    assert.equal(view.pairedAt, null);
    assert.equal(view.lastStatusAt, null);
    assert.equal(view.consent.expiresAt, null);
  });

  it('copie les capacites au lieu de partager le tableau de la ligne', () => {
    // Un tableau partage est modifiable par l'appelant : le trier ou le filtrer
    // cote service changerait ce qu'une reponse PRECEDENTE a deja rendu.
    const row = accountRow();
    const view = toWhatsAppAccountView(row, true);

    assert.notEqual(view.grantedScopes, row.grantedScopes);
    assert.deepEqual([...view.grantedScopes], ['message:send']);
  });

  it('rend le titulaire et la delegation quand ils existent, null sinon', () => {
    assert.deepEqual(toWhatsAppAccountView(accountRow(), true).holder, {
      id: 'usr_1',
      firstName: 'Karim',
      lastName: 'Benali',
    });
    assert.equal(toWhatsAppAccountView(accountRow({ user: null }), true).holder, null);

    const delegated = toWhatsAppAccountView(
      accountRow({
        ownerKind: 'DELEGATED',
        delegation: { id: 'dlg_1', status: 'ACCEPTED', delegatorName: 'Amina Haddad' },
      }),
      true,
    );

    assert.deepEqual(delegated.delegation, {
      id: 'dlg_1',
      status: 'ACCEPTED',
      delegatorName: 'Amina Haddad',
    });
  });
});

describe('toWhatsAppMessageView', () => {
  it('omet replayed par defaut', () => {
    // `replayed` n'a de sens que vrai. Le rendre systematiquement a `false`
    // ajouterait un champ que le workflow devrait interpreter.
    assert.ok(!('replayed' in toWhatsAppMessageView(messageRow())));
  });

  it('rend replayed: true sur un rejeu', () => {
    assert.equal(toWhatsAppMessageView(messageRow(), { replayed: true }).replayed, true);
  });

  it('rend replayed absent quand l’option est fausse', () => {
    assert.ok(!('replayed' in toWhatsAppMessageView(messageRow(), { replayed: false })));
  });

  it('groupe le destinataire sous `to`', () => {
    const view = toWhatsAppMessageView(messageRow());

    assert.deepEqual(view.to, {
      jid: '213555123456@s.whatsapp.net',
      phoneNumber: '213555123456',
    });
  });

  it('conserve le code et le message d’erreur d’un refus', () => {
    // Un refus est journalise ET rendu : c'est la seule trace que le bot peut
    // recopier a l'utilisateur pour expliquer pourquoi rien n'est parti.
    const view = toWhatsAppMessageView(
      messageRow({
        status: 'REFUSED',
        sentAt: null,
        gatewayMessageId: null,
        errorCode: 'WHATSAPP_CONSENT_EXPIRED',
        errorMessage: 'L’autorisation a expire.',
      }),
    );

    assert.equal(view.status, 'REFUSED');
    assert.equal(view.errorCode, 'WHATSAPP_CONSENT_EXPIRED');
    assert.equal(view.errorMessage, 'L’autorisation a expire.');
    assert.equal(view.sentAt, null);
  });

  it('retombe sur OUTBOUND pour une direction inconnue', () => {
    assert.equal(toWhatsAppMessageView(messageRow({ direction: 'AUTRE' })).direction, 'OUTBOUND');
    assert.equal(toWhatsAppMessageView(messageRow({ direction: 'INBOUND' })).direction, 'INBOUND');
  });

  it('rend null pour un demandeur absent', () => {
    // `SetNull` en base : revoquer un compte ne doit pas effacer le journal.
    assert.equal(toWhatsAppMessageView(messageRow({ requestedBy: null })).requestedBy, null);
  });
});

describe('toWhatsAppDelegationView', () => {
  it('NE REND NI LE CODE NI SON EMPREINTE', () => {
    // Le code d'autorisation ne se lit qu'une fois, a la creation. Le rendre dans
    // une liste permettrait a quiconque la lit de se substituer au tiers — donc de
    // connecter son propre telephone en engageant le numero d'un autre.
    const view = toWhatsAppDelegationView(
      delegationRow({ code: 'WA-7KQM-2ZPX-9BRT', codeHash: 'a'.repeat(64) }) as never,
    );

    const serialized = JSON.stringify(view);

    assert.ok(!('code' in view), 'code ne doit pas sortir');
    assert.ok(!('codeHash' in view), 'codeHash ne doit pas sortir');
    assert.ok(!serialized.includes('7KQM'), 'le code ne doit apparaitre nulle part');
    assert.ok(!serialized.includes('a'.repeat(64)), 'l’empreinte ne doit apparaitre nulle part');
  });

  it('rend l’echeance du code, sans le code', () => {
    // La date suffit a l'administration : elle dit si l'invitation est encore
    // valable, sans permettre de la redeemre.
    const view = toWhatsAppDelegationView(delegationRow());

    assert.equal(view.codeExpiresAt, '2026-10-18T12:00:00.000Z');
  });

  it('rend les capacites DEMANDEES', () => {
    // Une invitation sans capacite visible ne permet pas de savoir ce que le tiers
    // va accepter — donc de juger si la demande est proportionnee.
    const view = toWhatsAppDelegationView(
      delegationRow({ grantedScopes: ['message:send', 'contact:read'] }),
    );

    assert.deepEqual([...view.grantedScopes], ['message:send', 'contact:read']);
  });

  it('rend une liste vide quand aucune capacite n’est enregistree', () => {
    assert.deepEqual(
      [...toWhatsAppDelegationView(delegationRow({ grantedScopes: undefined })).grantedScopes],
      [],
    );
  });

  it('rend l’identifiant de compte une fois l’invitation acceptee', () => {
    assert.equal(
      toWhatsAppDelegationView(delegationRow({ account: { id: 'acc_9' } })).accountId,
      'acc_9',
    );
    assert.equal(toWhatsAppDelegationView(delegationRow({ account: null })).accountId, null);
  });
});

describe('toWhatsAppContactView', () => {
  it('rend l’identifiant, le numero et la date de synchronisation', () => {
    const view = toWhatsAppContactView({
      id: 'ctc_1',
      jid: '213555123456@s.whatsapp.net',
      phoneNumber: '213555123456',
      name: 'Amina',
      isBusiness: false,
      syncedAt: NOW,
    });

    assert.equal(view.jid, '213555123456@s.whatsapp.net');
    assert.equal(view.phoneNumber, '213555123456');
    assert.equal(view.name, 'Amina');
    assert.equal(view.isBusiness, false);
    assert.equal(view.syncedAt, '2026-10-15T12:34:56.789Z');
  });

  it('rend null pour un groupe, qui n’a pas de numero', () => {
    // Un groupe dont l'identifiant serait recopie en `phoneNumber` apparaitrait
    // dans une recherche par numero, et pourrait etre choisi comme destinataire.
    const view = toWhatsAppContactView({
      id: 'ctc_2',
      jid: '120363001234567890@g.us',
      phoneNumber: null,
      name: 'Equipe Comexa',
      isBusiness: false,
      syncedAt: NOW,
    });

    assert.equal(view.phoneNumber, null);
  });
});

describe('PAIRING_INSTRUCTIONS', () => {
  it('donne une marche a suivre non vide, dans l’ordre', () => {
    // Le QR seul ne suffit pas : sans ces lignes, le bot envoie une image que
    // personne ne sait ou scanner. Elles sont ECRITES ICI et non dans n8n pour
    // que les deux pilotes rendent la meme explication.
    assert.ok(PAIRING_INSTRUCTIONS.length >= 4);
    assert.match(PAIRING_INSTRUCTIONS[0]!, /WhatsApp/);
    assert.ok(
      PAIRING_INSTRUCTIONS.some((line) => /Appareils connectes/.test(line)),
      'le chemin dans les reglages doit etre indique',
    );
    assert.ok(
      PAIRING_INSTRUCTIONS.some((line) => /CONNECTED/.test(line)),
      'l’etat attendu doit etre nomme',
    );
  });

  it('ne contient aucune ligne vide', () => {
    for (const line of PAIRING_INSTRUCTIONS) {
      assert.ok(line.trim().length > 0);
    }
  });
});

describe('aucune vue ne rend un objet Date', () => {
  it('serialise toutes les dates en chaines', () => {
    // Un objet `Date` qui traverse un presenter rend une forme qui depend du
    // serialiseur employe. Le contrat d'API annonce des `date-time` : la forme est
    // verifiee ici, sur les quatre vues.
    const views: unknown[] = [
      toWhatsAppAccountView(accountRow(), true),
      toWhatsAppMessageView(messageRow()),
      toWhatsAppDelegationView(delegationRow()),
      toWhatsAppContactView({
        id: 'ctc_1',
        jid: '213555123456@s.whatsapp.net',
        phoneNumber: '213555123456',
        name: 'Amina',
        isBusiness: false,
        syncedAt: NOW,
      }),
    ];

    for (const view of views) {
      assert.ok(!(view instanceof Date));
      walk(view);
    }

    function walk(value: unknown): void {
      if (value instanceof Date) {
        assert.fail(`un objet Date a traverse le presenter : ${value.toISOString()}`);
      }

      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }

      if (typeof value === 'object' && value !== null) {
        for (const item of Object.values(value)) walk(item);
      }
    }
  });
});
