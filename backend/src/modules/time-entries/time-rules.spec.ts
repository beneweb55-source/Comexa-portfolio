import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SCOPE_ANY, SCOPE_OWN } from '../../common/auth/principal.js';
import type { ScopeSubject } from '../projects/project-scope.js';
import {
  MAX_MINUTES_PER_ENTRY,
  TIME_READ_ORDER,
  TIME_WRITE_ORDER,
  isFutureWorkDay,
  minutesViolation,
  normalizeWorkDay,
  timeEntryPerimeter,
  timeEntryScopeWhere,
} from './time-rules.js';

const DEV: ScopeSubject = { userId: 'dev-1', clientId: null, isClient: false };

describe('perimetre d’une saisie de temps', () => {
  it('any ne filtre rien sur la personne', () => {
    assert.deepEqual(timeEntryScopeWhere(SCOPE_ANY, DEV), {});
  });

  it('own se limite aux saisies DU PORTEUR', () => {
    // Pas « les saisies des taches qui me sont assignees » : un developpeur ne
    // doit pas voir le temps qu'un collegue a passe sur une tache qu'il partage,
    // sinon `time:read:own` n'aurait plus rien de prive et la feuille de temps
    // deviendrait un outil de surveillance.
    assert.deepEqual(timeEntryScopeWhere(SCOPE_OWN, DEV), { userId: 'dev-1' });
  });

  it('ECHOUE FERME sur un scope inconnu', () => {
    for (const inconnu of ['', 'team', 'ANY']) {
      assert.deepEqual(timeEntryScopeWhere(inconnu, DEV), { id: { in: [] } });
    }
  });
});

describe('perimetre complet (personne + projet)', () => {
  it('own N’EST PAS borne par le projet', () => {
    // Une feuille de temps personnelle doit rester complete meme si le projet a
    // ete supprime ou si son porteur en a ete retire. Sinon elle perd des lignes
    // selon l'etat d'un projet, et ce n'est plus une feuille de temps.
    assert.deepEqual(timeEntryPerimeter(SCOPE_OWN, DEV, null), { userId: 'dev-1' });
    assert.deepEqual(timeEntryPerimeter(SCOPE_OWN, DEV, { clientId: 'client-9' }), {
      userId: 'dev-1',
    });
  });

  it('any EST borne par le projet', () => {
    // « Toutes les saisies » veut dire « toutes celles des projets que je peux
    // atteindre », jamais « toutes celles de l'agence ».
    assert.deepEqual(timeEntryPerimeter(SCOPE_ANY, DEV, { clientId: 'client-9' }), {
      AND: [{}, { project: { deletedAt: null, AND: [{ clientId: 'client-9' }] } }],
    });
  });

  it('any SANS filtre de projet ne sert RIEN', () => {
    // Appelant qui a oublie de fournir le perimetre : une erreur d'appel ne doit
    // pas se transformer en fuite. `{}` servirait toute la table.
    assert.deepEqual(timeEntryPerimeter(SCOPE_ANY, DEV, null), { id: { in: [] } });
  });

  it('un scope inconnu ne sert rien, meme avec un filtre de projet', () => {
    assert.deepEqual(timeEntryPerimeter('equipe', DEV, { clientId: 'client-9' }), {
      id: { in: [] },
    });
  });
});

describe('ordres de scope du temps', () => {
  it('lit et ecrit avec les memes scopes', () => {
    assert.deepEqual(TIME_READ_ORDER, [SCOPE_ANY, SCOPE_OWN]);
    assert.deepEqual(TIME_WRITE_ORDER, [SCOPE_ANY, SCOPE_OWN]);
  });
});

describe('minutesViolation', () => {
  it('accepte une duree normale', () => {
    assert.equal(minutesViolation(1), null);
    assert.equal(minutesViolation(90), null);
    assert.equal(minutesViolation(MAX_MINUTES_PER_ENTRY), null);
  });

  it('refuse zero et les negatifs', () => {
    assert.match(minutesViolation(0) ?? '', /strictement positive/);
    assert.match(minutesViolation(-30) ?? '', /strictement positive/);
  });

  it('refuse au-dela d’une journee', () => {
    // Le temps saisi finit en facturation : une duree fausse se paie.
    assert.match(minutesViolation(MAX_MINUTES_PER_ENTRY + 1) ?? '', /24 heures/);
    assert.match(minutesViolation(10_000) ?? '', /24 heures/);
  });

  it('refuse une duree non entiere', () => {
    assert.match(minutesViolation(90.5) ?? '', /entier/);
  });

  it('la borne est INCLUSIVE', () => {
    assert.equal(minutesViolation(24 * 60), null);
    assert.notEqual(minutesViolation(24 * 60 + 1), null);
  });
});

describe('normalizeWorkDay', () => {
  it('ramene un instant a minuit UTC du meme jour', () => {
    const jour = normalizeWorkDay(new Date('2026-03-05T17:42:11.000Z'));
    assert.equal(jour.toISOString(), '2026-03-05T00:00:00.000Z');
  });

  it('est idempotente', () => {
    const une = normalizeWorkDay(new Date('2026-03-05T17:42:11.000Z'));
    assert.equal(normalizeWorkDay(une).toISOString(), une.toISOString());
  });

  it('ramene minuit deja normalise a lui-meme', () => {
    assert.equal(
      normalizeWorkDay(new Date('2026-03-05T00:00:00.000Z')).toISOString(),
      '2026-03-05T00:00:00.000Z',
    );
  });
});

describe('isFutureWorkDay', () => {
  const midi = new Date('2026-03-05T12:00:00.000Z');

  it('accepte AUJOURD’HUI, a n’importe quelle heure', () => {
    // Le cas qui rend la comparaison par JOUR indispensable : saisir a 9 h un
    // travail de l'apres-midi du meme jour est courant et legitime.
    assert.equal(isFutureWorkDay(new Date('2026-03-05T09:00:00.000Z'), midi), false);
    assert.equal(isFutureWorkDay(new Date('2026-03-05T23:59:59.000Z'), midi), false);
    assert.equal(isFutureWorkDay(normalizeWorkDay(midi), midi), false);
  });

  it('accepte le passe', () => {
    assert.equal(isFutureWorkDay(new Date('2026-03-04T23:59:59.000Z'), midi), false);
    assert.equal(isFutureWorkDay(new Date('2025-01-01T00:00:00.000Z'), midi), false);
  });

  it('refuse DEMAIN, meme d’une minute', () => {
    assert.equal(isFutureWorkDay(new Date('2026-03-06T00:00:00.000Z'), midi), true);
    assert.equal(isFutureWorkDay(new Date('2026-03-06T00:00:01.000Z'), midi), true);
    assert.equal(isFutureWorkDay(new Date('2027-01-01T00:00:00.000Z'), midi), true);
  });

  it('bascule a minuit UTC, pas a 23 h', () => {
    // La limite est en UTC et non dans le fuseau du serveur : un serveur deploye
    // a Paris puis migre ailleurs changerait de comportement sans que personne ne
    // touche au code.
    const veille = new Date('2026-03-05T23:59:00.000Z');
    assert.equal(isFutureWorkDay(new Date('2026-03-05T23:59:59.000Z'), veille), false);
    assert.equal(isFutureWorkDay(new Date('2026-03-06T00:00:00.000Z'), veille), true);
  });
});
