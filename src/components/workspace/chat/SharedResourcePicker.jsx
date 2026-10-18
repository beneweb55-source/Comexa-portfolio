"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import { useAuth } from "@/lib/session";
import { messageOf } from "@/lib/api";
import {
  resourceKey,
  resourceStatusLabel,
  resourceStatusTone,
  resourceTypeLabel,
  searchableResourceSources,
} from "@/lib/chat-resources";
import { Badge, secondaryButton } from "@/components/workspace/ui";

/**
 * PICKER DE RESSOURCES — « joindre », sans quitter la conversation.
 *
 * UNE RECHERCHE, SIX SOURCES. Le champ tape une fois, chaque type accessible
 * au porteur est interroge EN PARALLELE sur sa propre rubrique (les memes
 * endpoints `?search=` que le dashboard — meme perimetre, meme droits, aucune
 * route inventee) et les resultats se reconstituent en un seul classement.
 * Un type sans droit n'apparait pas : on ne montre pas une source qui
 * repondrait 403.
 *
 * LA SELECTION STAGE, ELLE N'ENVOIE PAS. Cliquer une ligne l'ajoute a la zone
 * de redaction (puces visibles AVANT l'envoi : c'est l'aperçu demanded). Le
 * message, lui, se part toujours depuis le composeur — le picker ne declenche
 * jamais un envoi a la place de l'utilisateur.
 *
 * RACCOURCIS : Entrree ajoute le premier resultat ; Echap ferme (gere par le
 * composeur) ; `aria-activedescendant` est inutile ici — chaque ligne est un
 * vrai bouton, donc la navigation Tab naturelle suffit dans un popover court.
 */
