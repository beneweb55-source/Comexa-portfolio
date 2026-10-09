import { redirect } from "next/navigation";

// Entree de l'espace equipe : la garde de la rubrique verifie ensuite les droits.
export default function EspaceEquipeIndex() {
  redirect("/espace-equipe/commandes");
}
