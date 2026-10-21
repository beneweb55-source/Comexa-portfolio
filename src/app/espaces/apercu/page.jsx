import { notFound } from "next/navigation";
import HubApercuClient from "./HubApercuClient";

/*
 * Aperçu du hub des espaces — banc d'essai visuel, comme `/refonte-apercu`.
 *
 * Elle n'existe QU'EN DÉVELOPPEMENT (`next dev`) : la construction de
 * production renvoie un 404. Elle sert à juger l'écran d'entrée des
 * applications desktop et Android (la coque noire du dashboard) sans backend
 * ni session, avec des données de démonstration explicitement signalées comme
 * telles.
 */
export default function HubApercuPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <HubApercuClient />;
}