export function SharedResourcePicker({ open, onClose, selected, onToggle }) {
  const { request, user } = useAuth();
  const [term, setTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState(null); // null = Tous
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [groups, setGroups] = useState([]);
  const inputRef = useRef(null);

  const sources = useMemo(() => searchableResourceSources(user), [user]);
  const activeSources = typeFilter ? sources.filter((s) => s.type === typeFilter) : sources;

  // A l'ouverture : focus immediat — le contexte (la conversation ouverte) ne
  // doit jamais se perdre pendant la recherche.
  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Recherche debordee (240 ms des qu'il y a du texte, immediate pour
  // l'etalage par defaut), annulee a chaque changement de terme comme a la
  // fermeture : un résultat qui arrive APRÈS la fermeture ne doit pas
  // reecrire l'etat d'un popover qui n'existe plus.
  useEffect(() => {
    if (!open) return undefined;

    const trimmed = term.trim();
    let cancelled = false;

    const timer = window.setTimeout(() => {
      const search = async () => {
        setLoading(true);
        setError(null);

        const results = await Promise.allSettled(
          activeSources.map(async (source) => {
            const { data } = await request(source.path(trimmed));
            const rows = Array.isArray(data) ? data : (data?.items ?? []);
            return {
              type: source.type,
              items: rows.slice(0, 5).map((row) => ({
                resourceType: source.type,
                resourceId: row.id,
                ...source.mapRow(row),
              })),
            };
          }),
        );
        if (cancelled) return;

        const ok = results
          .filter((r) => r.status === "fulfilled")
          .map((r) => r.value)
          .filter((group) => group.items.length > 0);
        const failed = results.filter((r) => r.status === "rejected");
        if (ok.length === 0 && failed.length > 0 && activeSources.length > 0) {
          // Toutes les sources echouent : c'est une panne, pas une recherche
          // sans fruit — le message d'erreur doit le dire.
          setError(messageOf(failed[0].reason) || "La recherche est momentanement indisponible.");
        }
        setGroups(ok);
        setLoading(false);
      };

      search().catch(() => {
        if (cancelled) return;
        setError("La recherche est momentanement indisponible.");
        setLoading(false);
      });
    }, trimmed.length > 0 ? 240 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `request` et `user` viennent du contexte (stables) ; `sources` est memoire
    // de `user`. Inclure `activeSources` (reconstruit a chaque rendu) relancerait
    // la recherche a chaque frappe de touche — le filtre est deja dans `typeFilter`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, term, typeFilter, sources]);

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const firstItem = groups[0]?.items[0] ?? null;

  if (!open) return null;

  return (
    <div className="sui-res-picker" role="dialog" aria-modal="false" aria-label="Joindre une ressource Comexa">
      <div className="sui-res-picker__head">
        <span className="sui-res-picker__search-icon" aria-hidden="true">
          <Search size={15} strokeWidth={2} />
        </span>
        <input
          ref={inputRef}
          type="search"
          className="sui-res-picker__input"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (firstItem) onToggle(firstItem);
            }
          }}
          placeholder="Projets, tâches, clients, factures…"
          aria-label="Rechercher une ressource Comexa"
        />
        <button type="button" className="sui-iconbtn sui-iconbtn--ghost sui-res-picker__close" onClick={onClose} aria-label="Fermer la recherche de ressources">
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="sui-res-picker__tabs" role="group" aria-label="Filtrer par type">
        <button type="button" className="sui-pill sui-res-picker__tab" aria-pressed={typeFilter === null} onClick={() => setTypeFilter(null)}>
          Tous
        </button>
        {sources.map((source) => (
          <button
            key={source.type}
            type="button"
            className="sui-pill sui-res-picker__tab"
            aria-pressed={typeFilter === source.type}
            onClick={() => setTypeFilter((current) => (current === source.type ? null : source.type))}
          >
            {resourceTypeLabel(source.type)}
          </button>
        ))}
      </div>

      <div className="sui-res-picker__results">
        {error ? <p className="sui-res-picker__notice" role="alert">{error}</p> : null}

        {!error && loading && total === 0 ? (
          <p className="sui-res-picker__notice">Recherche dans Comexa…</p>
        ) : null}

        {!error && !loading && total === 0 ? (
          <div className="sui-res-picker__empty">
            <p>
              {term.trim()
                ? <>Rien ne correspond à «&nbsp;{term.trim()}&nbsp;» dans ce que vous pouvez ouvrir.</>
                : "Aucune ressource joignable pour votre compte."}
            </p>
            <span>Un type absent de la liste ? Il est masque faute de droits — pas faute de données.</span>
          </div>
        ) : null}

        {groups.map((group) => (
          <section key={group.type} className="sui-res-picker__group" aria-label={resourceTypeLabel(group.type)}>
            <h4 className="sui-res-picker__group-title">{resourceTypeLabel(group.type)}</h4>
            <ul className="sui-res-picker__list">
              {group.items.map((item) => {
                const key = resourceKey(item);
                const isSelected = selected.some((ref) => resourceKey(ref) === key);
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className={`sui-res-picker__item${isSelected ? " is-selected" : ""}`}
                      aria-pressed={isSelected}
                      onClick={() => onToggle(item)}
                    >
                      <span className="sui-res-picker__copy">
                        <strong>{item.title}</strong>
                        {item.subtitle ? <span>{item.subtitle}</span> : null}
                      </span>
                      {item.statusKey ? (
                        <Badge tone={resourceStatusTone(group.type, item.statusKey)}>
                          {resourceStatusLabel(group.type, item.statusKey)}
                        </Badge>
                      ) : null}
                      <span className="sui-res-picker__mark" aria-hidden="true">
                        {isSelected ? <Check size={15} strokeWidth={2.4} /> : <Plus size={15} strokeWidth={2.2} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <footer className="sui-res-picker__foot">
        <span>
          {selected.length > 0 ? `${selected.length} référence${selected.length > 1 ? "s" : ""} prête${selected.length > 1 ? "s" : ""}` : "Cliquez pour ajouter au message"}
        </span>
        <button type="button" className={`${secondaryButton} sui-btn--sm`} onClick={onClose}>
          {selected.length > 0 ? "Terminer" : "Fermer"}
        </button>
      </footer>
    </div>
  );
}

export default SharedResourcePicker;
