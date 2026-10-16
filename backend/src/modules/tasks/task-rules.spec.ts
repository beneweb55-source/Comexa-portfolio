import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AccessPolicy,
  SCOPE_ANY,
  SCOPE_ASSIGNED,
  SCOPE_OWN,
  type AuthenticatedUser,
} from '../../common/auth/principal.js';
import { Priority, RoleCode, TaskStatus, UserStatus } from '../../generated/prisma/enums.js';
import type { ScopeSubject } from '../projects/project-scope.js';
import {
  ASSIGNEE_READ_CODES,
  ASSIGNEE_WRITE_CODES,
  CLOSED_TASK_STATUSES,
  TASK_READ_ORDER,
  TASK_STATUS_TRANSITIONS,
  TASK_WRITE_ORDER,
  assignableUserWhere,
  canAttachSubTask,
  canTransitionTask,
  canTransitionTaskFor,
  mineTaskWhere,
  hasOpenSubTasks,
  isClosedTaskStatus,
  isTaskEditable,
  taskFilterWhere,
  taskScopeWhere,
  taskWriteScopeWhere,
} from './task-rules.js';

const DEV: ScopeSubject = { userId: 'dev-1', clientId: null, isClient: false };

describe('perimetre de lecture d’une tache', () => {
  it('any ne filtre rien', () => {
    assert.deepEqual(taskScopeWhere(SCOPE_ANY, DEV), {});
  });

  it('assigned se limite a la ligne dont le porteur est l’assigne', () => {
    assert.deepEqual(taskScopeWhere(SCOPE_ASSIGNED, DEV), { assigneeId: 'dev-1' });
  });

  it('own couvre l’assigne ET le rapporteur', () => {
    // Lire ne partage pas la definition d'ecrire : celui qui a cree une tache doit
    // pouvoir la suivre meme avant qu'elle soit assignee, sinon il la perd de vue
    // des qu'il la cree.
    assert.deepEqual(taskScopeWhere(SCOPE_OWN, DEV), {
      OR: [{ assigneeId: 'dev-1' }, { reporterId: 'dev-1' }],
    });
  });

  it('ECHOUE FERME sur un scope inconnu', () => {
    for (const inconnu of ['', 'public', 'ANY', 'client']) {
      assert.deepEqual(taskScopeWhere(inconnu, DEV), { id: { in: [] } });
    }
  });
});

describe('perimetre d’ecriture d’une tache', () => {
  it('own est PLUS ETROIT que la lecture : assigne seulement', () => {
    const lecture = taskScopeWhere(SCOPE_OWN, DEV);
    const ecriture = taskWriteScopeWhere(SCOPE_OWN, DEV);

    assert.deepEqual(ecriture, { assigneeId: 'dev-1' });
    // Le rapporteur est dans la lecture, PAS dans l'ecriture. C'est toute la
    // difference entre « je suis mon travail » et « je m'approprie le travail que
    // j'ai confie a quelqu'un d'autre ».
    assert.notDeepEqual(lecture, ecriture);
    assert.equal('OR' in ecriture, false);
  });

  it('ne connait pas le scope assigned', () => {
    // Un membre de l'equipe a qui la tache n'est pas assignee ne l'ecrit pas.
    assert.deepEqual(taskWriteScopeWhere(SCOPE_ASSIGNED, DEV), { id: { in: [] } });
  });

  it('ECHOUE FERME sur un scope inconnu', () => {
    assert.deepEqual(taskWriteScopeWhere('quelque-chose', DEV), { id: { in: [] } });
  });

  it('refuse a un developpeur la tache d’un collegue', () => {
    // LE TEST DU SCENARIO REDOUTE : le porteur ne peut pas atteindre la ligne
    // d'un autre, parce que le filtre l'exclut — il n'y a pas de lecture-puis-
    // verification qu'un `if` oublie pourrait laisser passer.
    const autre: ScopeSubject = { userId: 'dev-2', clientId: null, isClient: false };
    assert.notDeepEqual(taskWriteScopeWhere(SCOPE_OWN, DEV), taskWriteScopeWhere(SCOPE_OWN, autre));
    assert.deepEqual(taskWriteScopeWhere(SCOPE_OWN, autre), { assigneeId: 'dev-2' });
  });
});

