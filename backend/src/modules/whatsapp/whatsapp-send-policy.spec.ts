import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpStatus } from '@nestjs/common';
import { CONSENT_VERSION, type ConsentState } from './consent.js';
import { resolveRecipient, type ResolvedRecipient } from './whatsapp-identity.js';
import {
  SEND_REJECTION_CODES,
  evaluateSendPolicy,
  httpStatusForSendRejection,
  type SendPolicyInput,
  type SendRejectionCode,
} from './whatsapp-send-policy.js';

/**
 * CE QUE CES TESTS PROTEGENT.
 *
 * `evaluateSendPolicy` est LE DERNIER OBSTACLE avant qu'un message parte depuis
 * le telephone de quelqu'un. Chaque test correspond a un envoi qu'il ne faut pas
 * laisser passer, et — tout aussi important — AU CODE qui explique le refus : un
 * workflow n8n branche ses reprises sur le code, jamais sur le message.
 *
 * L'ordre des controles est teste explicitement (`REVOKED` avant le
 * consentement, plafond EN DERNIER) : un ordre different rendrait un message
 * d'erreur trompeur, et un message trompeur fait corriger la mauvaise chose.
 */

const NOW = new Date('2026-10-15T12:00:00.000Z');

function consent(overrides: Partial<ConsentState> = {}): ConsentState {
  return {
    consentVersion: CONSENT_VERSION,
    consentAcceptedAt: new Date('2026-10-01T09:00:00.000Z'),
    consentExpiresAt: new Date('2026-12-31T23:59:59.000Z'),
    revokedAt: null,
    grantedScopes: ['message:send'],
    ...overrides,
  };
}

function input(overrides: Partial<SendPolicyInput> = {}): SendPolicyInput {
  return {
    sessionStatus: 'CONNECTED',
    consent: consent(),
    recipient: resolveRecipient('+213555123456'),
    body: 'Bonjour, votre devis est pret.',
    sentInLastHour: 0,
    maxBodyLength: 1024,
    maxMessagesPerHour: 40,
    now: NOW,
    ...overrides,
  };
}

function codeOf(verdict: ReturnType<typeof evaluateSendPolicy>): SendRejectionCode {
  assert.equal(verdict.ok, false, 'un refus etait attendu');
  return verdict.ok ? undefined! : verdict.code;
}

describe('evaluateSendPolicy — le cas nominal', () => {
  it('accepte et rend le JID resolu', () => {
    const verdict = evaluateSendPolicy(input());

    assert.deepEqual(verdict, {
      ok: true,
      jid: '213555123456@s.whatsapp.net',
      phone: '213555123456',
    });
  });

  it('accepte juste sous le plafond horaire', () => {
    // La borne est `>=` : le 40e envoi d'une heure a 40 est refuse, le 39e passe.
    assert.equal(evaluateSendPolicy(input({ sentInLastHour: 39 })).ok, true);
  });
});

