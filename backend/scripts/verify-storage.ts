#!/usr/bin/env node
/**
 * VERIFICATION REELLE DU STOCKAGE OBJET.
 *
 *   node --import tsx scripts/verify-storage.ts [chemin-du-fichier-env]
 *
 * Chemin par defaut : backend/.env.render
 *
 * POURQUOI CE SCRIPT EXISTE.
 * Les variables S3 sont les seules dont une valeur FAUSSE ne se distingue pas
 * d'une valeur ABSENTE. `assertS3Configured` (storage.module.ts) ne teste que la
 * presence : une cle mal recopiee franchit le demarrage, le serveur journalise
 * « Stockage objet : bucket "..." », et la panne n'apparait qu'au premier envoi
 * de fichier — c'est-a-dire chez un utilisateur, sous la forme d'une erreur de
 * signature qui n'accuse pas la ligne fautive. Le trajet pour le savoir est
 * long : modifier une variable dans un tableau de bord, attendre un
 * redeploiement, deposer un fichier, lire un journal.
 *
 * Ce script fait ce trajet une fois, en quelques secondes, depuis la machine.
 *
 * POURQUOI IL EMPRUNTE LE VRAI PILOTE.
 * Il n'ouvre pas son propre client S3 et n'ecrit aucune requete a la main. Un
 * script qui parlerait a B2 avec son propre client ne verifierait que lui-meme :
 * il pourrait reussir pendant que `S3StorageDriver` echoue, ou l'inverse. Ici, ce
 * sont `S3StorageDriver`, `buildStorageKey` et `SIGNED_URL_TTL_SECONDS` du depot
 * qui sont appeles, dans l'ordre ou l'application les appelle. Si ce script
 * passe, c'est le code de production qui a passe.
 *
 * CE QU'IL VERIFIE, DANS L'ORDRE.
 *   1. `put`           — l'ecriture, donc les droits et la signature.
 *   2. `exists`        — la relecture, et le fait qu'un objet present soit vu.
 *   3. `getSignedUrl`  — suivie pour de vrai : c'est le chemin du navigateur.
 *   4. `exists` (faux) — qu'une absence soit DISTINGUEE d'un refus.
 *   5. `delete`        — le droit de suppression, puis l'absence confirmee.
 *
 * L'etape 4 n'est pas decorative. `exists` relance toute erreur qui n'est pas un
 * 404 (voir s3.driver.ts). Un pilote qui confondrait « droits refuses » et
 * « objet absent » ferait croire a un fichier perdu, et un nettoyage automatique
 * supprimerait la ligne en base d'un objet qui existe toujours : une perte de
 * donnees silencieuse. On verifie donc que le 404 est bien reconnu.
 *
 * CE QU'IL NETTOIE. L'objet de test est supprime a la fin, y compris quand une
 * etape echoue. Sa cle porte le prefixe `documents/` et un UUID : tout residu
 * eventuel est identifiable comme tel.
 *
 * CE QU'IL N'AFFICHE JAMAIS. Ni `S3_ACCESS_KEY_ID`, ni `S3_SECRET_ACCESS_KEY`.
 * Chaque cle est decrite par sa LONGUEUR et par la presence d'espaces parasites,
 * ce qui suffit a diagnostiquer une copie tronquee ou un collage fautif — soit
 * exactement les deux causes reelles d'un `401` chez Backblaze — sans recopier
 * le secret dans un terminal, un journal de CI ou une conversation.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { S3StorageDriver } from '../src/common/storage/s3.driver.js';
import { buildStorageKey, isSafeStorageKey } from '../src/common/storage/storage.key.js';
import { SIGNED_URL_TTL_SECONDS, type S3Config } from '../src/common/storage/storage.types.js';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, '..');
const envPath = resolve(backendRoot, process.argv[2] ?? '.env.render');

/**
 * Longueurs connues chez Backblaze, pour reperer une copie tronquee.
 *
 * CE SONT DES AVERTISSEMENTS, JAMAIS DES CONTROLES BLOQUANTS. Une longueur
 * inattendue ne prouve rien : Backblaze emploie au moins deux formats de keyID
 * — 12 caracteres pour les cles historiques, 27 pour celles creees aujourd'hui,
 * qui reprennent en tete l'identifiant du compte. Coder cette liste comme un
 * controle bloquant ferait refuser une cle parfaitement valide ; c'est arrive en
 * ecrivant ce script, et c'est pourquoi la seule autorite reconnue ici reste
 * l'appel reel a Backblaze, plus bas.
 */
const KNOWN_LENGTHS: ReadonlyArray<{
  readonly name: string;
  readonly lengths: readonly number[];
  readonly note: string;
}> = [
  {
    name: 'S3_ACCESS_KEY_ID',
    lengths: [12, 27],
    note: 'un keyID Backblaze fait 12 caracteres (format historique) ou 27 (format actuel)',
  },
  {
    name: 'S3_SECRET_ACCESS_KEY',
    lengths: [31],
    note: 'un applicationKey Backblaze compte 31 caracteres',
  },
];

