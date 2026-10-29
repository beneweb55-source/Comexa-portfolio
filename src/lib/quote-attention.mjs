/**
 * Attention commerciale sur les devis ENVOYES proches de leur echeance.
 *
 * Ce n'est PAS une nouvelle regle d'expiration. La Phase 1 a deja corrige
 * l'expiration cote backend : `effectiveQuoteStatus()` derive `EXPIRED` a la
 * lecture, avec une validite inclusive jusqu'a la fin du jour UTC de
 * `validUntil`. L'API renvoie donc deja `EXPIRED` pour un devis echu. Ici on ne
 * fait que signaler, dans l'interface, les devis encore `SENT`/`VIEWED` dont la
 * date de validite tombe dans les 3 prochains jours UTC.
 *
 * Aucune notification, aucun e-mail, aucune ecriture, aucune relance
 * automatique : le commercial ouvre le devis et decide lui-meme. Le seuil de
 * 3 jours est un choix de presentation, pas une regle metier ; il est explicite
 * et testable.
 */

export const QUOTE_FOLLOWUP_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_SENT_STATUSES = new Set(["SENT", "VIEWED"]);

function utcDayNumber(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return Date.parse(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/**
 * @returns {{days:number,label:string,tone:"pink"|"yellow",level:"urgent"|"soon"}|null}
 */
export function quoteFollowup(quote, now = Date.now()) {
  if (!quote || !OPEN_SENT_STATUSES.has(quote.status) || !quote.validUntil) return null;
  const validityDay = utcDayNumber(quote.validUntil);
  const today = utcDayNumber(now);
  if (validityDay === null || today === null) return null;
  const days = Math.round((validityDay - today) / DAY_MS);
  if (days < 0 || days > QUOTE_FOLLOWUP_WINDOW_DAYS) return null;
  const label = days === 0 ? "Expire aujourd’hui" : days === 1 ? "Expire demain" : `Expire dans ${days} jours`;
  return {
    days,
    label,
    tone: days <= 1 ? "pink" : "yellow",
    level: days <= 1 ? "urgent" : "soon",
  };
}

/** Devis a relancer, tries par urgence puis reference. Aucune mutation. */
export function quotesNeedingFollowup(quotes, now = Date.now()) {
  return (Array.isArray(quotes) ? quotes : [])
    .map((quote) => ({ quote, followup: quoteFollowup(quote, now) }))
    .filter((entry) => entry.followup)
    .sort(
      (left, right) =>
        left.followup.days - right.followup.days ||
        String(left.quote?.reference ?? left.quote?.id ?? "").localeCompare(
          String(right.quote?.reference ?? right.quote?.id ?? ""),
          "fr",
        ),
    );
}