describe('ordres de scope des taches', () => {
  it('lit du plus large au plus etroit', () => {
    assert.deepEqual(TASK_READ_ORDER, [SCOPE_ANY, SCOPE_ASSIGNED, SCOPE_OWN]);
  });

  it('ecrit sans le scope assigned', () => {
    assert.deepEqual(TASK_WRITE_ORDER, [SCOPE_ANY, SCOPE_OWN]);
  });
});

describe('filtres de recherche d’une liste de taches', () => {
  it('ne rend RIEN quand rien n’est demande : la liste reste entiere', () => {
    assert.deepEqual(taskFilterWhere({}), {});
  });

  it('filtre le createur par son IDENTIFIANT, jamais par un nom', () => {
    // Le filtre « par personne » est un `reporterId`. Ecrit sur un nom, il
    // confondrait deux homonymes et suivrait les renommages.
    assert.deepEqual(taskFilterWhere({ reporterId: 'user-1' }), { reporterId: 'user-1' });
    assert.deepEqual(taskFilterWhere({ reporterId: '' }), {});
  });

  it('ne porte JAMAIS le projet : c’est le service qui le pose, en `AND`', () => {
    // LE POINT DE SECURITE DE CE FICHIER. Le filtre par createur vient de la
    // requete HTTP ; s'il portait le projet, il pourrait le REMPLACER et faire
    // remonter les taches d'un autre projet. Il n'en porte aucun, et la liste est
    // bornee par `projectId: <projet verifie>` de `listForProject`.
    const where = taskFilterWhere({ reporterId: 'user-1', status: TaskStatus.TODO });

    assert.equal('projectId' in where, false);
    assert.equal('project' in where, false);
    assert.equal('deletedAt' in where, false);
  });

  it('combine plusieurs criteres sans en perdre aucun', () => {
    assert.deepEqual(
      taskFilterWhere({
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.HIGH,
        assigneeId: 'dev-1',
        reporterId: 'pm-1',
        milestoneId: 'jalon-1',
      }),
      {
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.HIGH,
        assigneeId: 'dev-1',
        reporterId: 'pm-1',
        milestoneId: 'jalon-1',
      },
    );
  });

  it('traduit rootOnly en « sans parent » et cherche le titre sans casse', () => {
    assert.deepEqual(taskFilterWhere({ rootOnly: true }), { parentTaskId: null });
    assert.deepEqual(taskFilterWhere({ rootOnly: false }), {});
    assert.deepEqual(taskFilterWhere({ search: 'maquette' }), {
      title: { contains: 'maquette', mode: 'insensitive' },
    });
  });

  it('garde l’espace personnel comme un filtre de plus, pas comme un perimetre', () => {
    // `?personalOnly=true` restreint la liste ; il ne remplace pas le perimetre
    // du porteur, qui reste dans le meme `AND` (voir `TasksService.listMine`).
    assert.deepEqual(taskFilterWhere({ personalOnly: true }), { isPersonal: true });
    assert.deepEqual(taskFilterWhere({ personalOnly: false }), {});
    assert.equal('assigneeId' in taskFilterWhere({ personalOnly: true }), false);
  });
});

describe('machine a etats d’une tache', () => {
  it('autorise le chemin nominal', () => {
    assert.ok(canTransitionTask(TaskStatus.TODO, TaskStatus.IN_PROGRESS));
    assert.ok(canTransitionTask(TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW));
    assert.ok(canTransitionTask(TaskStatus.IN_REVIEW, TaskStatus.DONE));
  });

  it('interdit de sauter la relecture depuis BLOCKED', () => {
    // Le travail n'a pas ete fait pendant qu'il etait bloque.
    assert.equal(canTransitionTask(TaskStatus.BLOCKED, TaskStatus.DONE), false);
    assert.ok(canTransitionTask(TaskStatus.BLOCKED, TaskStatus.IN_PROGRESS));
  });

  it('interdit d’annuler une tache en relecture', () => {
    // Le travail existe : c'est DONE qui le constate.
    assert.equal(canTransitionTask(TaskStatus.IN_REVIEW, TaskStatus.CANCELLED), false);
  });

  it('autorise la reouverture, dans les deux sens', () => {
    assert.ok(canTransitionTask(TaskStatus.DONE, TaskStatus.IN_PROGRESS));
    assert.ok(canTransitionTask(TaskStatus.CANCELLED, TaskStatus.TODO));
  });

  it('traite DONE et CANCELLED comme des impasses vers le meme etat', () => {
    assert.deepEqual(TASK_STATUS_TRANSITIONS[TaskStatus.DONE], [TaskStatus.IN_PROGRESS]);
    assert.deepEqual(TASK_STATUS_TRANSITIONS[TaskStatus.CANCELLED], [TaskStatus.TODO]);
  });

  it('refuse un statut identique partout', () => {
    for (const statut of Object.values(TaskStatus)) {
      assert.equal(canTransitionTask(statut, statut), false);
    }
  });

  it('ne cite que des statuts connus', () => {
    const connus = new Set<string>(Object.values(TaskStatus));
    for (const [depart, arrives] of Object.entries(TASK_STATUS_TRANSITIONS)) {
      for (const arrivee of arrives) {
        assert.ok(connus.has(arrivee), `${depart} -> ${arrivee} n'est pas un statut`);
      }
    }
  });
});

