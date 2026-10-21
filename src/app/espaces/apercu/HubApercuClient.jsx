"use client";

/*
 * Données de démonstration du hub : trois espaces, des notifications en
 * attente, et les rubriques que chaque espace ouvre réellement. Rien de tout
 * cela n'est vivant — c'est un aperçu visuel, pas un espace de travail.
 */

import { Building2, ShoppingCart, UserRound, UsersRound } from "lucide-react";
import HubScreen from "@/components/softui/HubScreen";

const ENTRIES = [
  {
    id: "personal",
    label: "Espace personnel",
    shortLabel: "Personnel",
    description: "Vos tâches, votre agenda, votre temps et vos rapports.",
    tone: "green",
    href: "/espace-personnel/tableau-de-bord",
    icon: UserRound,
    unread: 2,
    sections: ["Ma journée", "Notifications", "Mes tâches", "Mon agenda", "Mon temps", "Mes rapports du jour"],
  },
  {
    id: "team",
    label: "Espace équipe",
    shortLabel: "Équipe",
    description: "Commercial, facturation, projets et calendrier partagés.",
    tone: "blue",
    href: "/espace-equipe/tableau-de-bord",
    icon: UsersRound,
    unread: 7,
    sections: ["Tableau de bord", "Notifications", "Contacts", "Prospects", "Devis", "Factures", "Commandes"],
  },
  {
    id: "comexa",
    label: "Comexa Space",
    shortLabel: "Comexa",
    description: "Site public, membres et rôles, intégrations, audit et paramètres.",
    tone: "lilac",
    href: "/espace-comexa/tableau-de-bord",
    icon: Building2,
    unread: 0,
    sections: ["Tableau de bord", "Membres", "Rôles", "Intégrations", "Journal", "Paramètres"],
  },
];

const ACCOUNT = {
  firstName: "Estelle",
  lastName: "Traoré",
  email: "estelle.traore@comexa.dz",
  roles: ["ADMIN"],
};

export default function HubApercuClient() {
  return (
    <HubScreen
      account={ACCOUNT}
      entries={ENTRIES}
      accountHref="/espace-equipe/compte"
      highlightId="team"
      onSignOut={() => {}}
    />
  );
}

/* Un compte client : une seule carte, celle de l'espace client. */
export function HubApercuClientSpace() {
  return (
    <HubScreen
      account={{ firstName: "Yanis", lastName: "B", email: "yanis.b@client.dz", roles: ["CLIENT"] }}
      entries={[
        {
          id: "client",
          label: "Espace client",
          shortLabel: "Client",
          description: "Vos devis, vos factures, l’avancement de vos projets et vos échanges avec l’équipe.",
          tone: "blue",
          href: "/espace-client",
          icon: ShoppingCart,
          unread: 3,
          sections: [],
        },
      ]}
      accountHref="/espace-client/compte"
      onSignOut={() => {}}
    />
  );
}
