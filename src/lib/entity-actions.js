/**
 * OPTIONS MÉTIER PARTAGÉES PAR LES MENUS « ⋯ ».
 *
 * Chaque fonction rend des entrées au format attendu par `RecordActions` :
 * `{ key, label, icon, when, confirm, run, success }`. Les routes appelées sont
 * celles de l'API, sans exception — un menu ne fabrique jamais d'état local.
 *
 * Pourquoi un fichier commun : le même projet se supprime depuis la liste ET
 * depuis sa fiche, la même commande se corrige depuis la liste ET depuis son
 * détail. Deux copies auraient divergé au premier changement de transition.
 */

import {
  Archive,
  CheckCircle2,
  CirclePlay,
  CircleSlash,
  CreditCard,
  Package,
  PauseCircle,
  Search,
} from "lucide-react";

/* ------------------------------------------------------------------------- */
/* Projets                                                                    */
/* ------------------------------------------------------------------------- */

export function projectStatusActions(canManageStatus) {
  if (!canManageStatus) return [];
  const setStatus = (status) => async ({ request, id }) => {
    await request(`/projects/${id}/status`, { method: "PATCH", body: { status } });
  };
  return [
    {
      key: "complete",
      label: "Marquer comme terminé",
      icon: CheckCircle2,
      confirm: {
        title: "Clôturer ce projet ?",
        description: "Le projet passera en « Terminé ». Les tâches et les documents restent en place.",
        confirmLabel: "Marquer terminé",
      },
      run: setStatus("COMPLETED"),
      success: "Projet marqué comme terminé.",
    },
    {
      key: "hold",
      label: "Mettre en pause",
      icon: PauseCircle,
      confirm: {
        title: "Mettre ce projet en pause ?",
        description: "Le projet passera en « En pause ». Vous pourrez le relancer depuis le menu « ⋯ ».",
        confirmLabel: "Mettre en pause",
      },
      run: setStatus("ON_HOLD"),
      success: "Projet mis en pause.",
    },
    {
      key: "archive",
      label: "Archiver",
      icon: Archive,
      confirm: {
        title: "Archiver ce projet ?",
        description: "Le projet quittera les vues actives mais restera consultable dans le filtre « Archivés ».",
        confirmLabel: "Archiver",
      },
      run: setStatus("ARCHIVED"),
      success: "Projet archivé.",
    },
  ];
}

/* ------------------------------------------------------------------------- */
/* Commandes                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Transitions utiles d'une commande. `validate` et `start` ont leurs propres
 * routes parce qu'elles touchent le projet ; les autres passent par
 * `PATCH /orders/:id/status`, dont le service vérifie la transition.
 */
export function orderStatusActions(order, canManage) {
  if (!canManage) return [];
  return [
    {
      key: "validate",
      label: "Valider et créer le projet",
      icon: CheckCircle2,
      when: ["ORDERED", "IN_REVIEW"].includes(order.status),
      confirm: {
        title: "Valider cette commande ?",
        description: `La commande ${order.reference} passera « En préparation » et un projet sera créé pour ce client.`,
        confirmLabel: "Valider la commande",
      },
      run: ({ request, id }) => request(`/orders/${id}/validate`, { method: "POST" }),
      success: "Commande validée : le projet est créé.",
    },
    {
      key: "start",
      label: "Démarrer le projet",
      icon: CirclePlay,
      when: order.status === "IN_PREPARATION",
      confirm: {
        title: "Démarrer le projet ?",
        description: "La commande passera « Projet en cours » et la date de démarrage du projet sera posée.",
        confirmLabel: "Démarrer",
      },
      run: ({ request, id }) => request(`/orders/${id}/start`, { method: "POST" }),
      success: "Projet démarré.",
    },
    {
      key: "review",
      label: "Mettre en cours de validation",
      icon: Search,
      when: order.status === "ORDERED",
      run: ({ request, id }) => request(`/orders/${id}/status`, { method: "PATCH", body: { status: "IN_REVIEW" } }),
      success: "Commande mise en cours de validation.",
    },
    {
      key: "back-to-ordered",
      label: "Remettre en attente",
      icon: Package,
      when: order.status === "IN_REVIEW",
      run: ({ request, id }) => request(`/orders/${id}/status`, { method: "PATCH", body: { status: "ORDERED" } }),
      success: "Commande remise en attente.",
    },
    {
      key: "complete",
      label: "Marquer comme terminée",
      icon: CheckCircle2,
      when: order.status === "IN_PROGRESS",
      confirm: {
        title: "Clôturer cette commande ?",
        description: "La commande passera « Terminée » et son projet sera marqué comme terminé.",
        confirmLabel: "Marquer terminée",
      },
      run: ({ request, id }) => request(`/orders/${id}/status`, { method: "PATCH", body: { status: "COMPLETED" } }),
      success: "Commande terminée.",
    },
    {
      key: "mark-paid",
      label: "Marquer le paiement comme réglé",
      icon: CreditCard,
      when: order.paymentStatus !== "PAID",
      confirm: {
        title: "Enregistrer le paiement comme réglé ?",
        description: `Le paiement de la commande ${order.reference} sera marqué « Réglé ». À n’utiliser qu’après encaissement effectif.`,
        confirmLabel: "Marquer réglé",
      },
      run: ({ request, id }) => request(`/orders/${id}/payment`, { method: "PATCH", body: { paymentStatus: "PAID" } }),
      success: "Paiement enregistré comme réglé.",
    },
    {
      key: "mark-unpaid",
      label: "Marquer le paiement comme en attente",
      icon: CircleSlash,
      when: order.paymentStatus !== "UNPAID",
      confirm: {
        title: "Repasser le paiement en attente ?",
        description: `La commande ${order.reference} sera de nouveau « Paiement en attente ». Utile pour corriger une saisie.`,
        confirmLabel: "Paiement en attente",
        danger: true,
      },
      run: ({ request, id }) => request(`/orders/${id}/payment`, { method: "PATCH", body: { paymentStatus: "UNPAID" } }),
      success: "Paiement repassé en attente.",
    },
    {
      key: "cancel",
      label: "Annuler la commande",
      icon: CircleSlash,
      tone: "danger",
      when: ["ORDERED", "IN_REVIEW", "IN_PREPARATION"].includes(order.status),
      confirm: {
        title: "Annuler cette commande ?",
        description: `La commande ${order.reference} passera en « Annulée ». Le projet éventuellement créé reste en place et se gère depuis sa fiche.`,
        confirmLabel: "Annuler la commande",
        danger: true,
      },
      run: ({ request, id }) => request(`/orders/${id}/status`, { method: "PATCH", body: { status: "CANCELLED" } }),
      success: "Commande annulée.",
    },
  ];
}
