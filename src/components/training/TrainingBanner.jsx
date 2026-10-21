"use client";

/**
 * BANNIÈRE « MODE FORMATION — DONNÉES FICTIVES ».
 *
 * Affichée EN PERMANENCE dès qu'une session de formation est ouverte : le
 * libellé vient du serveur. Ce n'est pas une simple ornementation — elle porte
 * aussi le bouton « Quitter le mode formation », pour que le passage à la
 * production soit toujours explicite et jamais subi.
 */

import { GraduationCap, LogOut, RotateCcw } from "lucide-react";
import { useTraining } from "@/lib/training/training-context";

export default function TrainingBanner({ onReset }) {
  const { active, banner, exit, reset } = useTraining();
  if (!active) return null;

  return (
    <div
      className="sui-training-banner"
      role="status"
      data-coach-id="training-banner"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        background: "var(--yellow, #F9E6B9)",
        color: "#111",
        borderBottom: "2px solid #111",
        fontWeight: 700,
        fontSize: 13,
        letterSpacing: "0.02em",
        flexWrap: "wrap",
      }}
    >
      <GraduationCap size={18} strokeWidth={2} aria-hidden="true" />
      <span style={{ textTransform: "uppercase" }}>{banner}</span>
      <span style={{ fontWeight: 500, opacity: 0.8 }}>
        Les opérations que vous effectuez sont fictives : aucune donnée réelle n’est touchée.
      </span>
      <span style={{ flex: 1 }} />
      {onReset ? (
        <button
          type="button"
          className="sui-btn sui-btn--ghost"
          data-coach-id="training-reset-button"
          onClick={onReset}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <RotateCcw size={15} strokeWidth={2} aria-hidden="true" />
          Réinitialiser l’environnement
        </button>
      ) : null}
      <button
        type="button"
        className="sui-btn sui-btn--dark"
        data-coach-id="training-exit-button"
        onClick={() => exit()}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <LogOut size={15} strokeWidth={2} aria-hidden="true" />
        Quitter le mode formation
      </button>
    </div>
  );
}
