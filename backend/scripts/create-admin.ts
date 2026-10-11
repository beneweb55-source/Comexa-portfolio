import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, RoleCode, UserStatus } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/common/security/password.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL est absente. Impossible de se connecter à la base de données.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function createAdmin() {
  try {
    const email = (process.env.ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD || '';
    const firstName = (process.env.ADMIN_FIRST_NAME || 'Admin').trim();
    const lastName = (process.env.ADMIN_LAST_NAME || 'User').trim();

    if (!email || !password) {
      console.error("ADMIN_EMAIL et ADMIN_PASSWORD doivent être définis.");
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
        },
        select: { id: true },
      });
      console.log(`Compte administrateur mis à jour : ${email}`);
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

    console.log("Rôle ADMIN attribué avec succès.");
  } catch (error) {
    console.error("Erreur lors de la création de l'administrateur :", error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
