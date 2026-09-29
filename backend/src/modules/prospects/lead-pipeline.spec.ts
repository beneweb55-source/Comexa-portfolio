import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException } from '../../common/errors/app-error.js';
import { LeadStatus } from '../../generated/prisma/enums.js';
import {
  LEAD_TRANSITIONS,
  assertConvertible,
  assertTransitionAllowed,
  canTransition,
  transitionsFrom,
} from './lead-pipeline.js';

/**
 * LA MACHINE A ETATS, VERIFIEE SANS BASE.
 *
 * Aucun test de ce fichier n'ouvre une connexion : ce qui est verifie ici est la
 * REGLE, pas son branchement. Le service, lui, est couvert par
 * `test/crm.e2e-spec.ts`.
 *
 * Le test qui compte le plus est celui qui PARCOURT LA TABLE EN ENTIER plutot
 * que d'eprouver trois transitions choisies a la main. Une transition ajoutee
 * par erreur dans `LEAD_TRANSITIONS` — un NEW -> WON ecrit « juste pour
 * debloquer un client presse » — doit faire echouer la suite, et il ne le ferait
 * pas si les tests ne citaient que les cas auxquels on a pense.
 */

function refusal(action: () => void): AppException {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof AppException, `attendu une AppException, recu : ${String(error)}`);
    return error;
  }

  assert.fail('aucun refus leve alors que le cas doit etre refuse');
}

describe('LEAD_TRANSITIONS — la table', () => {
  it('declare les sorties de CHAQUE etape de l enum', () => {
    // Exhaustivite verifiee a l execution en plus du typage : ajouter une etape
    // a `LeadStatus` sans lui donner de sorties laisserait une etape sans
    // transitions, donc une fiche definitivement bloquee sans que rien ne le
    // signale.
    const declared = new Set(Object.keys(LEAD_TRANSITIONS));
    const known = Object.values(LeadStatus);

    assert.equal(declared.size, known.length);
    for (const status of known) {
      assert.ok(declared.has(status), `${status} n a pas de sorties declarees`);
    }
  });

  it('fait de WON une etape TERMINALE', () => {
    assert.deepEqual(transitionsFrom(LeadStatus.WON), []);
    for (const status of Object.values(LeadStatus)) {
      assert.equal(canTransition(LeadStatus.WON, status), false);
    }
  });

  it('ne laisse qu une sortie a LOST : la reprise a NEW', () => {
    // Une piste perdue se REPREND, elle ne repart pas au milieu du parcours
    // comme si les premiers echanges n'avaient pas eu lieu.
    assert.deepEqual(transitionsFrom(LeadStatus.LOST), [LeadStatus.NEW]);
  });

  it('fait communiquer PROPOSAL_SENT et NEGOTIATION dans les deux sens', () => {
    assert.equal(canTransition(LeadStatus.PROPOSAL_SENT, LeadStatus.NEGOTIATION), true);
    assert.equal(canTransition(LeadStatus.NEGOTIATION, LeadStatus.PROPOSAL_SENT), true);
  });

  it('interdit de sauter la qualification', () => {
    assert.equal(canTransition(LeadStatus.NEW, LeadStatus.WON), false);
    assert.equal(canTransition(LeadStatus.NEW, LeadStatus.PROPOSAL_SENT), false);
    assert.equal(canTransition(LeadStatus.CONTACTED, LeadStatus.WON), false);
  });
});

describe('assertTransitionAllowed — la garde', () => {
  it('accepte TOUTE transition declaree dans la table', () => {
    for (const [from, targets] of Object.entries(LEAD_TRANSITIONS)) {
      for (const to of targets) {
        assert.doesNotThrow(
          () => assertTransitionAllowed(from as LeadStatus, to),
          `${from} -> ${to} devrait etre autorisee`,
        );
      }
    }
  });

  it('refuse TOUTE transition absente de la table', () => {
    for (const from of Object.values(LeadStatus)) {
      for (const to of Object.values(LeadStatus)) {
        if (from === to || transitionsFrom(from).includes(to)) {
          continue;
        }
        const error = refusal(() => assertTransitionAllowed(from, to));
        assert.equal(error.getStatus(), 422);
        assert.equal(error.code, 'LEAD_STATUS_TRANSITION_INVALID');
      }
    }
  });

  it('refuse une etape identique a la precedente', () => {
    // Ecrire une ligne d historique WON -> WON serait une ligne qui n atteste
    // d aucun changement : exactement ce qu un historique ne doit pas contenir.
    for (const status of Object.values(LeadStatus)) {
      const error = refusal(() => assertTransitionAllowed(status, status));
      assert.equal(error.code, 'LEAD_STATUS_UNCHANGED');
      assert.equal(error.getStatus(), 422);
    }
  });

  it('donne au frontend les sorties autorisees dans le detail du refus', () => {
    // Le frontend doit pouvoir afficher les etapes possibles sans redevinir la
    // table de son cote : deux tables divergeraient au premier ajout.
    const error = refusal(() => assertTransitionAllowed(LeadStatus.NEW, LeadStatus.WON));

    assert.deepEqual(error.details, {
      from: LeadStatus.NEW,
      to: LeadStatus.WON,
      allowed: transitionsFrom(LeadStatus.NEW),
    });
  });
});

describe('assertConvertible — l idempotence par refus', () => {
  it('accepte un prospect neuf', () => {
    assert.doesNotThrow(() =>
      assertConvertible({ status: LeadStatus.NEW, convertedClientId: null }),
    );
  });

  it('accepte un prospect deja gagne a la main', () => {
    // Marquer WON puis convertir est un parcours legal : le prospect a ete
    // gagne, il reste a ouvrir le dossier client.
    assert.doesNotThrow(() =>
      assertConvertible({ status: LeadStatus.WON, convertedClientId: null }),
    );
  });

  it('refuse un prospect DEJA converti, et le dit en 409', () => {
    const error = refusal(() =>
      assertConvertible({ status: LeadStatus.WON, convertedClientId: 'client-existant' }),
    );

    assert.equal(error.code, 'PROSPECT_ALREADY_CONVERTED');
    assert.equal(error.getStatus(), 409);
  });

  it('refuse une piste perdue', () => {
    const error = refusal(() =>
      assertConvertible({ status: LeadStatus.LOST, convertedClientId: null }),
    );

    assert.equal(error.code, 'PROSPECT_LOST_NOT_CONVERTIBLE');
    assert.equal(error.getStatus(), 422);
  });

  it('verifie la conversion AVANT l etape', () => {
    // L ordre des deux refus n est pas cosmetique : un prospect converti est
    // toujours WON, donc si l etape etait testee en premier, un second appel
    // sur une fiche convertie repondrait 422 « perdu » ou passerait — au lieu de
    // repondre 409 « deja converti », qui est la seule reponse vraie.
    const error = refusal(() =>
      assertConvertible({ status: LeadStatus.LOST, convertedClientId: 'client-existant' }),
    );

    assert.equal(error.code, 'PROSPECT_ALREADY_CONVERTED');
  });
});
