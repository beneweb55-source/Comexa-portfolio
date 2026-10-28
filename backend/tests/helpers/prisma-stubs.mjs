/**
 * Harnais de tests : le client Prisma GENERE n'est pas versionne.
 *
 * En CI, `npm run prisma:generate` cree `src/generated/prisma/*.ts` et ce
 * fichier ne fait RIEN. Dans un environnement hors ligne, `prisma generate`
 * echoue sur le telechargement de `schema-engine` (binaries.prisma.sh). On
 * fabrique alors, UNIQUEMENT POUR LES TESTS, deux stubs `.js` dans ce dossier
 * gitignore : les enums (lus depuis le schema, donc jamais recopies a la main)
 * et la surface minimale du client. Les services sont testes avec un faux
 * `PrismaService` : aucun de ces stubs ne touche a une base de donnees.
 *
 * NE PAS UTILISER EN PRODUCTION : ces fichiers ne sont pas le client Prisma.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const generatedDir = path.join(backendRoot, 'src', 'generated', 'prisma');

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

export function preparePrismaStubs() {
  // Un vrai client genere a toujours la priorite.
  if (existsSync(path.join(generatedDir, 'enums.ts'))) return { generated: false, stubs: false };
  mkdirSync(generatedDir, { recursive: true });

  const enums = schemaEnums();
  const lines = Object.entries(enums).map(
    ([name, values]) =>
      `export const ${name} = Object.freeze({ ${values.map((value) => `${value}: '${value}'`).join(', ')} });`,
  );
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
  return { generated: false, stubs: true };
}
