/**
 * LIGNES D'ADRESSE DES DOCUMENTS COMMERCIAUX.
 *
 * LE PROBLÈME RÉGLÉ ICI. L'ancien rendu empilait brutalement
 * `address`, `city`, `postalCode`, `region`, `country`. Avec les valeurs par
 * défaut du service (`address = 'Algérie'`, `city = 'Algiers'`,
 * `country = 'Algérie'`), l'en-tête d'une facture affichait :
 *
 *     Algérie
 *     Algiers
 *     Algérie
 *
 * Trois lignes dont deux identiques, sur le document le plus lu de
 * l'application. Le souci n'est pas seulement esthétique : une adresse qui se
 * répète fait douter de la donnée, donc de la facture.
 *
 * Deux règles, appliquées dans cet ordre :
 *  1. une ligne vide ou composée uniquement de blancs disparaît (un champ
 *     non renseigné ne doit pas laisser un trou dans le bloc) ;
 *  2. une ligne qui répète une ligne déjà écrite disparaît — comparaison
 *     normalisée (casse, accents, espaces, ponctuation finale), pour que
 *     « Alger », « alger » et « Alger. » ne fassent qu'une seule ligne.
 *
 * La règle 2 est ce qui rend le rendu robuste aux DONNÉES : un déploiement dont
 * la variable d'environnement reprend le pays dans la rue (cas courant quand on
 * renseigne l'adresse à la va-vite) produit quand même un bloc propre.
 */

/** Normalisation utilisée pour détecter les doublons : ce n'est pas un tri, ni
 *  une comparaison juridique — juste « est-ce visiblement le même mot ? ». */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Construit les lignes d'une adresse à partir de morceaux éventuellement vides
 * ou répétés. L'ordre des morceaux est conservé : c'est celui de l'adresse
 * postale (rue, code postal + ville, pays).
 */
export function buildAddressLines(parts: Array<string | null | undefined>): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const value = typeof part === 'string' ? part.replace(/\s+/g, ' ').trim() : '';
    if (!value) continue;

    const key = normalize(value);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    lines.push(value);
  }

  return lines;
}

/**
 * Ligne « code postal + ville », dans l'ordre postal français/algérien
 * (`16000 Alger`), et non l'ordre anglo-saxon (`Alger 16000`) qu'écrivait
 * l'ancien rendu. Un des deux morceaux peut manquer.
 */
export function postalLine(postalCode?: string | null, city?: string | null): string {
  const code = typeof postalCode === 'string' ? postalCode.trim() : '';
  const town = typeof city === 'string' ? city.trim() : '';
  return [code, town].filter(Boolean).join(' ');
}

/**
 * Déduit de l'adresse une ligne unique, prête à entrer dans un pied de page
 * (mentions légales) : les morceaux sont joints par « · » et les doublons ont
 * déjà disparu.
 */
export function inlineAddress(parts: Array<string | null | undefined>): string {
  return buildAddressLines(parts).join(' · ');
}
