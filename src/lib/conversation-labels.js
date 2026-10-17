/**
 * LIBELLES DES CONVERSATIONS — le meme dans la barre laterale et dans le fil.
 *
 * L'API renvoie une conversation SANS `isGroup` ni `groupName` : elle expose un
 * `type` (DIRECT, PROJECT, CLIENT, SUPPORT) et la liste des participants. Ces
 * deux fonctions traduisent cette forme reelle en ce que l'interface affiche,
 * plutot que de deviner un groupe sur un champ qui n'existe pas.
 */

/** Une conversation est-elle collective ? */
export function isGroupConversation(conversation) {
  if (!conversation) return false;
  if (conversation.type && conversation.type !== "DIRECT") return true;
  return (conversation.participants?.length ?? 0) > 2;
}

/** Nom lisible d'un participant. */
export function participantName(participant) {
  if (!participant) return "";
  const full = `${participant.firstName ?? ""} ${participant.lastName ?? ""}`.trim();
  return full || participant.email || "";
}

/**
 * Titre d'une conversation.
 *
 * Un sujet gagne toujours. Sinon, on affiche les interlocuteurs : une
 * conversation directe n'a generalement pas de sujet, et « Sans sujet » ne
 * dit rien a personne.
 */
export function conversationTitle(conversation, currentUserId) {
  if (!conversation) return "";
  if (conversation.subject) return conversation.subject;
  if (conversation.groupName) return conversation.groupName;
  const others = (conversation.participants ?? []).filter(
    (participant) => participant.userId !== currentUserId,
  );
  const names = others.map(participantName).filter(Boolean);
  if (names.length === 0) return "Sans sujet";
  if (names.length === 1) return names[0];
  return `${names[0]} et ${names.length - 1} autre${names.length > 2 ? "s" : ""}`;
}
