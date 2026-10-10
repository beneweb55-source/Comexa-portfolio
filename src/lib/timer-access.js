import { can } from "@/lib/access";

/*
 * Droits du minuteur. Il faut DEUX familles de permissions :
 *  - lire les tâches assignées (GET /me/tasks) pour choisir une tâche ;
 *  - saisir du temps (POST /tasks/:id/time-entries) pour l'enregistrer à l'arrêt.
 * Sans l'une des deux, le minuteur n'est pas proposé : aucun appel n'est tenté,
 * donc aucun 403 n'apparaît à l'utilisateur (voir le correctif /me/tasks).
 * Le serveur reste la référence : ces tests ne servent qu'à l'affichage.
 */
export function canReadOwnTasks(user) {
  return can(user, "task:read:any") || can(user, "task:read:assigned") || can(user, "task:read:own");
}

export function canLogTime(user) {
  return can(user, "time:write:any") || can(user, "time:write:own");
}

export function canUseTimer(user) {
  return canReadOwnTasks(user) && canLogTime(user);
}
