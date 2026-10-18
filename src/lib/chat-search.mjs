/**
 * RECHERCHE DE LA MESSAGERIE — regles PURES, testables sans navigateur.
 *
 * La recherche de conversations est LOCALE : l'API n'accepte que `page`,
 * `perPage` et `includeArchived`. Ce qui vit donc ici, c'est la facon de
 * comparer (casse, accents, blancs) et de decouper un texte pour en peindre
 * les correspondances. Deux fonctions, aucune dependance.
 *
 * LA RECHERCHE EST INSENSIBLE A LA CASSE, JAMAIS AUX ACCENTS. `toLocaleCase
 * ("fr")` compare « echeance » et « Échéance » sans inventer de transliteration
 * : deformer les accents pour tolerer ferait croire a l'utilisateur que
 * « cureur » trouve « curseur ». Ce qui est tape doit trouver ce qui est ecrit,
 * pas a peu pres.
 */

/** Normalise pour la COMPARAISON uniquement — l'affichage garde le texte brut. */
export function foldText(value) {
  return String(value ?? "").trim().toLocaleLowerCase("fr");
}

/**
 * Une conversation est-elle trouvee par ce terme ?
 *
 * Le « ou » est volontairement large : titre, apercu du dernier message,
 * noms des participants. Une recherche dans une liste de conversations sert a
 * RETROUVER une conversation, pas a la filtrer au scalpel.
 */
export function conversationMatches(conversation, term) {
  const needle = foldText(term);
  if (!needle) return true;

  const haystack = [
    conversation?.subject ?? "",
    conversation?.groupName ?? "",
    conversation?.lastMessagePreview ?? "",
    ...(conversation?.participants ?? []).map((participant) => {
      const full = `${participant?.firstName ?? ""} ${participant?.lastName ?? ""}`.trim();
      return `${full} ${participant?.email ?? ""}`.trim();
    }),
    // Les identifiants ne se cherchent pas : un nom absent de la liste est un
    // faux negatif bien plus frequent qu'une recherche par id.
  ]
    .join(" ")
    .toLocaleLowerCase("fr");

  return haystack.includes(needle);
}

/**
 * Decoupe `text` en fragments { text, hit }, dans l'ordre.
 *
 * Rendu ensuite par des <span>/<mark> React : JAMAIS de innerHTML, jamais de
 * mise en HTML d'une chape de recherche. Une conversation intitulee
 * `<img onerror=…>` doit rester du texte a l'ecran.
 */
export function highlightParts(text, term) {
  const source = String(text ?? "");
  const needle = foldText(term);
  if (!needle || source.length === 0) return [{ text: source, hit: false }];

  const lowerSource = source.toLocaleLowerCase("fr");
  const parts = [];
  let cursor = 0;

  for (;;) {
    const at = lowerSource.indexOf(needle, cursor);
    if (at === -1) {
      if (cursor < source.length) parts.push({ text: source.slice(cursor), hit: false });
      break;
    }
    if (at > cursor) parts.push({ text: source.slice(cursor, at), hit: false });
    parts.push({ text: source.slice(at, at + needle.length), hit: true });
    cursor = at + needle.length;
  }

  return parts.filter((part) => part.text.length > 0);
}
