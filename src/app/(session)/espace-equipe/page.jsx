import { redirect } from "next/navigation";

/** Entrée de l'espace équipe : le tableau de bord vérifie ensuite les droits. */
export default function EspaceEquipeIndex() {
  redirect("/espace-equipe/tableau-de-bord");
}