function main(): void {
  if (!existsSync(envPath)) {
    fail(`Fichier introuvable : ${envPath}`);
  }

  const raw = readEnvFile(envPath);
  const declared = readEnvFileRaw(envPath);

  console.log(`Variables lues depuis : ${envPath}`);
  console.log(`Endpoint  : ${raw.S3_ENDPOINT || '(non defini)'}`);
  console.log(`Region    : ${raw.S3_REGION || '(non definie)'}`);
  console.log(`Bucket    : ${raw.S3_BUCKET || '(non defini)'}`);
  console.log(`Chemin    : ${raw.S3_FORCE_PATH_STYLE || '(non defini, defaut true)'}`);
  console.log('');
  console.log('Identifiants (longueur et forme seulement, jamais la valeur) :');

  // SEUL CAS BLOQUANT : une variable vide. Une longueur inattendue ne bloque
  // pas, parce qu'elle ne prouve rien et que l'appel reel qui suit, lui, prouve.
  let absent = false;
  for (const { name, lengths, note } of KNOWN_LENGTHS) {
    const value = raw[name];
    if (!value) {
      console.log(`  ${name} : VIDE — rien a verifier`);
      absent = true;
      continue;
    }

    const suspect = declared[name] ?? value;
    console.log(`  ${name} : ${value.length} caracteres`);

    if (suspect !== suspect.trim()) {
      console.log('  → ATTENTION : espaces en debut ou fin de ligne dans le fichier.');
      console.log("    C'est la cause la plus frequente d'un 401 chez Backblaze.");
    }
    if (!lengths.includes(value.length)) {
      console.log(`  → Longueur inhabituelle : ${note}.`);
      console.log('    Avertissement seulement — la verification reelle suit.');
    }
  }
  console.log('');

  if (absent) {
    fail(
      'Identifiants absents. Remplir S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY dans le ' +
        'fichier ci-dessus, puis relancer.',
    );
  }

  const config: S3Config = {
    endpoint: raw.S3_ENDPOINT || undefined,
    region: raw.S3_REGION ?? '',
    bucket: raw.S3_BUCKET ?? '',
    accessKeyId: raw.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: raw.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: readBoolean(raw.S3_FORCE_PATH_STYLE, true),
  };

  const missing = (['region', 'bucket', 'accessKeyId', 'secretAccessKey'] as const).filter(
    (field) => config[field].length === 0,
  );
  if (missing.length > 0) {
    fail(`Champs obligatoires manquants dans le fichier : ${missing.join(', ')}`);
  }

  const driver = new S3StorageDriver(config);
  const key = buildStorageKey('documents', 'text/plain');
  const marker = `comexa-verification-${randomUUID()}`;

  console.log(`Cle de test : ${key}`);
  console.log(`Le pilote accepte cette cle : ${isSafeStorageKey(key)}`);
  console.log('');

  run(driver, key, marker, raw.S3_ENDPOINT ?? '');
}

