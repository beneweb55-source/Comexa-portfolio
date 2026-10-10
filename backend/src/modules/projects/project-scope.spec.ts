import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SCOPE_ANY, SCOPE_ASSIGNED, SCOPE_OWN } from '../../common/auth/principal.js';
import { ProjectStatus } from '../../generated/prisma/enums.js';
import {
  PROJECT_READ_ORDER,
  PROJECT_STATUS_TRANSITIONS,
  PROJECT_WRITE_ORDER,
  canTransitionProject,
  projectScopeWhere,
  subjectOf,
  type ScopeSubject,
} from './project-scope.js';

/**
 * LE FICHIER DE TEST LE PLUS IMPORTANT DU LOT.
 *
 * `projectScopeWhere` est la fonction qui repond a « quelles lignes ce porteur
 * peut voir ». Une erreur ici n'est pas une erreur d'affichage : c'est un client
 * qui lit le projet d'un autre client. Elle est donc testee exhaustivement, cas
 * par cas, y compris les cas ou le porteur n'a PAS de perimetre.
 */

const MEMBER: ScopeSubject = { userId: 'user-1', clientId: null, isClient: false };
const CLIENT: ScopeSubject = { userId: 'user-9', clientId: 'client-42', isClient: true };
/** Compte client dont le rattachement a echoue : le cas qui doit ne rien servir. */
const CLIENT_ORPHELIN: ScopeSubject = { userId: 'user-9', clientId: null, isClient: true };

describe('projectScopeWhere', () => {
  describe('scope any', () => {
    it('ne filtre rien pour un membre de l’agence', () => {
      assert.deepEqual(projectScopeWhere(SCOPE_ANY, MEMBER), {});
    });

    it('ne filtre rien non plus pour un compte client', () => {
      // « any » veut dire « tous les projets des dossiers que j'atteins », et
      // c'est le PERIMETRE qui l'atteint. Un compte CLIENT ne detient pas
      // `project:read:any` ; si un jour il l'obtenait, la decision serait
      // consciente et non le resultat d'un defaut ici.
      assert.deepEqual(projectScopeWhere(SCOPE_ANY, CLIENT), {});
    });
  });

  describe('scope assigned', () => {
    it('se limite aux projets dont le porteur est membre ACTIF', () => {
      assert.deepEqual(projectScopeWhere(SCOPE_ASSIGNED, MEMBER), {
        members: { some: { userId: 'user-1', leftAt: null } },
      });
    });

    it('exclut un membre retire de l’equipe', () => {
      // `leftAt: null` est la seule chose qui distingue un membre actif d'une
      // ligne d'historique. Sans ce filtre, retirer quelqu'un de l'equipe ne lui
      // retirerait pas l'acces.
      const where = projectScopeWhere(SCOPE_ASSIGNED, MEMBER);
      assert.deepEqual((where as { members: unknown }).members, {
        some: { userId: 'user-1', leftAt: null },
      });
    });

    it('n’ouvre rien a un compte client', () => {
      // Un compte client n'a pas de ligne dans `project_members`. Le filtre ne
      // sert donc rien, ce qui est correct — et il n'ouvre rien pour autant.
      assert.deepEqual(projectScopeWhere(SCOPE_ASSIGNED, CLIENT), {
        members: { some: { userId: 'user-9', leftAt: null } },
      });
    });
  });

  describe('scope own', () => {
    it('donne a un compte client SON dossier, resolu depuis le porteur', () => {
      // LE TEST CENTRAL. Le rattachement vient de `subject.clientId`, c'est-a-dire
      // de la base — jamais d'un identifiant lu dans la requete HTTP. C'est ce qui
      // rend impossible de lire le projet d'un autre client en changeant une URL.
      assert.deepEqual(projectScopeWhere(SCOPE_OWN, CLIENT), { clientId: 'client-42' });
    });

    it('ne sert RIEN a un compte client sans rattachement', () => {
      // Piege Prisma : `clientId: null` signifie « IS NULL », donc servirait
      // exactement les projets orphelins. On ne sert rien du tout.
      assert.deepEqual(projectScopeWhere(SCOPE_OWN, CLIENT_ORPHELIN), {
        id: { in: [] },
      });
    });

    it('donne a un membre de l’agence les projets dont il est responsable', () => {
      assert.deepEqual(projectScopeWhere(SCOPE_OWN, MEMBER), { managerId: 'user-1' });
    });

    it('distingue bien un client d’un responsable interne', () => {
      assert.notDeepEqual(
        projectScopeWhere(SCOPE_OWN, CLIENT),
        projectScopeWhere(SCOPE_OWN, MEMBER),
      );
    });
  });

  it('ECHOUE FERME sur un scope inconnu', () => {
    // Le pire des cas doit etre « je ne vois rien », jamais « je vois tout ».
    // `{}` ici servirait toute la table des projets.
    for (const inconnu of ['', 'public', 'all', 'ANY', 'owner']) {
      assert.deepEqual(
        projectScopeWhere(inconnu, MEMBER),
        { id: { in: [] } },
        `le scope « ${inconnu} » doit ne rien servir`,
      );
    }
  });
});

