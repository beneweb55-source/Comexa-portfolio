import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TimerSessionStatus } from '../../generated/prisma/enums.js';
import {
  canPauseTimer,
  canResumeTimer,
  canStopTimer,
  elapsedSecondsOf,
  minutesForSeconds,
} from './timer-rules.js';

describe('elapsedSecondsOf', () => {
  it('RUNNING cumule le solde et le segment en cours', () => {
    const now = new Date('2026-10-12T10:02:00.000Z');
    const session = {
      status: TimerSessionStatus.RUNNING,
      resumedAt: new Date('2026-10-12T10:00:00.000Z'),
      accumulatedSeconds: 45,
    };
    assert.equal(elapsedSecondsOf(session, now), 45 + 120);
  });

  it('PAUSED renvoie le solde sans segment', () => {
    const session = {
      status: TimerSessionStatus.PAUSED,
      resumedAt: null,
      accumulatedSeconds: 90,
    };
    assert.equal(elapsedSecondsOf(session, new Date('2099-01-01T00:00:00.000Z')), 90);
  });

  it('une horloge qui recule ne RETRANCHE pas le temps travaille', () => {
    const session = {
      status: TimerSessionStatus.RUNNING,
      resumedAt: new Date('2026-10-12T10:00:00.000Z'),
      accumulatedSeconds: 60,
    };
    const avant = new Date('2026-10-12T09:59:00.000Z');
    assert.equal(elapsedSecondsOf(session, avant), 60);
  });

  it('STOPPED fige le solde', () => {
    const session = {
      status: TimerSessionStatus.STOPPED,
      resumedAt: null,
      accumulatedSeconds: 3600,
    };
    assert.equal(elapsedSecondsOf(session, new Date('2099-01-01T00:00:00.000Z')), 3600);
  });
});

describe('minutesForSeconds', () => {
  it('arrondit a la minute la plus proche', () => {
    assert.equal(minutesForSeconds(59), 1);
    assert.equal(minutesForSeconds(90), 2);
    assert.equal(minutesForSeconds(3600), 60);
  });

  it('plancher a 1 minute : un geste reel ne produit jamais 0 ligne', () => {
    assert.equal(minutesForSeconds(0), 1);
    assert.equal(minutesForSeconds(12), 1);
    assert.equal(minutesForSeconds(-30), 1);
  });

  it('plafond a 1440 minutes : le meme plafond que la saisie manuelle', () => {
    assert.equal(minutesForSeconds(100000), 1440);
    assert.equal(minutesForSeconds(3 * 24 * 3600), 1440);
  });
});

describe('transitions du minuteur', () => {
  it('pause : RUNNING seulement', () => {
    assert.equal(canPauseTimer(TimerSessionStatus.RUNNING), true);
    assert.equal(canPauseTimer(TimerSessionStatus.PAUSED), false);
    assert.equal(canPauseTimer(TimerSessionStatus.STOPPED), false);
  });

  it('reprise : PAUSED seulement', () => {
    assert.equal(canResumeTimer(TimerSessionStatus.PAUSED), true);
    assert.equal(canResumeTimer(TimerSessionStatus.RUNNING), false);
    assert.equal(canResumeTimer(TimerSessionStatus.STOPPED), false);
  });

  it('arret : les deux etats actifs, jamais une session deja terminee', () => {
    assert.equal(canStopTimer(TimerSessionStatus.RUNNING), true);
    assert.equal(canStopTimer(TimerSessionStatus.PAUSED), true);
    assert.equal(canStopTimer(TimerSessionStatus.STOPPED), false);
  });
});
