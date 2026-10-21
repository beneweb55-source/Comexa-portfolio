"use client";

/*
 * Guide de démarrage — espace client
 *
 * Vos devis et vos demandes, suivis dans l’outil.
 *
 * Une page courte, réutilisée telle quelle par les quatre espaces : le serveur
 * ne renvoie que les étapes autorisées par les droits de l'espace courant.
 */
import GuideView from "@/components/guide/GuideView";

export default function GuidePage() {
  return <GuideView space="client" />;
}