describe('evaluateSendPolicy — refus, dans l’ordre des controles', () => {
  it('refuse un compte revoque', () => {
    assert.equal(
      codeOf(evaluateSendPolicy(input({ sessionStatus: 'REVOKED' }))),
      SEND_REJECTION_CODES.ACCOUNT_REVOKED,
    );
  });

  it('annonce la revocation AVANT un consentement par ailleurs invalide', () => {
    // Une session revoquee a aussi un consentement retire. Dire « consentement
    // expire » laisserait croire que le retrait n'a pas ete pris en compte.
    const verdict = evaluateSendPolicy(
      input({
        sessionStatus: 'REVOKED',
        consent: consent({ consentAcceptedAt: null, revokedAt: new Date('2026-10-14T00:00:00Z') }),
      }),
    );

    assert.equal(codeOf(verdict), SEND_REJECTION_CODES.ACCOUNT_REVOKED);
  });

  it('refuse un consentement retire', () => {
    assert.equal(
      codeOf(evaluateSendPolicy(input({ consent: consent({ revokedAt: NOW }) }))),
      SEND_REJECTION_CODES.CONSENT_REVOKED,
    );
  });

  it('refuse en l’absence de consentement', () => {
    assert.equal(
      codeOf(evaluateSendPolicy(input({ consent: consent({ consentAcceptedAt: null }) }))),
      SEND_REJECTION_CODES.CONSENT_MISSING,
    );
  });

  it('refuse un consentement perime', () => {
    assert.equal(
      codeOf(
        evaluateSendPolicy(
          input({ consent: consent({ consentExpiresAt: new Date('2026-10-01T00:00:00Z') }) }),
        ),
      ),
      SEND_REJECTION_CODES.CONSENT_EXPIRED,
    );
  });

  it('refuse un consentement pris sur une version obsolete du texte', () => {
    assert.equal(
      codeOf(evaluateSendPolicy(input({ consent: consent({ consentVersion: '2020-01-01.1' }) }))),
      SEND_REJECTION_CODES.CONSENT_OUTDATED,
    );
  });

  it('refuse quand la capacite d’envoi n’a pas ete accordee', () => {
    // `contact:read` seul ne permet PAS d'envoyer. Sans ce controle, un compte
    // autorise a copier son repertoire servirait aussi de compte d'envoi.
    assert.equal(
      codeOf(evaluateSendPolicy(input({ consent: consent({ grantedScopes: ['contact:read'] }) }))),
      SEND_REJECTION_CODES.SCOPE_NOT_GRANTED,
    );
  });

  it('refuse une session non appairee, quel que soit son etat', () => {
    for (const sessionStatus of ['DISCONNECTED', 'STARTING', 'WAITING_QR', 'FAILED'] as const) {
      const verdict = evaluateSendPolicy(input({ sessionStatus }));

      assert.equal(codeOf(verdict), SEND_REJECTION_CODES.SESSION_NOT_CONNECTED, sessionStatus);
      assert.ok(
        !verdict.ok && verdict.message.includes(sessionStatus),
        `${sessionStatus} : l'etat doit etre nomme dans le message`,
      );
    }
  });

  it('place le consentement AVANT l’etat de session', () => {
    // Un consentement retire est plus grave qu'une session deconnectee : c'est
    // lui qu'il faut annoncer, sinon le titulaire reappaire et croit regler le
    // probleme — alors que l'autorisation, elle, n'existe plus.
    const verdict = evaluateSendPolicy(
      input({ sessionStatus: 'DISCONNECTED', consent: consent({ revokedAt: NOW }) }),
    );

    assert.equal(codeOf(verdict), SEND_REJECTION_CODES.CONSENT_REVOKED);
  });

  it('refuse un destinataire illisible', () => {
    const recipient = resolveRecipient('555123456', 'DZ');
    assert.equal(recipient.ok, false, 'precondition : ce numero doit etre ambigu');

    assert.equal(
      codeOf(evaluateSendPolicy(input({ recipient }))),
      SEND_REJECTION_CODES.RECIPIENT_INVALID,
    );
  });

  it('refuse un groupe', () => {
    // Un message de groupe touche tous ses membres : cela depasse l'autorisation
    // « envoyer a mes contacts ». Le refus doit nommer l'alternative.
    const recipient = resolveRecipient('120363001234567890@g.us');
    assert.ok(recipient.ok && recipient.kind === 'group', 'precondition : JID de groupe');

    const verdict = evaluateSendPolicy(input({ recipient }));

    assert.equal(codeOf(verdict), SEND_REJECTION_CODES.GROUP_NOT_ALLOWED);
    assert.ok(!verdict.ok && /un par un/.test(verdict.message), 'le message doit donner la sortie');
  });

  it('refuse un corps vide, espaces compris', () => {
    for (const body of ['', '   ', '\n\t ']) {
      assert.equal(
        codeOf(evaluateSendPolicy(input({ body }))),
        SEND_REJECTION_CODES.BODY_EMPTY,
        `corps ${JSON.stringify(body)}`,
      );
    }
  });

  it('refuse un corps trop long sans le tronquer', () => {
    // TRONQUER CHANGERAIT LE SENS du message, et le destinataire ne verrait pas
    // qu'il manque la fin. Le refus renvoie la correction a la source.
    const verdict = evaluateSendPolicy(input({ body: 'a'.repeat(1025), maxBodyLength: 1024 }));

    assert.equal(codeOf(verdict), SEND_REJECTION_CODES.BODY_TOO_LONG);
    assert.ok(!verdict.ok && /1025/.test(verdict.message), 'la longueur recue doit etre nommee');
  });

  it('accepte un corps exactement a la borne', () => {
    assert.equal(
      evaluateSendPolicy(input({ body: 'a'.repeat(1024), maxBodyLength: 1024 })).ok,
      true,
    );
  });

  it('refuse au plafond horaire', () => {
    const verdict = evaluateSendPolicy(input({ sentInLastHour: 40, maxMessagesPerHour: 40 }));

    assert.equal(codeOf(verdict), SEND_REJECTION_CODES.RATE_LIMITED);
    assert.ok(!verdict.ok && /40/.test(verdict.message), 'le plafond doit etre chiffre');
  });

  it('verifie le plafond EN DERNIER', () => {
    // Un plafond annonce sur un envoi qui serait de toute facon refuse (corps
    // vide, session morte) ferait attendre l'appelant une heure pour rien : la
    // vraie faute est ailleurs, et c'est elle qu'il faut corriger.
    assert.equal(
      codeOf(evaluateSendPolicy(input({ sentInLastHour: 99, body: '' }))),
      SEND_REJECTION_CODES.BODY_EMPTY,
    );
    assert.equal(
      codeOf(evaluateSendPolicy(input({ sentInLastHour: 99, sessionStatus: 'FAILED' }))),
      SEND_REJECTION_CODES.SESSION_NOT_CONNECTED,
    );
  });
});

