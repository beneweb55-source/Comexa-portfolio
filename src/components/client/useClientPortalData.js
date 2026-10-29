"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/session";
import { useObject } from "@/lib/use-object";
import { useListing } from "@/lib/use-listing";
import { useAllListing } from "@/lib/use-all-listing";
import { buildClientFocus, CLIENT_CLOSED_PROJECT_STATUSES } from "@/lib/client-portal.mjs";

/**
 * Donnees de l'accueil client. Toutes les routes sont deja filtrees par le
 * backend sur le dossier du porteur : ce hook ne tente jamais de deviner un
 * `clientId` et ne demande aucune ressource interne (taches, temps, budget).
 */
export function useClientPortalData() {
  const { request } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  const dashboard = useObject("/dashboard/client");
  const quotes = useAllListing("/quotes?perPage=100");
  const invoices = useAllListing("/invoices?perPage=100");
  const modifications = useAllListing("/modification-requests?perPage=100");
  const conversations = useListing("/conversations?perPage=50");
  const projects = useAllListing("/projects?perPage=100");
  const [milestoneState, setMilestoneState] = useState({ key: "", byProject: {} });

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const activeProjects = useMemo(
    () => (projects.items ?? []).filter((project) => project?.id && !CLIENT_CLOSED_PROJECT_STATUSES.includes(project.status)).slice(0, 5),
    [projects.items],
  );
  const projectKey = activeProjects.map((project) => project.id).join(",");

  useEffect(() => {
    if (!projectKey || !request) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    Promise.all(
      activeProjects.map(async (project) => {
        try {
          const { data } = await request(`/projects/${encodeURIComponent(project.id)}/milestones?perPage=100`, { signal: controller.signal });
          return [project.id, Array.isArray(data) ? data : []];
        } catch {
          // Un jalon indisponible ne doit pas faire croire a une liste vide.
          return [project.id, null];
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      // Le setState vit dans le callback reseau, pas dans le corps de l'effet :
      // pas de rendu en cascade au montage.
      setMilestoneState({ key: projectKey, byProject: Object.fromEntries(entries) });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeProjects, projectKey, request]);

  const milestonesByProject = useMemo(
    () => (milestoneState.key === projectKey ? milestoneState.byProject : {}),
    [milestoneState, projectKey],
  );
  const milestonesPending = Boolean(projectKey) && milestoneState.key !== projectKey;

  const model = useMemo(
    () => buildClientFocus({
      quotes: quotes.items,
      invoices: invoices.items,
      modifications: modifications.items,
      conversations: conversations.items,
      projects: projects.items,
      milestonesByProject,
      unreadNotifications: dashboard.data?.notifications?.unread ?? 0,
      now,
    }),
    [conversations.items, dashboard.data, invoices.items, milestonesByProject, modifications.items, now, projects.items, quotes.items],
  );

  const sources = [dashboard, quotes, invoices, modifications, conversations, projects];
  const loading =
    sources.some((source) => source.loading && !source.error && (source.items === null || source.data === null)) ||
    milestonesPending;
  const errors = sources
    .map((source, index) => ({ message: source.error, index }))
    .filter((entry) => entry.message)
    .map((entry) => ["tableau de bord", "devis", "factures", "demandes de modification", "messagerie", "projets"][entry.index]);

  return { model, loading, errors };
}