function run(driver: S3StorageDriver, key: string, marker: string, endpoint: string): void {
  void (async () => {
    let written = false;

    try {
      step('1/5', 'put — ecriture du fichier de test');
      await driver.put(key, marker, 'text/plain');
      written = true;
      ok('Ecriture acceptee : les droits sont suffisants et la signature est valide.');

      step('2/5', "exists — relecture de ce qui vient d'etre ecrit");
      const present = await driver.exists(key);
      if (!present) {
        throw new Error(
          "L'ecriture a ete acceptee mais l'objet est introuvable. C'est le symptome " +
            "d'un bucket different de celui de la configuration, ou d'une region qui ne " +
            "correspond pas a l'endpoint.",
        );
      }
      ok("L'objet ecrit est bien retrouve.");

      step('3/5', 'getSignedUrl — le lien que suivra le navigateur');
      const url = await driver.getSignedUrl(key, SIGNED_URL_TTL_SECONDS);
      console.log(`     ${describeUrl(url)}`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Le lien signe a repondu ${response.status} ${response.statusText}. ` +
            'Sans cet acces, aucun client ne peut telecharger un document.',
        );
      }
      const body = await response.text();
      if (body !== marker) {
        throw new Error(
          'Le lien signe a rendu un contenu different de celui qui a ete ecrit. ' +
            'Ne jamais accepter ce cas : il signifierait que deux objets se recouvrent.',
        );
      }
      ok('Le lien signe a rendu exactement le contenu ecrit. Le telechargement fonctionne.');

      step('4/5', 'exists sur une cle absente — un 404 doit etre reconnu comme une absence');
      const absentKey = buildStorageKey('documents', 'text/plain');
      const absent = await driver.exists(absentKey);
      if (absent) {
        throw new Error(
          "Une cle qui n'a jamais ete ecrite est signalee comme presente. Le pilote " +
            'confond absence et refus, et un nettoyage automatique supprimerait des ' +
            'fichiers existants.',
        );
      }
      ok('Une absence est bien rendue comme une absence, et non comme une erreur.');

      step('5/5', "delete — suppression, puis confirmation de l'absence");
      await driver.delete(key);
      written = false;
      const stillThere = await driver.exists(key);
      if (stillThere) {
        throw new Error(
          "L'objet est toujours present apres une suppression. Les fichiers supprimes " +
            'resteraient factures et accessibles par un ancien lien signe.',
        );
      }
      ok('Suppression confirmee.');

      console.log('');
      console.log(
        'RESULTAT : le stockage objet est utilisable tel quel. Endpoint, region, bucket, ' +
          'droits et URL signee ont tous ete exerces.',
      );
      console.log('Les memes variables peuvent donc etre reportees dans Render sans ajustement.');
    } finally {
      // Le nettoyage a lieu meme quand une etape a echoue, pour ne pas laisser
      // derriere soi un objet que personne ne penserait a supprimer.
      if (written) {
        try {
          await driver.delete(key);
          console.log(`\nObjet de test supprime apres echec : ${key}`);
        } catch {
          console.log(
            `\nATTENTION : l'objet de test n'a pas pu etre supprime : ${key}\n` +
              'Le supprimer depuis la console Backblaze.',
          );
        }
      }
    }
  })().catch((error: unknown) => {
    console.log('');
    fail(describeFailure(error, endpoint));
  });
}

function step(label: string, title: string): void {
  console.log(`--- ${label} : ${title}`);
}

function ok(message: string): void {
  console.log(`     OK — ${message}\n`);
}

/**
 * Lit un fichier d'environnement au format `CLE=valeur`.
 *
 * Les guillemets qui entourent la valeur sont retires, parce que les hebergeurs
 * les conservent volontiers tels qu'ils ont ete saisis — c'est le meme piege que
 * celui corrige dans `parseSender`, et il vaut ici pour les memes raisons.
 */
function readEnvFile(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(readEnvFileRaw(path))) {
    result[name] = unquote(value);
  }
  return result;
}

/** Version brute, sans retrait des guillemets : sert a detecter les espaces. */
function readEnvFileRaw(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    result[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1);
  }
  return result;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    if ((first === '"' || first === "'") && first === trimmed[trimmed.length - 1]) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/** Reprend la lecture de `storage.module.ts`, pour ne pas diverger du runtime. */
function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  return fallback;
}

/** L'URL signee porte sa signature dans ses parametres : on n'en montre que la forme. */
function describeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `Lien signe vers ${parsed.host}${parsed.pathname}`;
  } catch {
    return 'Lien signe recu (illisible comme URL, ce qui est deja un signal).';
  }
}

/**
 * Traduit une erreur du SDK en cause probable.
 *
 * Le SDK ne rend pas le corps XML de l'erreur : il en extrait un nom et un code
 * HTTP. Ce sont eux qui portent le diagnostic, et les combinaisons possibles
 * sont peu nombreuses. Chaque cas cite ci-dessous correspond a une cause reelle.
 */
function describeFailure(error: unknown, endpoint: string): string {
  const name = (error as { name?: string }).name ?? 'Error';
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { Code?: string }).Code ?? (error as { code?: string }).code;

  const lines = [`ECHEC — ${name}${status ? ` (HTTP ${status})` : ''}`, message];

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    lines.push(
      '',
      "L'adresse de l'endpoint ne se resout pas. Verifier S3_ENDPOINT, caractere par " +
        'caractere, contre le champ « Endpoint » de la fiche du bucket.',
    );
  } else if (name === 'NoSuchBucket' || status === 404) {
    lines.push(
      '',
      "Le bucket n'existe pas a cette adresse. C'est presque toujours S3_REGION ou " +
        'S3_ENDPOINT qui ne correspond pas a la region reelle du bucket. Recopier les deux ' +
        'champs de la fiche du bucket plutot que les deduire de son nom.',
      `Endpoint essaye : ${endpoint || '(aucun)'}`,
    );
  } else if (status === 401 || name === 'InvalidAccessKeyId' || name === 'SignatureDoesNotMatch') {
    lines.push(
      '',
      'La signature a ete refusee. Verifier dans cet ordre :',
      '  1. que la valeur ne finit pas par un espace (piege le plus frequent) ;',
      "  2. que le keyID et l'applicationKey n'ont pas ete intervertis ;",
      "  3. que la cle n'a pas ete supprimee dans Backblaze depuis la copie ;",
      "  4. que l'applicationKey a bien ete recopiee en entier — elle n'est affichee " +
        "qu'une seule fois, et une cle tronquee se voit a sa longueur.",
    );
  } else if (status === 403 || name === 'AccessDenied') {
    lines.push(
      '',
      "La cle est reconnue mais n'a pas le droit demande sur ce bucket. Elle est " +
        'probablement restreinte a un autre bucket, ou creee avec « Read Only » alors que ' +
        "l'envoi de fichiers demande « Read and Write ».",
    );
  } else if (code === 'ETIMEDOUT' || code === 'ECONNRESET') {
    lines.push('', "La connexion n'a pas abouti. Verifier l'acces reseau vers cet endpoint.");
  } else {
    lines.push(
      '',
      'Cause inconnue de ce script. Lire le nom et le code HTTP ci-dessus : ce sont eux ' +
        'que Backblaze documente, et ils designent la cause exacte.',
    );
  }

  return lines.join('\n');
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exitCode = 1;
  process.exit(1);
}

main();
