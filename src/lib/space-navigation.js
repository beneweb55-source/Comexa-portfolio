/**
 * Rubriques de chaque espace de travail, groupées par pôle.
 *
 * Une seule source pour les layouts (filtrage par droits), la coque (onglets,
 * tiroir, en-tête de page) et la palette de commandes. Chaque rubrique déclare
 * les permissions qui l'ouvrent (`any`), évaluées avec les droits EFFECTIFS de
 * son espace : une rubrique n'apparaît jamais dans un espace où l'API la
 * refuserait.
 */

import { SPACES } from "./spaces.js";

const TASK_READ = ["task:read:any", "task:read:assigned", "task:read:own"];
const PROJECT_READ = ["project:read:any", "project:read:own", "project:read:assigned"];

const NAVIGATION = {
  personal: [
    {
      label: "Ma journée",
      tone: "green",
      items: [
        { section: "tableau-de-bord", label: "Ma journée", description: "Vos priorités du jour : tâches, agenda, minuteur et temps de la semaine." },
        { section: "formation", label: "Mon parcours", description: "Votre formation guidée : missions pratiques, progression et bilan." },
        { section: "notifications", label: "Notifications", any: ["notification:read:own"], description: "Les alertes qui concernent votre propre travail." },
      ],
    },
    {
      label: "Mon organisation",
      tone: "yellow",
      items: [
        { section: "taches", label: "Mes tâches", any: [...TASK_READ, "task:read:personal", "task:write:personal"], description: "Vos tâches privées et celles qui vous sont assignées, au même endroit." },
        { section: "calendrier", label: "Mon agenda", any: ["calendar:read:own", ...TASK_READ, "task:read:personal"], description: "Vos rendez-vous, rappels et échéances — privés ou partagés." },
        { section: "temps", label: "Mon temps", any: ["time:read:own", "time:write:own"], description: "Vos saisies de temps, corrections et nouvelles entrées." },
        { section: "rapports-journaliers", label: "Mes rapports du jour", any: ["time:write:own", "time:read:own"], description: "Le compte rendu de votre journée, avant de partir." },
      ],
    },
  ],
  team: [
    {
      label: "Vue générale",
      tone: "blue",
      items: [
        { section: "tableau-de-bord", label: "Tableau de bord", any: ["dashboard:read:any", "dashboard:read:own"], description: "Les chiffres de l’agence et ce qui attend une décision de l’équipe." },
        { section: "formation", label: "Mon parcours", description: "Votre formation guidée : missions pratiques par module, progression et bilan." },
        { section: "notifications", label: "Notifications", any: ["notification:read:own"], description: "Projets, devis, factures et messages de l’équipe." },
      ],
    },
    {
      label: "Développement commercial",
      tone: "green",
      items: [
        { section: "contacts", label: "Contacts", any: ["contactrequest:read:any"], description: "Demandes reçues depuis le site public, à qualifier." },
        { section: "prospects", label: "Prospects", nested: true, any: ["prospect:read:any", "prospect:read:own"], description: "Le pipeline commercial, étape par étape." },
        { section: "devis", label: "Devis", nested: true, any: ["quote:read:any"], description: "Propositions envoyées, acceptées ou à relancer." },
      ],
    },
    {
      label: "Gestion commerciale",
      tone: "lilac",
      items: [
        { section: "factures", label: "Factures", nested: true, any: ["invoice:read:any"], description: "Facturation, encaissements et restes à payer." },
        { section: "commandes", label: "Commandes", nested: true, any: ["order:read:any"], description: "Packs commandés en ligne : validation, paiement, lancement." },
        { section: "demandes", label: "Demandes de projet", any: ["project_request:read:any"], description: "Demandes de projet sur mesure envoyées par les clients." },
        { section: "clients", label: "Clients", nested: true, any: ["client:read:any"], description: "Dossiers clients, contacts et historique." },
      ],
    },
    {
      label: "Production",
      tone: "yellow",
      items: [
        { section: "projets", label: "Projets", nested: true, any: PROJECT_READ, description: "Projets en cours, avancement, échéances et santé." },
        { section: "taches", label: "Tâches", any: [...TASK_READ, "task:write:any", "task:write:own"], description: "Le tableau Kanban des tâches de chaque projet." },
        { section: "calendrier", label: "Calendrier", any: ["calendar:read:team", ...TASK_READ, ...PROJECT_READ], description: "Événements partagés de l’équipe et échéances des projets." },
        { section: "temps", label: "Suivi du temps", any: ["time:read:any"], description: "Le temps passé par l’équipe sur les projets." },
        { section: "rapports-journaliers", label: "Rapports journaliers", any: ["time:read:any"], description: "Les comptes rendus quotidiens de l’équipe." },
        { section: "messagerie", label: "Messagerie", any: ["conversation:read:own"], description: "Conversations avec les clients et l’équipe." },
        { section: "modifications", label: "Demandes de modification", any: ["modificationrequest:decide:any"], description: "Modifications demandées par les clients, à arbitrer." },
      ],
    },
    {
      label: "Pilotage",
      tone: "pink",
      items: [
        { section: "analytique", label: "Analytique", any: ["report:read:any"], description: "Temps, tâches et avancement de l’équipe sur 30 jours." },
        { section: "repartition", label: "Répartition & soldes", any: ["distribution:read:any", "balance:read:own"], description: "Qui reçoit quelle part, sur quelle base, et ce qui reste dû." },
        { section: "rapports", label: "Rapports", any: ["report:read:any", "report:read:own"], description: "Rapports générés : projets, temps, pipeline, chiffre d’affaires." },
      ],
    },
  ],
  comexa: [
    {
      label: "Vue d’ensemble",
      tone: "lilac",
      items: [
        { section: "tableau-de-bord", label: "Vue d’ensemble", description: "L’état de l’organisation : membres, contenus, intégrations et sécurité." },
        { section: "formation", label: "Mon parcours", description: "Votre formation guidée : missions pratiques par module, progression et bilan." },
        { section: "notifications", label: "Notifications", any: ["notification:read:own"], description: "Messages système de la plateforme Comexa." },
      ],
    },
    {
      label: "Site public",
      tone: "pink",
      items: [
        { section: "contenu", label: "Contenu du site", any: ["service:read:any", "package:read:any", "testimonial:read:any", "partner:read:any", "faq:read:any", "casestudy:read:any"], description: "Services, packs, témoignages, partenaires et FAQ publiés sur le site." },
      ],
    },
    {
      label: "Membres et accès",
      tone: "blue",
      items: [
        { section: "membres", label: "Membres et droits", any: ["user:read:any"], description: "Comptes de l’équipe et des clients, statuts et rôles attribués." },
        { section: "roles", label: "Rôles et permissions", any: ["role:read:any"], description: "Ce que chaque rôle peut voir et faire." },
      ],
    },
    {
      label: "Plateforme",
      tone: "green",
      items: [
        { section: "integrations", label: "API & Intégrations", any: ["integration:read:any", "integration:manage:any"], description: "Jetons d’accès des intégrations (n8n, bot Telegram, agents)." },
        { section: "journal", label: "Journal d’audit", any: ["audit:read:any"], description: "Qui a fait quoi, et quand, sur la plateforme." },
        { section: "parametres", label: "Paramètres", any: ["setting:read:any"], description: "Réglages de l’organisation : facturation, paiements, informations légales." },
      ],
    },
  ],
};

/** Groupes de l'espace, avec `href` complet. */
export function navigationFor(space) {
  const prefix = SPACES[space]?.prefix;
  if (!prefix) return [];
  return (NAVIGATION[space] ?? []).map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, href: `${prefix}/${item.section}` })),
  }));
}

/** Groupes réduits aux rubriques autorisées par ces droits (effectifs). */
export function visibleNavigation(space, permissions) {
  const granted = permissions instanceof Set ? permissions : new Set(permissions ?? []);
  return navigationFor(space)
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.any || item.any.some((code) => granted.has(code))) }))
    .filter((group) => group.items.length > 0);
}

/** Toutes les rubriques de l'espace (filtrées), à plat. */
export function sectionHrefs(space, permissions) {
  return visibleNavigation(space, permissions).flatMap((group) => group.items.map((item) => item.href));
}
