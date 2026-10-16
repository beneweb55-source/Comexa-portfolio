import { redirect } from "next/navigation";

/** Entrée de l'espace personnel : la journée du membre. */
export default function EspacePersonnelIndex() {
  redirect("/espace-personnel/tableau-de-bord");
}
