/**
 * Harnais de tests : le client Prisma GENERE n'est pas versionne.
 *
 * Strategie d'isolation retenue (Mission 7) :
 *  - Les stubs sont crees dans `src/generated/prisma/`, le MEME chemin que le
 *    client genere par `prisma generate`. Les imports des tests et des
 *    services (../../generated/prisma/enums.js, ../../generated/prisma/client.js)
 *    restent ainsi inchangés : aucune adaptation des sources n'est necessaire.
 *  - Si un vrai client genere est present (fichiers .ts), preparePrismaStubs()
 *    supprime les eventuels anciens stubs .js et ne recree rien : le vrai
 *    client est toujours prioritaire (tsx et Node resoudent ./en.js vers
 *    ./en.ts en priorite).
 *  - Aucun stub ne subsiste apres les tests : cleanupPrismaStubs() est appele
 *    dans un afterAll de chaque suite, et via posttest:invariants.
 *  - Un marqueur .prisma-stubs-marker identifie les fichiers factices pour
 *    eviter toute confusion avec le client de production.
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

/** Vrai client Prisma genere present ? (fichiers .ts, jamais les stubs .js) */
export function isRealPrismaClientPresent() {
  return (
    existsSync(path.join(generatedDir, 'enums.ts')) ||
    existsSync(path.join(generatedDir, 'client.ts'))
  );
}

/** Des fichiers factices subsistent-ils sur le disque (stubs ou marqueur) ? */
export function hasResidualStubs() {
  return (
    STUB_FILES.some((file) => existsSync(path.join(generatedDir, file))) ||
    existsSync(path.join(generatedDir, MARKER_FILE))
  );
}

/**
 * Ecrire les stubs de test, uniquement si aucun vrai client n'est present.
 *
 * Idempotent : appeler plusieurs fois produit le meme etat. Si un vrai client
 * est detecte, les anciens stubs sont supprimes et aucun nouveau n'est crees.
 */
export function preparePrismaStubs() {
  // Un vrai client genere a toujours la priorite : on nettoie les eventuels
  // stubs residus et on ne recree rien.
  if (isRealPrismaClientPresent()) {
    const cleaned = cleanupPrismaStubs();
    return { generated: true, stubs: false, cleaned: cleaned.length > 0 };
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
