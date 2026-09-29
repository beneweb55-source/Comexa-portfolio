// =============================================================================
// Configuration Prisma 7
// =============================================================================
// Depuis la version 7, l'URL de connexion ne s'ecrit PLUS dans schema.prisma :
// `url` et `directUrl` ont ete retires du bloc `datasource`. C'est ce fichier
// qui porte la connexion utilisee par la CLI (migrations, introspection), et
// il remplace aussi l'ancien bloc `"prisma": { "seed": ... }` de package.json.
//
// Les variables d'environnement ne sont pas chargees automatiquement : d'ou
// l'import de `dotenv/config` en premiere ligne.
// =============================================================================

import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Pourquoi `process.env` et non le helper `env()` de Prisma :
//
// `env()` LEVE une exception quand la variable n'existe pas — et la CLI charge
// ce fichier pour TOUTES ses commandes, y compris `prisma generate`, qui n'a
// pourtant pas besoin de la base. Un `prisma generate` lance dans une image
// Docker sans .env echouerait donc. On lit donc `process.env` directement, avec
// un repli sur la chaine vide : `generate` passe, et `migrate` echoue plus loin
// avec un message explicite si l'URL manque reellement.
//
// Pourquoi DIRECT_URL en premier :
//
// Neon expose deux hotes. L'hote POOLI (PgBouncer, mode transaction) convient
// au trafic applicatif mais gere mal le DDL des migrations. L'hote DIRECT est
// donc prefere ici, cote CLI ; l'application, elle, se connecte a l'hote pooli
// via DATABASE_URL (voir PrismaService). Le partage pooli/direct survit, il a
// simplement change d'endroit.
const migrationUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `npx prisma db seed` execute cette commande. Elle remplace le bloc
    // `"prisma": { "seed": ... }` que Prisma 6 lisait dans package.json.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: migrationUrl,
  },
});
