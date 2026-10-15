import { notFound } from "next/navigation";
import ApercuClient from "./ApercuClient";

/*
 * Page d'aperçu du design system « soft UI pastel dans une coque noire ».
 *
 * Elle n'existe QU'EN DÉVELOPPEMENT (`next dev`) : la construction de production
 * renvoie un 404. Elle sert à juger visuellement chaque composant (coque, navbar,
 * rail, KPI, cartes, Admin Desk, dock) sans backend ni session, avec des données
 * de démonstration explicitement signalées comme telles.
 */
export default function ApercuRefontePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ApercuClient />;
}
