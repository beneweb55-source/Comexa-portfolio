import assert from "node:assert/strict";
import test from "node:test";
import { activitySentence } from "./activity-labels.mjs";

test("accentue les gabarits du serveur sans toucher au texte libre", () => {
  assert.equal(activitySentence("Tache terminee : Maquettes des parcours de commande."), "Tâche terminée : Maquettes des parcours de commande.");
  // Le titre saisi après « : » reste exactement tel quel.
  assert.equal(activitySentence("Tache terminee : Verifier la tache creee"), "Tâche terminée : Verifier la tache creee");
  // Le texte entre guillemets n'est jamais modifié.
  assert.equal(
    activitySentence("La tache « Tache creee hier » est desormais partagee avec le client."),
    "La tâche « Tache creee hier » est désormais partagée avec le client.",
  );
  assert.equal(activitySentence("L'echeance du projet a ete retiree."), "L'échéance du projet a été retirée.");
  assert.equal(activitySentence("Devis DEV-2026-0004 refuse : budget refuse"), "Devis DEV-2026-0004 refusé : budget refuse");
  assert.equal(activitySentence("Paiement de 3067.20 EUR recu sur la facture FAC-2026-0001."), "Paiement de 3067.20 EUR reçu sur la facture FAC-2026-0001.");
  assert.equal(
    activitySentence("Facture FAC-2026-0002 en retard : l'echeance de paiement est depassee."),
    "Facture FAC-2026-0002 en retard : l’échéance de paiement est dépassée.",
  );
});

test("traduit les statuts bruts selon l'objet concerné", () => {
  assert.equal(activitySentence("Statut du projet : IN_PROGRESS → COMPLETED."), "Statut du projet : En cours → Terminé.");
  assert.equal(activitySentence("Tache « Recette » : TODO → DONE."), "Tâche « Recette » : À faire → Terminée.");
  assert.equal(activitySentence("Jalon « Mise en ligne » : PENDING → IN_PROGRESS."), "Jalon « Mise en ligne » : À venir → En cours.");
  assert.equal(
    activitySentence("Visibilite du document « brief.pdf » : INTERNAL vers CLIENT"),
    "Visibilité du document « brief.pdf » : Interne vers Client",
  );
  assert.equal(activitySentence("Demande de modification MOD-1 : SUBMITTED -> APPROVED"), "Demande de modification MOD-1 : Envoyée → Acceptée");
  assert.equal(activitySentence("Le projet demarre, statut IN_PROGRESS."), "Le projet démarre, statut En cours.");
});

test("rend une phrase inconnue telle quelle", () => {
  assert.equal(activitySentence("Un message libre, sans gabarit."), "Un message libre, sans gabarit.");
  assert.equal(activitySentence(""), "");
  assert.equal(activitySentence(null), "");
});
