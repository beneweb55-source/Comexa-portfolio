/**
 * CIBLE DE BASE DE DONNÉES — tests de la règle pure.
 *
 * Voir database-target.ts : ces noms sont ceux de `GET /api/health`, la seule
 * réponse publique qui parle de la base. Un changement ici change ce que
 * l'exploitant lit en production — et l'incident 2026-10-21 a montré que ce
 * champ est le premier réflexe de diagnostic.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { databaseTargetOf, hostOf } from '../src/health/database-target.js';

test('reconnaît les familles d\'hébergement réelles du projet', () => {
  assert.equal(
    databaseTargetOf('postgresql://user:pass@db.abc123.supabase.co:5432/postgres?pgbouncer=true'),
    'supabase',
  );
  assert.equal(
    databaseTargetOf('postgresql://user:pass@ep-cool-lab.aws.neon.tech:5432/neondb?sslmode=require'),
    'neon',
  );
  assert.equal(
    databaseTargetOf('postgresql://user:pass@localhost:5432/dev'),
    'autre',
  );
});

test('chaîne absente ou illisible → autre (jamais d\'erreur, jamais de faux positif)', () => {
  assert.equal(databaseTargetOf(undefined), 'autre');
  assert.equal(databaseTargetOf(''), 'autre');
  assert.equal(databaseTargetOf('pas-une-url'), 'autre');
  assert.equal(hostOf(undefined), null);
  assert.equal(hostOf('pas-une-url'), null);
});

test("hostOf extrait le nom d'hôte — et rien d'autre (jamais l'identifiant)", () => {
  assert.equal(
    hostOf('postgresql://user:s3cret@db.abc123.supabase.co:5432/postgres'),
    'db.abc123.supabase.co',
  );
});
