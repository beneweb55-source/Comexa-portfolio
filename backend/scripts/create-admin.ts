import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, RoleCode, UserStatus } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/common/security/password.js';
import { databaseTargetOf, hostOf } from '../src/health/database-target.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL est absente. Impossible de se connecter à la base de données.');
  process.exit(1);
}

// Affiché AVANT toute opération : quand le compte « existe pourtant » dans une
// autre base, c'est ce nom d'hôte qui tranche (incident 2026-10-21). Comparer
// avec l'hôte de DATABASE_URL dans le tableau de bord Render.
console.log(
  `Base cible : ${hostOf(connectionString) ?? 'hôte illisible'} (${databaseTargetOf(connectionString)})`,
);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function createAdmin() {
  try {
    const email = (process.env.ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || '')
      .trim()
      .toLowerCase();
    const password = process.env.ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD || '';
    const firstName = (process.env.ADMIN_FIRST_NAME || 'Admin').trim();
    const lastName = (process.env.ADMIN_LAST_NAME || 'User').trim();
    // Opt-in explicite : réinitialiser le mot de passe d'un compte EXISTANT est
    // une action destructive (l'ancien mot de passe cesse de fonctionner). Sans
    // ce drapeau, le comportement historique est conservé : création avec mot de
    // passe, mise à jour SANS y toucher — le piège du 2026-10-21, où le mot de
    // passe passé à ce script avait été ignoré sans le moindre avertissement.
    const resetPassword = /^(1|true|yes)$/i.test(process.env.ADMIN_RESET_PASSWORD || '');

    if (!email || !password) {
      console.error('ADMIN_EMAIL et ADMIN_PASSWORD doivent être définis.');
      process.exit(1);
    }

    const passwordHash = await hashPassword(password);

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, deletedAt: true },
    });

    let user;
    if (existing) {
      user = await prisma.user.update({
        where: { id: existing.id },
        data: {
          firstName,
          lastName,
          status: UserStatus.ACTIVE,
          isEmailVerified: true,
          emailVerifiedAt: new Date(),
          deletedAt: null,
          ...(resetPassword
            ? {
                passwordHash,
                mustChangePassword: false,
                failedLoginAttempts: 0,
                lockedUntil: null,
              }
            : {}),
        },
        select: { id: true },
      });
      console.log(`Compte administrateur mis à jour : ${email}`);
      if (resetPassword) {
        console.log('Mot de passe réinitialisé (ADMIN_RESET_PASSWORD).');
      } else {
        console.log(
          'Mot de passe INCHANGÉ (compte existant). ' +
            'Pour le réinitialiser : ADMIN_RESET_PASSWORD=1 avec ADMIN_PASSWORD.',
        );
      }
    } else {
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          status: UserStatus.ACTIVE,
          isEmailVerified: true,
          emailVerifiedAt: new Date(),
          mustChangePassword: false, // Forcer le mot de passe défini par l'utilisateur
        },
        select: { id: true },
      });
      console.log(`Compte administrateur créé : ${email}`);
    }

    const role = await prisma.role.findUniqueOrThrow({
      where: { code: RoleCode.ADMIN },
      select: { id: true },
    });

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });

    console.log('Rôle ADMIN attribué avec succès.');
  } catch (error) {
    console.error("Erreur lors de la création de l'administrateur :", error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
