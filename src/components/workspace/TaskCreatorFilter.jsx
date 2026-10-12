"use client";

import { EVERY_CREATOR, creatorNameOf } from "@/lib/tasks";
import { Notice } from "@/components/workspace/ui";
import { UserAvatar } from "@/components/workspace/UserAvatar";

/**
 * Filtre des tâches « par personne ».
 *
 * « Tous » est sélectionné par défaut et rend la main avec `EVERY_CREATOR`
 * (`null`) : le parent n'envoie alors AUCUN `reporterId`, et l'API rend toutes
 * les tâches du projet. Sinon la valeur transmise est l'identifiant du compte —
 * le filtrage se fait sur l'identifiant unique, jamais sur le nom affiché.
 *
 * Les profils viennent du serveur (`/projects/:id/tasks/creators`) : ils sont
 * déjà restreints aux tâches que le porteur peut lire, et un profil qui n'a créé
 * aucune tâche n'y figure pas. Un projet sans tâche n'a donc rien à filtrer, et le
 * composant ne rend rien — l'écran affiche son état vide.
 */
export function TaskCreatorFilter({ creators, value = EVERY_CREATOR, onChange, loading = false, error = null }) {
  const profiles = creators ?? [];

  if (error) return <Notice>{error}</Notice>;
  if (loading && profiles.length === 0) {
    return <p className="cx-small" role="status">Chargement des profils…</p>;
  }
  if (profiles.length === 0) return null;

  return (
    <div className="cx-filter" role="group" aria-label="Filtrer les tâches par créateur">
      <button
        type="button"
        aria-pressed={value === EVERY_CREATOR}
        onClick={() => onChange(EVERY_CREATOR)}
        className="cx-filter__chip cx-filter__chip--all"
      >
        Tous
      </button>
      {profiles.map((profile) => (
        <button
          key={profile.id}
          type="button"
          aria-pressed={value === profile.id}
          onClick={() => onChange(profile.id)}
          title={creatorNameOf(profile)}
          className="cx-filter__chip"
        >
          <UserAvatar profile={profile} size={26} />
          <span className="cx-filter__name">{creatorNameOf(profile)}</span>
          <span className="cx-filter__count">{profile.taskCount}</span>
        </button>
      ))}
    </div>
  );
}

export default TaskCreatorFilter;