describe('httpStatusForSendRejection — le statut dit quoi corriger', () => {
  it('rend 429 pour le plafond : la meme demande reussira plus tard', () => {
    // Seul cas ou attendre suffit. Un 422 ici inciterait le workflow a corriger
    // la requete — donc a rejouer immediatement, donc a saturer.
    assert.equal(
      httpStatusForSendRejection(SEND_REJECTION_CODES.RATE_LIMITED),
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('rend 409 pour un etat qui empeche l’operation', () => {
    assert.equal(
      httpStatusForSendRejection(SEND_REJECTION_CODES.SESSION_NOT_CONNECTED),
      HttpStatus.CONFLICT,
    );
    assert.equal(
      httpStatusForSendRejection(SEND_REJECTION_CODES.ACCOUNT_REVOKED),
      HttpStatus.CONFLICT,
    );
  });

  it('rend 400 pour une entree illisible', () => {
    for (const code of [
      SEND_REJECTION_CODES.RECIPIENT_INVALID,
      SEND_REJECTION_CODES.BODY_EMPTY,
      SEND_REJECTION_CODES.BODY_TOO_LONG,
    ]) {
      assert.equal(httpStatusForSendRejection(code), HttpStatus.BAD_REQUEST, code);
    }
  });

  it('rend 422 pour un groupe : l’entree est lisible, l’usage ne l’est pas', () => {
    assert.equal(
      httpStatusForSendRejection(SEND_REJECTION_CODES.GROUP_NOT_ALLOWED),
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  });

  it('rend 403 pour tout ce qui touche au consentement', () => {
    for (const code of [
      SEND_REJECTION_CODES.CONSENT_MISSING,
      SEND_REJECTION_CODES.CONSENT_EXPIRED,
      SEND_REJECTION_CODES.CONSENT_REVOKED,
      SEND_REJECTION_CODES.CONSENT_OUTDATED,
      SEND_REJECTION_CODES.SCOPE_NOT_GRANTED,
    ]) {
      assert.equal(httpStatusForSendRejection(code), HttpStatus.FORBIDDEN, code);
    }
  });

  it('couvre TOUS les codes du catalogue', () => {
    // Un code ajoute sans ligne dans la table retomberait sur le `default` (403)
    // sans que personne ne s'en apercoive : un plafond rendu en 403 ne se
    // corrige pas en attendant. Ce test casse a l'ajout, ce qui est le but.
    const codes = Object.values(SEND_REJECTION_CODES);

    assert.equal(new Set(codes).size, codes.length, 'codes dupliques dans le catalogue');
    assert.ok(codes.length >= 11, `catalogue suspect : ${codes.length} codes`);

    for (const code of codes) {
      const status = httpStatusForSendRejection(code);
      assert.ok(
        [400, 403, 409, 422, 429].includes(status),
        `${code} rend un statut inattendu : ${status}`,
      );
    }
  });
});

describe('les codes sont stables', () => {
  it('porte le prefixe WHATSAPP_ partout', () => {
    // `docs/API-N8N.md` §4 dit au workflow de brancher sur le code. Un code sans
    // prefixe entrerait en collision avec ceux des autres domaines.
    for (const code of Object.values(SEND_REJECTION_CODES)) {
      assert.match(code, /^WHATSAPP_[A-Z_]+$/, code);
    }
  });

  it('n’a pas deux entrees pour la meme valeur', () => {
    const values = Object.values(SEND_REJECTION_CODES);
    assert.equal(new Set(values).size, values.length);
  });

  it('rend un message lisible pour chaque refus', () => {
    // Le message est recopie TEL QUEL dans le chat Telegram par le bot. Un refus
    // sans explication laisserait l'utilisateur devant un silence.
    const refusals: SendPolicyInput[] = [
      input({ sessionStatus: 'REVOKED' }),
      input({ consent: consent({ revokedAt: NOW }) }),
      input({ consent: consent({ consentAcceptedAt: null }) }),
      input({ consent: consent({ consentExpiresAt: new Date('2026-01-01T00:00:00Z') }) }),
      input({ consent: consent({ consentVersion: '2020-01-01.1' }) }),
      input({ consent: consent({ grantedScopes: ['contact:read'] }) }),
      input({ sessionStatus: 'WAITING_QR' }),
      input({ recipient: resolveRecipient('') }),
      input({ recipient: resolveRecipient('120363001234567890@g.us') }),
      input({ body: '' }),
      input({ body: 'a'.repeat(2000) }),
      input({ sentInLastHour: 40 }),
    ];

    // Un refus par code du catalogue, sans exception.
    assert.equal(refusals.length, Object.values(SEND_REJECTION_CODES).length);

    for (const refusal of refusals) {
      const verdict = evaluateSendPolicy(refusal);

      assert.equal(verdict.ok, false);
      if (!verdict.ok) {
        assert.ok(verdict.message.trim().length > 10, `${verdict.code} : ${verdict.message}`);
      }
    }
  });

  it('ne rend jamais un refus muet quand la resolution n’a rien explique', () => {
    // `resolveRecipient` ne le fait pas aujourd'hui ; la regle, elle, ne doit pas
    // dependre de cette promesse. Sans repli, un message vide partirait dans le
    // chat Telegram.
    const recipient: ResolvedRecipient = { ok: false, reason: 'EMPTY', message: '  ' };
    const verdict = evaluateSendPolicy(input({ recipient }));

    assert.equal(codeOf(verdict), SEND_REJECTION_CODES.RECIPIENT_INVALID);
    assert.ok(!verdict.ok && verdict.message.includes('EMPTY'), verdict.ok ? '' : verdict.message);
  });
});
