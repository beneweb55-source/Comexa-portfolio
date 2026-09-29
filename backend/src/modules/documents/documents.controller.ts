/// <reference types="multer" />
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import { MAX_UPLOAD_BYTES } from '../../common/storage/storage.types.js';
import type { AuthenticatedUser } from '../../common/auth/principal.js';
import { DocumentCategory, DocumentVisibility } from '../../generated/prisma/enums.js';
import type { Paginated } from '../../common/dto/pagination.dto.js';
import { DocumentsService, type DocumentView } from './documents.service.js';
import {
  ListDocumentsQueryDto,
  UpdateDocumentDto,
  UploadDocumentDto,
} from './dto/documents.dto.js';

/**
 * ROUTES DES DOCUMENTS.
 *
 * DEUX NIVEAUX D'AUTORISATION, ET ILS NE DISENT PAS LA MEME CHOSE.
 *
 * Le garde (`@RequireAnyPermission`) repond a « ce porteur a-t-il le droit
 * d'appeler cette route ». Le service repond a « QUELLES lignes ce porteur peut
 * voir ». Les deux sont necessaires : `document:read:client` ouvre la route de
 * lecture a un porteur CLIENT, et c'est le filtre du service qui l'empeche de
 * lire l'interne. Un `@RequirePermissions('document:read:any')` unique aurait
 * l'air plus stricte tout en fermant la route aux clients, ce qui n'est pas le
 * but — le client doit voir SES documents.
 *
 * LE CHOIX DES CODES EST DELIBERE, pas un reflexe :
 *
 *  - `document:read:any`   : le porteur interne voit tout, y compris INTERNAL.
 *  - `document:read:own`   : les documents de ses projets, INTERNAL compris.
 *  - `document:read:client`: les documents PARTAGEABLES de son dossier. C'est
 *    le seul que detient le role CLIENT, et il ne suffit pas — la visibilite
 *    est verifiee en base.
 *
 * Accorder `document:read:any` a un porteur CLIENT lui ouvrirait l'interne : le
 * catalogue ne le fait pas, et `resolveDocumentAccess` refuse de toute facon.
 */
