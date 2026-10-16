/**
 * Coordonnées publiques de Comexa, partagées par tout le site public (pied de page,
 * appels à l'action, page Contact, accueil) : une seule source, plus d'adresses qui
 * divergent d'une page à l'autre.
 *
 * Réseaux sociaux et pages légales : un lien n'est affiché que si son adresse est
 * renseignée ici. Tant qu'elle vaut `null`, rien n'apparaît (jamais de lien mort).
 */
export const SITE_CONTACT = {
  email: "bonjour@comexa.dz",
  responseTime: "Réponse sous 24 à 48 h ouvrées",
  hours: "Dimanche – Jeudi · 9h00 – 18h00",
  hoursNote: "Fuseau d’Alger (UTC+1) et accompagnement international",
  location: "Algérie · Projets partout en Algérie et à l’international",
};

export const SITE_SOCIALS = [
  { label: "LinkedIn", href: null },
  { label: "Instagram", href: null },
];

export const SITE_LEGAL = [
  { label: "Mentions légales", href: null },
  { label: "Politique de confidentialité", href: null },
];

/** Liens réellement utilisables (adresse renseignée). */
export function availableLinks(links) {
  return links.filter((link) => typeof link.href === "string" && link.href.length > 0);
}
