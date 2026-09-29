import type { Message } from '../../generated/prisma/client.js';

/**
 * EVENEMENTS DE MESSAGERIE DIFFUSES SUR LE BUS INTERNE.
 *
 * Le service de messages n'appelle JAMAIS socket.io directement. Il ecrit en
 * base, puis emet cet evenement ; la passerelle temps reel l'ecoute et le
 * traduit en emission socket. C'est le meme montage que `NotificationService` et
 * sa constante `NOTIFICATION_CREATED`, et la raison est identique : le jour ou
 * le transport change, aucun service metier ne bouge.
 *
 * Ce fichier n'importe rien d'autre qu'un type Prisma. Il doit rester une
 * FEUILLE du graphe de dependances : le module de notifications (qui heberge la
 * passerelle) l'importe, alors que le module de messagerie importe le module de
 * notifications. Un import en sens inverse, au niveau d'un module Nest, creerait
 * un cycle ; au niveau d'un fichier de constantes, il ne cree rien du tout.
 */

/** Emis apres l'ecriture d'un message, une fois la transaction validee. */
export const MESSAGE_CREATED = 'message.created';

export interface MessageCreatedEvent {
  readonly conversationId: string;
  /** Le message PERSISTE. La diffusion ne transporte jamais autre chose. */
  readonly message: Message;
}