describe('invariant des sous-taches', () => {
  it('un parent clos avec des enfants OUVERTS est refuse', () => {
    assert.equal(hasOpenSubTasks([TaskStatus.DONE, TaskStatus.CANCELLED]), false);
    assert.equal(hasOpenSubTasks([TaskStatus.DONE, TaskStatus.IN_PROGRESS]), true);
    assert.equal(hasOpenSubTasks([TaskStatus.TODO]), true);
    assert.equal(hasOpenSubTasks([TaskStatus.BLOCKED]), true);
    assert.equal(hasOpenSubTasks([TaskStatus.IN_REVIEW]), true);
  });

  it('un parent sans enfant se ferme toujours', () => {
    assert.equal(hasOpenSubTasks([]), false);
  });

  it('CANCELLED compte comme clos, ce qui donne une sortie a la regle', () => {
    // Un parent dont on abandonne le reste doit pouvoir etre clos apres avoir
    // annule les enfants — sinon la regle n'aurait aucune porte de sortie.
    assert.equal(isClosedTaskStatus(TaskStatus.CANCELLED), true);
    assert.equal(hasOpenSubTasks([TaskStatus.CANCELLED, TaskStatus.CANCELLED]), false);
  });

  it('le second volet : on n’accroche pas d’enfant a un parent clos', () => {
    // Sans ce volet, un parent DONE pouvait redevenir un parent a enfants ouverts
    // une seconde apres avoir ete clos, et le premier volet ne protegeait plus
    // rien.
    for (const statut of Object.values(TaskStatus)) {
      const clos = isClosedTaskStatus(statut);
      assert.equal(canAttachSubTask(statut), !clos, `parent ${statut}`);
    }
  });

  it('les statuts clos sont exactement DONE et CANCELLED', () => {
    assert.deepEqual([...CLOSED_TASK_STATUSES], [TaskStatus.DONE, TaskStatus.CANCELLED]);
  });
});

describe('modifiabilite d’une tache close', () => {
  it('un porteur de scope own ne modifie plus une tache close', () => {
    assert.equal(isTaskEditable(TaskStatus.DONE, false), false);
    assert.equal(isTaskEditable(TaskStatus.CANCELLED, false), false);
  });

  it('un porteur de task:write:any la modifie encore', () => {
    // C'est la sortie de secours : un developpeur qui s'est trompe de statut ne
    // peut pas se corriger lui-meme, le chef de projet le fait.
    assert.equal(isTaskEditable(TaskStatus.DONE, true), true);
    assert.equal(isTaskEditable(TaskStatus.CANCELLED, true), true);
  });

  it('une tache ouverte reste modifiable par son assigne', () => {
    for (const statut of [
      TaskStatus.TODO,
      TaskStatus.IN_PROGRESS,
      TaskStatus.BLOCKED,
      TaskStatus.IN_REVIEW,
    ]) {
      assert.equal(isTaskEditable(statut, false), true, `statut ${statut}`);
    }
  });
});

// -----------------------------------------------------------------------------
// Taches personnelles : transitions libres ; taches de projet : machine stricte
// -----------------------------------------------------------------------------

