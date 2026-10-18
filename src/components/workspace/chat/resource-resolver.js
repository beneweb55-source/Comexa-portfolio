"use client";

import { resourceKey, dedupeResourceRefs } from "@/lib/chat-resources";

/**
 * RESOLUTION DES CARTES DE RESSOURCES PARTAGEES.
 *
 * LE PRINCIPE QUI STRUCTURE CE FICHIER : le message ne transporte que le couple
 * (type, id) ; la CARTE se relit a chaque affichage, dans le perimetre du
 * LECTEUR. Ce module est la memoire de court terme de cette relecture, pas un
 * acces aux donnees — l'acces, c'est `POST /shared-resources/resolve` qui le
 * decide ligne par ligne.
 *
 * POURQUOI UN CACHE MODULE ET PAS D'ETAT DANS LE COMPOSANT. Une page de fil
 * rechargee, une conversation survolee deux fois, une carte suivie par la
 * frappe d'un nouveau message : sans cache, chacune de ces vues rejouerait la
 * relecture. Le cache vit 60 secondes — assez long pour une seance de lecture,
 * assez court pour qu'un statut changeant se voie sans recharger l'onglet. Il
 * est en MEMOIRE, par onglet : un statut n'est jamais partage entre deux
 * fenetres, jamais ecrit quelque part ou il survivrait a un changement de
 * droits.
 *
 * `inflight` est la piece qu'on serait tente d'oublier : deux effets qui
 * partent en parallele pour les memes identifiants feraient deux requetes. La
 * signature du lot est la cle de l'appel en cours ; le second arrivant attend
 * le premier.
 */

const CACHE_TTL_MS = 60_000;

/** Cle `TYPE:id` → `{ at, view }`. */
const cache = new Map();
/** Signature du lot → promesse du lot. */
const inflight = new Map();

/** Toutes les references partagees par une liste de messages, dedupliques. */
export function extractResourceRefs(messages) {
  const refs = [];
  for (const message of messages ?? []) {
    for (const resource of message.sharedResources ?? []) {
      refs.push({ resourceType: resource.resourceType, resourceId: resource.resourceId });
    }
  }
  return dedupeResourceRefs(refs);
}

function freshView(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.view;
}

/** Les vues deja connues, pour peindre instantanement ce qui vient d'arrive. */
export function cachedViews(refs) {
  const views = {};
  for (const ref of refs) {
    const view = freshView(resourceKey(ref));
    if (view) views[resourceKey(ref)] = view;
  }
  return views;
}

/**
 * Relecture d'un lot de references. Renvoie `{ [cle]: vue }`, VUE INCLUSE POUR
 * LES ECHECS : une carte muette est un etat, pas une absence (une absence
 * laisserait le message en « chargement… » pour toujours).
 *
 * En cas d'echec RESEAU (le serveur est joignable ou pas — distinct de « la
 * ressource n'est pas a vous »), les cles sont marquees `transient: true` : la
 * carte proposera de reessayer, et la prochaine visite retentera (l'entree
 * echouee n'est pas mise en cache).
 */
export async function resolveResourceRefs(request, refs) {
  const pending = (refs ?? []).filter((ref) => freshView(resourceKey(ref)) === null);
  const views = cachedViews(refs ?? []);
  if (pending.length === 0) return views;

  const signature = pending.map(resourceKey).sort().join(",");
  if (!inflight.has(signature)) {
    inflight.set(
      signature,
      request("/shared-resources/resolve", {
        method: "POST",
        body: { resources: pending },
      })
        .then(({ data }) => {
          const items = Array.isArray(data?.items) ? data.items : [];
          const byKey = new Map(items.map((item) => [resourceKey(item), item]));
          for (const ref of pending) {
            const view = byKey.get(resourceKey(ref));
            if (view) cache.set(resourceKey(ref), { at: Date.now(), view });
          }
          return byKey;
        })
        .finally(() => inflight.delete(signature)),
    );
  }

  try {
    const byKey = await inflight.get(signature);
    for (const ref of pending) {
      const key = resourceKey(ref);
      const view = byKey.get(key);
      if (view) views[key] = view;
    }
    return views;
  } catch {
    // Reseau/serveur en defaut : on ne grave pas l'echec dans le cache, la
    // prochaine montee du fil relira. En attendant, les vues transient
    // évitent le « chargement… » eternel.
    for (const ref of pending) {
      if (!views[resourceKey(ref)]) {
        views[resourceKey(ref)] = { ...ref, available: false, transient: true };
      }
    }
    return views;
  }
}

/** Oublier des cles (bouton « Reessayer », fin de session) : force une relecture. */
export function invalidateResourceKeys(keys) {
  for (const key of keys) cache.delete(key);
}
