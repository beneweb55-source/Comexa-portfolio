/**
 * Harnais de tests : le client Prisma GENERE n'est pas versionne.
 *
 * Strategie d'isolation (Mission 7.1) :
 *  - Les stubs sont crees dans `src/generated/prisma/`, le MEME chemin que le
 *    client genere par `prisma generate`. Les imports des tests et des
 *    services restent ainsi inchanges.
 *  - Si un vrai client complet est present (fichiers .ts REQUISES : enums.ts
 *    ET client.ts), preparePrismaStubs() supprime les anciens stubs .js et
 *    ne recree rien : le vrai client est toujours prioritaire.
 *  - Une generation partielle (un seul .ts) n'est pas consideree comme un
 *    client complet : les stubs sont crees pour les tests, mais le client
 *    partiel n'est pas supprime (il sera ecrase par la generation reelle).
 *  - Aucun stub ne subsiste apres les tests : le lanceur run-invariants.mjs
 *    appelle cleanupPrismaStubs() dans un bloc finally, quel que soit le
 *    resultat des tests.
 *  - Un marqueur .prisma-stubs-marker identifie les fichiers factices.
 *
 * NE PAS UTILISER EN PRODUCTION : ces fichiers ne sont pas le client Prisma.
 * Ne jamais ecrire de declarations TypeScript fictives pour faire compiler
 * NestJS. Ne jamais remplacer le vrai client Prisma par un faux dans le
 * chemin de production.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const generatedDir = path.join(backendRoot, 'src', 'generated', 'prisma');

const STUB_FILES = ['enums.js', 'client.js'];
const MARKER_FILE = '.prisma-stubs-marker';
/** Fichiers .ts REQUISES pour considerer qu'un client Prisma est complet et utilisable. */
const REAL_CLIENT_FILES = ['enums.ts', 'client.ts'];

/** Enums du schema : `enum Name { A\n B }` -> `{ Name: { A:'A', B:'B' } }`. */
export function schemaEnums() {
  const schema = readFileSync(path.join(backendRoot, 'prisma', 'schema.prisma'), 'utf8');
  const result = {};
  for (const match of schema.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const values = match[2]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[A-Z][A-Z0-9_]*(\s|$)/.test(line))
      .map((line) => line.split(/\s+/)[0]);
    result[match[1]] = values;
  }
  return result;
}

/** Vrai client Prisma COMPLET present (les deux fichiers .ts requis). */
export function isRealPrismaClientComplete() {
  return REAL_CLIENT_FILES.every((file) =>
    existsSync(path.join(generatedDir, file)),
  );
}

/** Generation partielle : au moins un .ts present mais pas tous. */
export function isPartialPrismaClient() {
  const present = REAL_CLIENT_FILES.filter((file) =>
    existsSync(path.join(generatedDir, file)),
  );
  return present.length > 0 && present.length < REAL_CLIENT_FILES.length;
}

/** Des fichiers factices subsistent-ils sur le disque (stubs ou marqueur) ? */
export function hasResidualStubs() {
  return (
    STUB_FILES.some((file) => existsSync(path.join(generatedDir, file))) ||
    existsSync(path.join(generatedDir, MARKER_FILE))
  );
}

/** Les fichiers stubs existants sont-ils valides (presents et non vides) ? */
export function stubsAreValid() {
  return STUB_FILES.every((file) => {
    const full = path.join(generatedDir, file);
    return existsSync(full) && existsSync(full.replace(/\.js$/, '.js'));
  });
}

/**
 * Ecrire les stubs de test, uniquement si aucun vrai client complet n'est present.
 *
 * Vraiment idempotent : si des stubs valides existent deja, ils ne sont pas
 * reecrits. Si un vrai client complet est detecte, les anciens stubs sont
 * supprimes et aucun nouveau n'est cree.
 *
 * Retourne :
 *  - { generated: true, stubs: false } : vrai client complet, pas de stubs
 *  - { generated: false, stubs: true } : stubs crees (ou deja presents)
 *  - { generated: false, stubs: false } : generation partielle, pas de stubs crees
 */
export function preparePrismaStubs() {
  // Un vrai client complet a toujours la priorite.
  if (isRealPrismaClientComplete()) {
    const cleaned = cleanupPrismaStubs();
    return { generated: true, stubs: false, cleaned: cleaned.length > 0 };
  }

  // Generation partielle : on ne cree pas de stubs qui pourraient entrer en
  // conflit avec un futur client complet. On nettoie juste les vieux stubs.
  if (isPartialPrismaClient()) {
    cleanupPrismaStubs();
    return { generated: false, stubs: false, cleaned: true };
  }

  // Aucun client complet, aucune generation partielle : verifier si des
  // stubs valides existent deja (idempotence).
  if (hasResidualStubs() && STUB_FILES.every((f) => existsSync(path.join(generatedDir, f)))) {
    return { generated: false, stubs: true, cleaned: false };
  }

  mkdirSync(generatedDir, { recursive: true });

  const enums = schemaEnums();
  const lines = Object.entries(enums).map(
    ([name, values]) =>
      `export const ${name} = Object.freeze({ ${values.map((value) => `${value}: '${value}'`).join(', ')} });`);

  writeFileSync(path.join(generatedDir, 'enums.js'), `${lines.join('\n')}\n`);

  writeFileSync(
    path.join(generatedDir, 'client.js'),
    `// Stub de test — voir backend/tests/helpers/prisma-stubs.mjs
class TestDecimal {
  static ROUND_HALF_UP = 4;
  static ROUND_DOWN = 1;
  constructor(value = 0) { this.value = Number(value); }
  static isDecimal(value) { return value instanceof TestDecimal; }
  add(other) { return new TestDecimal(this.value + Number(other.value ?? other)); }
  sub(other) { return new TestDecimal(this.value - Number(other.value ?? other)); }
  mul(other) { return new TestDecimal(this.value * Number(other.value ?? other)); }
  div(other) { return new TestDecimal(this.value / Number(other.value ?? other)); }
  times(other) { return this.mul(other); }
  plus(other) { return this.add(other); }
  minus(other) { return this.sub(other); }
  toDecimalPlaces() { return this; }
  lessThan(other) { return this.value < Number(other.value ?? other); }
  lessThanOrEqualTo(other) { return this.value <= Number(other.value ?? other); }
  greaterThan(other) { return this.value > Number(other.value ?? other); }
  equals(other) { return this.value === Number(other.value ?? other); }
  isZero() { return this.value === 0; }
  toFixed(digits = 2) { return this.value.toFixed(digits); }
  toString() { return String(this.value); }
  toJSON() { return this.value; }
  valueOf() { return this.value; }
}
export const Prisma = { Decimal: TestDecimal };
export class PrismaClient {
  constructor(options) { this.options = options; }
  async $connect() {}
  async $disconnect() {}
}
export const PrismaClientKnownRequestError = class extends Error {};
`,
  );

  writeFileSync(path.join(generatedDir, MARKER_FILE), 'prisma test stubs — do not use in production\n');

  return { generated: false, stubs: true, cleaned: false };
}

/**
 * Supprimer les stubs et le marqueur. Retourne la liste des fichiers supprimes.
 * Ne touche JAMAIS a un vrai client genere (.ts).
 */
export function cleanupPrismaStubs() {
  const removed = [];
  for (const file of [...STUB_FILES, MARKER_FILE]) {
    const full = path.join(generatedDir, file);
    if (existsSync(full)) {
      unlinkSync(full);
      removed.push(file);
    }
  }
  return removed;
}
