/**
 * CREATION DU PREMIER JETON D'INTEGRATION (procedure sure).
 *
 * Pourquoi un script et pas une route : la premiere machine doit pouvoir etre
 * autorisee SANS qu'aucune machine ne soit deja autorisee — le probléme de la
 * poule et de l'oeuf. Une route aurait exigé un administrateur deja connecte, ce
 * qui est justement ce que ce script evite d'avoir a faire a la main en base.
 *
 * Il s'execute donc COTE SERVEUR, avec l'acces direct a la base :
 *
 *     cd backend
 *     INTEGRATION_NAME=n8n-production \
 *     INTEGRATION_SCOPES=task:read:any,task:write:any,project:read:any \
 *     INTEGRATION_EXPIRES_DAYS=365 \
 *     npm run integration:token
 *
 * LE SECRET S'AFFICHE UNE SEULE FOIS, dans la sortie de cette commande. Il
 * n'est pas stocke : la base ne garde que son empreinte. Le copier directement
 * dans les identifiants n8n, puis le supprimer de l'historique du terminal.
 *
 * Ce script n'ouvre aucune session et ne modifie aucun droit humain : il cree un
 * compte TECHNIQUE (sans role) et un jeton dont les droits sont exactement ceux
 * de `INTEGRATION_SCOPES`.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { ALL_PERMISSION_CODES } from '../src/common/auth/permissions.catalogue.js';
import {
  generateIntegrationToken,
  hashIntegrationToken,
  integrationEmailFor,
  isValidIntegrationName,
  normalizeIntegrationScopes,
} from '../src/common/auth/integration-token.js';
import { hashPassword } from '../src/common/security/password.js';

const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL;

if (!connectionString) {
  console.error('DATABASE_URL est absente. Impossible de se connecter a la base de donnees.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function createIntegrationToken(): Promise<void> {
  const name = (process.env.INTEGRATION_NAME ?? '').trim();
  const requested = (process.env.INTEGRATION_SCOPES ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
  const expiresInDays = Number(process.env.INTEGRATION_EXPIRES_DAYS ?? '') || null;

  if (!isValidIntegrationName(name)) {
    console.error(
      'INTEGRATION_NAME est invalide : minuscules, chiffres et tirets, 3 a 40 caracteres (ex. n8n-production).',
    );
    process.exit(1);
  }

  // Meme validation que l'API, et pas une copie : les refus (code inconnu,
  // gestion des integrations) sont identiques, sinon un jeton cree au script
  // pourrait avoir des droits qu'une route refuserait.
  const scopes = normalizeIntegrationScopes(requested, ALL_PERMISSION_CODES);
  if (!scopes.ok) {
    console.error('Permissions refusees :', {
      inconnues: scopes.unknown,
      interdites: scopes.forbidden,
    });
    process.exit(1);
  }

  if (scopes.scopes.length === 0) {
    console.error(
      'INTEGRATION_SCOPES est vide. Un jeton sans permission ne sert a rien ; au moins un code est attendu.',
    );
    process.exit(1);
  }

  const secret = generateIntegrationToken();
  const existing = await prisma.integrationToken.findUnique({
    where: { name },
    select: { id: true, prefix: true },
  });

  if (existing) {
    console.error(
      `Une integration « ${name} » existe deja (${existing.prefix}…). Utilisez ` +
        'POST /integrations/tokens/:id/renew pour changer son secret, ou supprimez-la.',
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  const account = await prisma.user.create({
    data: {
      email: integrationEmailFor(name),
      passwordHash: await hashPassword(randomBytes(32).toString('base64url')),
      firstName: name,
      lastName: 'Integration',
      isServiceAccount: true,
      isEmailVerified: true,
      mustChangePassword: false,
    },
    select: { id: true },
  });

  const token = await prisma.integrationToken.create({
    data: {
      name,
      prefix: secret.slice(0, 12),
      tokenHash: hashIntegrationToken(secret),
      scopes: scopes.scopes,
      accountId: account.id,
      // Pas d'auteur humain : ce jeton est cree hors session, par un operateur
      // qui a deja acces au serveur. Le journal d'audit le verra sans auteur,
      // ce qui est exactement l'information utile.
      createdById: null,
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null,
    },
    select: { id: true, prefix: true, expiresAt: true },
  });

  console.log('');
  console.log('Jeton d’integration cree.');
  console.log(`  nom       : ${name}`);
  console.log(`  identifiant: ${token.id}`);
  console.log(`  prefixe   : ${token.prefix}… (reconnaissance, jamais un secret)`);
  console.log(`  droits    : ${scopes.scopes.join(', ')}`);
  console.log(`  expiration: ${token.expiresAt?.toISOString() ?? 'aucune'}`);
  console.log('');
  console.log('SECRET — affiche une seule fois, il n’est pas stocke :');
  console.log('');
  console.log(`    ${secret}`);
  console.log('');
  console.log('A copier dans n8n : Credential « Header Auth », en-tete Authorization,');
  console.log(`valeur « Bearer ${secret} ». Toute autre copie est a proscrire.`);
  console.log('');
}

createIntegrationToken()
  .catch((error) => {
    console.error('Erreur lors de la creation du jeton :', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
