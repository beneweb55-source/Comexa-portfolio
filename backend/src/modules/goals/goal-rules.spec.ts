import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GoalStatus, TaskStatus } from '../../generated/prisma/enums.js';
import { achievedAtAfter, goalAcceptsTasks, goalProgressOf, isGoalColor } from './goal-rules.js';

describe('goalProgressOf', () => {
  it('rend 0 % pour un objectif sans tache', () => {
    assert.deepEqual(goalProgressOf([]), { total: 0, done: 0, open: 0, cancelled: 0, percent: 0 });
  });

  it('compte les taches terminees sur les taches comptables', () => {
    const progress = goalProgressOf([
      TaskStatus.DONE,
      TaskStatus.TODO,
      TaskStatus.IN_PROGRESS,
      TaskStatus.DONE,
    ]);
    assert.equal(progress.total, 4);
    assert.equal(progress.done, 2);
    assert.equal(progress.open, 2);
    assert.equal(progress.percent, 50);
  });

  it('retire les taches annulees du denominateur', () => {
    const progress = goalProgressOf([TaskStatus.DONE, TaskStatus.CANCELLED, TaskStatus.CANCELLED]);
    assert.equal(progress.cancelled, 2);
    assert.equal(progress.open, 0);
    assert.equal(progress.percent, 100, 'une tache faite sur une seule comptable');
  });

  it('ne divise pas par zero quand tout est annule', () => {
    assert.equal(goalProgressOf([TaskStatus.CANCELLED]).percent, 0);
  });

  it('compte une tache bloquee ou en revue comme ouverte', () => {
    const progress = goalProgressOf([TaskStatus.BLOCKED, TaskStatus.IN_REVIEW, TaskStatus.DONE]);
    assert.equal(progress.open, 2);
    assert.equal(progress.percent, 33);
  });
});

describe('achievedAtAfter', () => {
  const now = new Date('2026-10-16T10:00:00Z');
  const earlier = new Date('2026-10-01T09:00:00Z');

  it('date l’atteinte au moment ou elle est declaree', () => {
    assert.equal(achievedAtAfter({ status: GoalStatus.ACTIVE, achievedAt: null }, GoalStatus.ACHIEVED, now), now);
  });

  it('garde la date d’origine si l’objectif etait deja atteint', () => {
    assert.equal(
      achievedAtAfter({ status: GoalStatus.ACHIEVED, achievedAt: earlier }, GoalStatus.ACHIEVED, now),
      earlier,
    );
  });

  it('efface la date quand on rouvre l’objectif', () => {
    assert.equal(achievedAtAfter({ status: GoalStatus.ACHIEVED, achievedAt: earlier }, GoalStatus.ACTIVE, now), null);
  });

  it('n’invente ni n’efface une reussite en archivant', () => {
    assert.equal(achievedAtAfter({ status: GoalStatus.ACHIEVED, achievedAt: earlier }, GoalStatus.ARCHIVED, now), earlier);
    assert.equal(achievedAtAfter({ status: GoalStatus.ACTIVE, achievedAt: null }, GoalStatus.ARCHIVED, now), null);
  });
});

describe('goalAcceptsTasks / isGoalColor', () => {
  it('refuse les nouvelles taches sur un objectif archive seulement', () => {
    assert.equal(goalAcceptsTasks(GoalStatus.ACTIVE), true);
    assert.equal(goalAcceptsTasks(GoalStatus.ACHIEVED), true);
    assert.equal(goalAcceptsTasks(GoalStatus.ARCHIVED), false);
  });

  it('n’accepte que les teintes de la charte', () => {
    assert.equal(isGoalColor('lilac'), true);
    assert.equal(isGoalColor('red'), false);
    assert.equal(isGoalColor(undefined), false);
  });
});
