import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Module global : la base de donnees est utilisee par presque tous les modules
 * metier. Le rendre global evite de le reimporter dans chacun, au prix d'un
 * couplage assume et explicite — `PrismaService` reste le seul chemin d'acces
 * aux donnees, ce qui est precisement ce qu'on veut pouvoir verifier.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
