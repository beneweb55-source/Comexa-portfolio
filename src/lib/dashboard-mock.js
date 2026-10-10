/*
 * DONNÉES DE DÉMONSTRATION du tableau de bord (rendu visuel uniquement).
 * Déterministes (pas d'aléa au rendu) pour éviter tout décalage entre serveur et navigateur.
 * Les widgets qui ont une source réelle (minuteur, tâches) n'utilisent pas ce fichier.
 */

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** Série journalière : heures travaillées par l'équipe et tâches terminées. */
export function dailySeries(days = 14, anchor = new Date("2026-10-10T12:00:00")) {
  const rand = seeded(days * 31 + 7);
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(anchor);
    d.setDate(d.getDate() - i);
    const weekend = d.getDay() === 5 || d.getDay() === 6; // vendredi et samedi (semaine algérienne)
    const hours = weekend ? 0.6 + rand() * 1.2 : 5.5 + rand() * 4.5;
    const tasksDone = weekend ? Math.round(rand() * 1) : Math.round(2 + rand() * 4);
    out.push({
      day: d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }),
      heures: Math.round(hours * 10) / 10,
      tachesTerminees: tasksDone,
    });
  }
  return out;
}

export const KPI_DEMO = {
  revenue: { value: 4820000, currency: "DZD", delta: 12.4 },
  tasksInProgress: { value: 23, delta: -3 },
  hoursMonth: { value: 318.5, target: 400, delta: 8.1 },
  projectsActive: { value: 6, delta: 1 },
};

export const PROJECTS_DEMO = [
  { name: "Boutique en ligne Maison Vasseur", progress: 60, tone: "accent" },
  { name: "Refonte site Atlas Immo", progress: 35, tone: "sky" },
  { name: "Application de réservation Oasis", progress: 82, tone: "mint" },
  { name: "Identité visuelle Dar El Bey", progress: 18, tone: "amber" },
];

export const ACTIVITY_DEMO = [
  { id: 1, when: "Il y a 8 min", title: "Devis DEV-2026-0003 accepté", actor: "Sofia Benali", tone: "mint" },
  { id: 2, when: "Il y a 42 min", title: "Tâche « Maquette accueil » passée en revue", actor: "Camille Rousseau", tone: "sky" },
  { id: 3, when: "Il y a 1 h", title: "Facture FAC-2026-0002 encaissée (CCP)", actor: "Awa Traore", tone: "mint" },
  { id: 4, when: "Il y a 3 h", title: "Demande de modification MOD-2026-0001", actor: "Marc Delaunay", tone: "amber" },
  { id: 5, when: "Hier", title: "Rapport journalier publié", actor: "Yacine Haddad", tone: "accent" },
  { id: 6, when: "Hier", title: "Nouveau prospect : Hôtel Les Dunes", actor: "Sofia Benali", tone: "sky" },
];
