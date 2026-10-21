"use client";

/**
 * Chrome de formation : la bannière permanente et le coach, montés dans la coque.
 *
 * Le bouton « Réinitialiser l’environnement » vit dans la bannière : il demande
 * une confirmation explicite (le bac à sable est partagé) avant d’appeler
 * `POST /training/reset`, qui ne touche JAMAIS la production ni votre
 * progression.
 */

import { useCallback } from "react";
import TrainingBanner from "./TrainingBanner";
import CoachLayer from "./CoachLayer";
import { useTraining } from "@/lib/training/training-context";

export default function TrainingChrome() {
  const { reset } = useTraining();

  const onReset = useCallback(async () => {
    const confirmed = window.confirm(
      "Réinitialiser l’environnement de formation ?\n\n" +
        "Toutes les DONNÉES FICTIVES de l’environnement d’entraînement seront effacées et recréées " +
        "(clients, projets, devis d’exercice…). Votre progression de formation est conservée.\n\n" +
        "Aucune donnée réelle n’est touchée.",
    );
    if (!confirmed) return;
    try {
      const data = await reset();
      window.alert(data?.message ?? "Environnement réinitialisé.");
      window.location.reload();
    } catch (error) {
      window.alert(error?.message ?? "La réinitialisation a échoué.");
    }
  }, [reset]);

  return (
    <>
      <TrainingBanner onReset={onReset} />
      <CoachLayer />
    </>
  );
}
