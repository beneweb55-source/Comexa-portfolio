import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SCOPE_ANY, SCOPE_OWN } from '../../common/auth/principal.js';
import { MilestoneStatus } from '../../generated/prisma/enums.js';
import {
  MILESTONE_READ_ORDER,
  MILESTONE_STATUS_TRANSITIONS,
  MILESTONE_WRITE_ORDER,
  canTransitionMilestone,
  isMilestoneDeletable,
} from './milestone-rules.js';

describe('ordres de scope des jalons', () => {
  it('ne connait QUE any, et c’est un fait du catalogue', () => {
    // Il n'existe ni `milestone:read:own` ni `milestone:write:own` : un jalon est
    // une etape de projet, partagee par toute l'equipe. Le test fige ce fait pour
    // qu'un ajout de scope se voie ici avant d'atteindre un service.
    assert.deepEqual(MILESTONE_READ_ORDER, [SCOPE_ANY]);
    assert.deepEqual(MILESTONE_WRITE_ORDER, [SCOPE_ANY]);
    assert.equal(MILESTONE_READ_ORDER.includes(SCOPE_OWN), false);
  });
});

describe('transitions de statut d’un jalon', () => {
  it('autorise le chemin nominal', () => {
    assert.ok(canTransitionMilestone(MilestoneStatus.PENDING, MilestoneStatus.IN_PROGRESS));
    assert.ok(canTransitionMilestone(MilestoneStatus.IN_PROGRESS, MilestoneStatus.REACHED));
  });

  it('autorise a declarer un jalon atteint directement depuis PENDING', () => {
    // Cas reel : un jalon dont personne n'a rien saisi et qui est livre. Exiger
    // le passage par IN_PROGRESS obligerait a deux appels pour un seul fait.
    assert.ok(canTransitionMilestone(MilestoneStatus.PENDING, MilestoneStatus.REACHED));
  });

  it('REACHED ne retourne qu’en IN_PROGRESS, jamais en PENDING', () => {
    // Un jalon declare atteint puis desavoue doit garder la trace de son passage
    // en IN_PROGRESS : le remettre en PENDING effacerait toute memoire de
    // l'annonce faite au client.
    assert.deepEqual(MILESTONE_STATUS_TRANSITIONS[MilestoneStatus.REACHED], [
      MilestoneStatus.IN_PROGRESS,
    ]);
    assert.equal(canTransitionMilestone(MilestoneStatus.REACHED, MilestoneStatus.PENDING), false);
  });

  it('un jalon annule repart de PENDING', () => {
    assert.ok(canTransitionMilestone(MilestoneStatus.CANCELLED, MilestoneStatus.PENDING));
  });

  it('refuse un statut identique partout', () => {
    for (const statut of Object.values(MilestoneStatus)) {
      assert.equal(
        canTransitionMilestone(statut, statut),
        false,
        `${statut} ne doit pas etre une transition vers lui-meme`,
      );
    }
  });

  it('ne cite que des statuts connus', () => {
    const connus = new Set<string>(Object.values(MilestoneStatus));
    for (const [depart, arrives] of Object.entries(MILESTONE_STATUS_TRANSITIONS)) {
      for (const arrivee of arrives) {
        assert.ok(connus.has(arrivee), `${depart} -> ${arrivee} n'est pas un statut`);
      }
    }
  });
});

describe('suppression d’un jalon', () => {
  it('refuse de supprimer un jalon ATTEINT', () => {
    // C'est un fait date et annonce au client. L'effacer reviendrait a effacer
    // l'annonce ; `CANCELLED` est la sortie legitime, et elle laisse la ligne.
    assert.equal(isMilestoneDeletable(MilestoneStatus.REACHED), false);
  });

  it('autorise la suppression des autres statuts', () => {
    for (const statut of Object.values(MilestoneStatus)) {
      if (statut === MilestoneStatus.REACHED) continue;
      assert.equal(isMilestoneDeletable(statut), true, `statut ${statut}`);
    }
  });
});