@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /**
   * Depose un fichier.
   *
   * `limits.fileSize` borne le corps AVANT le bufferisation complete : multer
   * interrompt le flux des que la limite est depassee, ce qui evite qu'un envoi
   * de plusieurs gigaoctets remplisse la memoire du serveur. C'est une
   * protection de transport, distincte de la borne metier verifiee dans le
   * service — les deux existent parce qu'elles ne protegent pas de la meme
   * chose : l'une la memoire, l'autre le contenu du bucket.
   *
   * Le quota est plus serre que celui des autres routes : un envoi de fichier
   * coute des dizaines de milliers de fois plus qu'un appel JSON, et c'est le
   * point d'entree naturel d'un remplissage de disque.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string', maxLength: 200 },
        category: { type: 'string', enum: Object.values(DocumentCategory) },
        visibility: { type: 'string', enum: Object.values(DocumentVisibility) },
        clientId: { type: 'string' },
        projectId: { type: 'string' },
        taskId: { type: 'string' },
      },
    },
  })
  @RequireAnyPermission('document:write:any', 'document:write:own')
  @ApiOperation({
    summary: 'Deposer un document',
    description:
      'Le fichier part dans le stockage objet ; la base ne conserve que la metadonnee. ' +
      'Visibilite INTERNAL par defaut.',
  })
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
  ): Promise<DocumentView> {
    return this.documents.upload(user, file, dto);
  }

  @Get()
  @RequireAnyPermission('document:read:any', 'document:read:own', 'document:read:client')
  @ApiOperation({ summary: 'Lister les documents accessibles au porteur' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<Paginated<DocumentView>> {
    return this.documents.list(user, query);
  }

  @Get(':id')
  @RequireAnyPermission('document:read:any', 'document:read:own', 'document:read:client')
  @ApiOperation({ summary: "Consulter la metadonnee d'un document" })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DocumentView> {
    return this.documents.findOne(user, id);
  }

  /**
   * Renomme, reclasse ou PARTAGE un document.
   *
   * Le partage se fait ici, en passant `visibility` de INTERNAL a CLIENT, et il
   * est trace. Aucun porteur CLIENT n'atteint cette route : le catalogue ne lui
   * donne aucune permission `document:write:*`, et le service refuse en plus
   * explicitement le role client. Un client ne peut donc pas publier le document
   * d'un autre, ni rendre visible ce qu'on lui a cache.
   */
  @Patch(':id')
  @RequireAnyPermission('document:write:any', 'document:write:own')
  @ApiOperation({ summary: "Modifier la metadonnee d'un document (nom, categorie, visibilite)" })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
  ): Promise<DocumentView> {
    return this.documents.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('document:delete:any')
  @ApiOperation({
    summary: 'Supprimer un document',
    description:
      "Marque la ligne comme supprimee puis efface l'objet du stockage. La ligne est " +
      'conservee : des paiements peuvent la referencer comme justificatif.',
  })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.documents.remove(user, id);
  }

  /**
   * URL signee, courte duree.
   *
   * Rien ne transite par l'API : le client recoit une URL et telecharge
   * directement depuis le stockage. C'est le mode prevu en production, ou la
   * bande passante du serveur applicatif ne doit pas porter les fichiers.
   */
  @Get(':id/download')
  @RequireAnyPermission('document:read:any', 'document:read:own', 'document:read:client')
  @ApiOperation({ summary: 'Obtenir une URL de telechargement signee' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ url: string; expiresInSeconds: number; fileName: string }> {
    return this.documents.downloadUrl(user, id);
  }

  /**
   * Le contenu, servi en flux.
   *
   * `@Res()` donne la main sur la reponse : Nest n'enveloppe donc PAS ce
   * gestionnaire dans l'enveloppe JSON habituelle, ce qui est le but — un
   * fichier n'est pas une reponse d'API. Le controle de droits est le meme que
   * pour `download`, et il s'execute avant qu'un seul octet ne parte.
   *
   * DEUX EN-TETES PORTENT UNE PROTECTION, et pas seulement du confort :
   *
   *  - `Content-Disposition: attachment` empeche le navigateur d'AFFICHER le
   *    fichier dans l'origine de l'application. Servi en ligne, un fichier
   *    porteur de script s'executerait avec les droits de cette origine ;
   *  - `X-Content-Type-Options: nosniff` empeche le navigateur de deviner un
   *    type different de celui annonce, ce qui contournerait la liste blanche
   *    de `storage.key.ts` — c'est elle qui ecarte deja le SVG et le HTML.
   */
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get(':id/content')
  @RequireAnyPermission('document:read:any', 'document:read:own', 'document:read:client')
  @ApiOperation({ summary: 'Telecharger le contenu du document (flux direct)' })
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { stream, fileName, mimeType, sizeBytes } = await this.documents.content(user, id);

    response.setHeader('Content-Type', mimeType);
    response.setHeader('Content-Length', String(sizeBytes));
    response.setHeader('Content-Disposition', contentDisposition(fileName));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // `private` : la reponse est propre a un porteur et ne doit jamais etre
    // rangee dans un cache partage. `no-store` va plus loin et empeche aussi le
    // cache du navigateur de conserver un document qu'on vient de retirer.
    response.setHeader('Cache-Control', 'private, no-store');

    // Le flux peut echouer en cours de route (objet efface entre-temps,
    // stockage injoignable). L'en-tete 200 est deja parti : on ne peut plus
    // repondre une erreur JSON, seulement couper la reponse, ce que le client
    // voit comme un telechargement interrompu — ce qui est la verite.
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }
}

/**
 * En-tete `Content-Disposition` sur pour un nom de fichier quelconque.
 *
 * Le nom d'origine vient du client. Recopie tel quel dans un en-tete, il
 * permettrait d'y injecter un retour a la ligne et, avec lui, des en-tetes
 * arbitraires. On ecrit donc deux fois le nom :
 *
 *  - `filename="..."` en ASCII, ou tout caractere hors de l'intervalle sur est
 *    remplace — c'est ce que lisent les clients anciens ;
 *  - `filename*=UTF-8''...` encode selon la RFC 5987, qui restitue correctement
 *    les accents et les espaces pour tout navigateur actuel.
 *
 * Un nom vide reste possible : on retombe alors sur `document`, pour que
 * l'en-tete reste syntaxiquement valide.
 */
function contentDisposition(originalName: string): string {
  const fallback = originalName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'document';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(originalName)}`;
}
