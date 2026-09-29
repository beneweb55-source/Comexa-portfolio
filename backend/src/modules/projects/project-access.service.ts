import { Injectable } from '@nestjs/common';
import {
  type AccessPolicy,
  type ScopeName,
} from '../../common/auth/principal.js';
import { AppException } from '../../common/errors/app-error.js';
import { ProjectStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  PROJECT_READ_ORDER,
  PROJECT_WRITE_ORDER,
  projectScopeWhere,
  subjectOf,
} from './project-scope.js';

/**
 * POINT DE PASSAGE UNIQUE DE L'ACCES A UN PROJET.
 *
 * Les modules TACHES, JALONS et TEMPS ont tous besoin de la meme chose : « ce
 * porteur a-t-il le droit de toucher CE projet ? ». Repondre une seconde fois
 * ailleurs — parce que « c'est presque la meme requete » — est la façon la plus
 * sure de faire diverger deux perimetres, et la divergence va toujours dans le
 * sens de l'ouverture.
 *
 * D'ou ce service, exporte par `ProjectsModule` et injecte par les trois autres.
 */

/** Ce que les modules appelants ont besoin de savoir du projet, et rien de plus. */
export interface ProjectRef {
  readonly id: string;
  readonly reference: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly clientId: string;
  readonly managerId: string | null;
}

const PROJECT_REF_SELECT = {
  id: true,
  reference: true,
  name: true,
  status: true,
  clientId: true,
  managerId: true,
} as const;

@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Le projet, si le porteur a le droit de le LIRE. Sinon : 404.
   *
   * POURQUOI 404 ET NON 403, ALORS QUE `AccessPolicy.assertOwnership` RENVOIE 403.
   *
   * Les deux cas ne sont pas les memes, et la distinction est deliberee :
   *
   *  - 403 signifie « vous n'avez pas ce droit », et c'est la reponse de
   *    `requireScope` quand le porteur ne detient AUCUN scope. Elle est correcte :
   *    elle lui apprend une regle generale, pas un fait sur une ressource.
   *  - ici, le porteur a bien `project:read`, mais CE projet est hors de son
   *    perimetre. Repondre 403 confirmerait que l'identifiant correspond a un
   *    projet existant — soit exactement l'information qu'un compte client
   *    cherchant a balayer les projets d'un concurrent vient recolter. 404 ne dit
   *    rien : l'identifiant n'existe pas DANS SON MONDE.
   *
   * C'est une exigence explicite du client (« un client ne doit jamais pouvoir
   * modifier l'ID d'un autre client dans une requete ») : la reponse ne doit pas
   * non plus lui apprendre si sa tentative a touche quelque chose.
   */
  async requireReadable(projectId: string, policy: AccessPolicy): Promise<ProjectRef> {
    const scope = policy.requireScope('project', 'read', PROJECT_READ_ORDER);
    return this.load(projectId, scope, policy);
  }

  /**
   * Le projet, si le porteur a le droit de le MODIFIER. Sinon : 404 (meme raison).
   *
   * `project:write:own` existe au catalogue (« Modifier le projet dont on est
   * responsable ») mais n'est porte par aucun role aujourd'hui : la seule portee
   * d'ecriture reellement attribuee est `project:write:any`. Le code la traite
   * quand meme, pour que l'ajouter a un role soit une decision de catalogue et
   * non un chantier de code.
   */
  async requireWritable(projectId: string, policy: AccessPolicy): Promise<ProjectRef> {
    const scope = policy.requireScope('project', 'write', PROJECT_WRITE_ORDER);
    return this.load(projectId, scope, policy);
  }

  private async load(
    projectId: string,
    scope: ScopeName,
    policy: AccessPolicy,
  ): Promise<ProjectRef> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        // Suppression logique : un projet supprime n'existe plus pour personne.
        deletedAt: null,
        ...projectScopeWhere(scope, subjectOf(policy)),
      },
      select: PROJECT_REF_SELECT,
    });

    if (!project) {
      throw AppException.notFound('PROJECT_NOT_FOUND', 'Ce projet est introuvable.');
    }

    return project;
  }
}