describe('transitions selon la nature de la tache', () => {
  const statuses = Object.values(TaskStatus);

  it('laisse une tache personnelle passer de n’importe quel statut a un autre', () => {
    for (const from of statuses) {
      for (const to of statuses) {
        assert.equal(
          canTransitionTaskFor({ isPersonal: true }, from, to),
          from !== to,
          `${from} -> ${to} sur une tache personnelle`,
        );
      }
    }
  });

  it('permet de decocher une tache personnelle terminee vers « a faire »', () => {
    assert.equal(canTransitionTaskFor({ isPersonal: true }, TaskStatus.DONE, TaskStatus.TODO), true);
    assert.equal(canTransitionTaskFor({ isPersonal: true }, TaskStatus.BLOCKED, TaskStatus.DONE), true);
  });

  it('garde exactement la machine stricte pour une tache de projet', () => {
    for (const from of statuses) {
      for (const to of statuses) {
        assert.equal(
          canTransitionTaskFor({ isPersonal: false }, from, to),
          from !== to && canTransitionTask(from, to),
          `${from} -> ${to} sur une tache de projet`,
        );
      }
    }
    assert.equal(canTransitionTaskFor({ isPersonal: false }, TaskStatus.DONE, TaskStatus.TODO), false);
    assert.equal(canTransitionTaskFor({ isPersonal: false }, TaskStatus.BLOCKED, TaskStatus.DONE), false);
  });
});

describe('filtre « sans assigne »', () => {
  it('demande assigneeId IS NULL', () => {
    assert.deepEqual(taskFilterWhere({ unassignedOnly: true }), { assigneeId: null });
  });

  it('laisse un assigne explicite l’emporter', () => {
    assert.deepEqual(taskFilterWhere({ unassignedOnly: true, assigneeId: 'dev-1' }), { assigneeId: 'dev-1' });
  });

  it('ne filtre rien sans la demande', () => {
    assert.deepEqual(taskFilterWhere({ unassignedOnly: false }), {});
  });
});

describe('qui peut recevoir une tache de projet', () => {
  const where = assignableUserWhere();

  it('exige un compte actif, non supprime, humain et non client', () => {
    assert.equal(where.deletedAt, null);
    assert.equal(where.status, UserStatus.ACTIVE);
    assert.equal(where.isServiceAccount, false);
    assert.ok(Array.isArray(where.AND));
    assert.deepEqual((where.AND as unknown[])[0], { roles: { none: { role: { code: RoleCode.CLIENT } } } });
  });

  it('exige un droit de LECTURE et un droit d’ECRITURE de tache, lus sur les roles', () => {
    const clauses = JSON.stringify(where.AND);
    for (const code of [...ASSIGNEE_READ_CODES, ...ASSIGNEE_WRITE_CODES]) {
      assert.ok(clauses.includes(code), `${code} doit faire partie des droits verifies`);
    }
    assert.equal((where.AND as unknown[]).length, 3, 'client exclu + lecture + ecriture');
  });

  it('ne compte pas les droits personnels comme une capacite de travail sur un projet', () => {
    const codes = [...ASSIGNEE_READ_CODES, ...ASSIGNEE_WRITE_CODES] as readonly string[];
    assert.equal(codes.includes('task:read:personal'), false);
    assert.equal(codes.includes('task:write:personal'), false);
  });
});

describe('« mes taches » (objectifs, minuteur)', () => {
  function bearer(permissions: string[], space?: 'personal' | 'team'): AccessPolicy {
    const user: AuthenticatedUser = {
      id: 'dev-1',
      email: 'dev@agence.example',
      firstName: 'Thomas',
      lastName: 'Lefevre',
      roles: [RoleCode.DEVELOPER],
      permissions: new Set(permissions),
      clientId: null,
      mustChangePassword: false,
      ...(space ? { space } : {}),
    };
    return new AccessPolicy(user);
  }

  it('borne toujours a l’assigne porteur, sur une tache vivante', () => {
    const where = mineTaskWhere(bearer(['task:read:assigned', 'task:read:personal']));
    assert.equal(where.deletedAt, null);
    const and = where.AND as unknown[];
    assert.deepEqual(and[0], { assigneeId: 'dev-1' });
  });

  it('accepte une tache personnelle (sans projet) comme une tache de projet vivant', () => {
    const where = mineTaskWhere(bearer(['task:read:assigned']));
    assert.deepEqual(where.OR, [{ project: { deletedAt: null } }, { projectId: null }]);
  });
});