describe('subjectOf', () => {
  it('extrait les trois champs du porteur, et rien d’autre', () => {
    const subject = subjectOf({
      userId: 'user-7',
      clientId: 'client-3',
      isClient: () => true,
    });

    assert.deepEqual(subject, { userId: 'user-7', clientId: 'client-3', isClient: true });
  });

  it('marque un membre de l’agence comme non client', () => {
    const subject = subjectOf({ userId: 'user-7', clientId: null, isClient: () => false });
    assert.equal(subject.isClient, false);
  });
});

describe('ordres de scope', () => {
  it('place any avant assigned avant own en lecture', () => {
    // L'ordre est FOURNI par le domaine, du plus large au plus etroit : c'est lui
    // qui decide quel scope gagne quand un porteur en detient plusieurs.
    assert.deepEqual(PROJECT_READ_ORDER, [SCOPE_ANY, SCOPE_ASSIGNED, SCOPE_OWN]);
  });

  it('ne place pas assigned en ecriture', () => {
    // Etre membre de l'equipe ne donne pas le droit d'ecrire la fiche du projet.
    assert.deepEqual(PROJECT_WRITE_ORDER, [SCOPE_ANY, SCOPE_OWN]);
    assert.ok(!PROJECT_WRITE_ORDER.includes(SCOPE_ASSIGNED));
  });
});

describe('transitions de statut d’un projet', () => {
  it('autorise le chemin nominal', () => {
    assert.ok(canTransitionProject(ProjectStatus.DRAFT, ProjectStatus.PLANNED));
    assert.ok(canTransitionProject(ProjectStatus.PLANNED, ProjectStatus.IN_PROGRESS));
    assert.ok(canTransitionProject(ProjectStatus.IN_PROGRESS, ProjectStatus.COMPLETED));
  });

  it('autorise la reouverture d’un projet termine', () => {
    // Un « termine » qui se revele incomplet doit pouvoir rouvrir, sinon on
    // contourne le systeme en creant un second projet pour le meme travail.
    assert.ok(canTransitionProject(ProjectStatus.COMPLETED, ProjectStatus.IN_PROGRESS));
  });

  it('refuse le raccourci DRAFT vers COMPLETED', () => {
    assert.equal(canTransitionProject(ProjectStatus.DRAFT, ProjectStatus.COMPLETED), false);
  });

  it('traite ARCHIVED comme terminal', () => {
    assert.deepEqual(PROJECT_STATUS_TRANSITIONS[ProjectStatus.ARCHIVED], []);
    for (const cible of Object.values(ProjectStatus)) {
      assert.equal(
        canTransitionProject(ProjectStatus.ARCHIVED, cible),
        false,
        `ARCHIVED ne doit pas pouvoir aller vers ${cible}`,
      );
    }
  });

  it('refuse un statut identique partout', () => {
    for (const statut of Object.values(ProjectStatus)) {
      assert.equal(
        canTransitionProject(statut, statut),
        false,
        `${statut} ne doit pas etre une transition vers lui-meme`,
      );
    }
  });
});
