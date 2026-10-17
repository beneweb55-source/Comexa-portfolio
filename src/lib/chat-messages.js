/**
 * MESSAGES D'UNE CONVERSATION — ordre de lecture et deduplication.
 *
 * Deux regles, et deux bugs qui en etaient la consequence.
 *
 * 1. ORDRE DE LECTURE. L'API renvoie une page de messages du plus RECENT au
 *    plus ancien (c'est ce qu'exige la pagination par curseur : la page
 *    suivante est toujours plus ancienne). L'ecran, lui, affiche le plus
 *    ancien en haut. La page est donc inversee — sur une COPIE, jamais sur le
 *    tableau de la reponse.
 *
 * 2. DEDUPLICATION. Un message ecrit par ce poste arrive deux fois : par la
 *    reponse de l'API, et par le WebSocket (l'expediteur est aussi dans la
 *    room de sa conversation). Sans deduplication, la bulle s'affiche en
 *    double.
 */

/** La page d'un fil, dans l'ordre de lecture. */
export function messagesFromPage(page) {
  const rows = Array.isArray(page?.data) ? page.data : [];
  return [...rows].reverse();
}

/** Ajoute un message a la liste, sauf s'il y est deja. */
export function appendUnique(messages, message) {
  if (!message?.id) return messages;
  if (messages.some((item) => item.id === message.id)) return messages;
  return [...messages, message];
}
