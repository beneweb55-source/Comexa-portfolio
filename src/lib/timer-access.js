import { can } from "@/lib/access";

/*
 * Droits du minuteur. Il faut DEUX familles de permissions :
 *  - lire les tâches assignées (GET /me/tasks) pour choisir une tâche ;
 *  - saisir du temps (POST /tasks/:id/time-entries) pour l'enregistrer à l'arrêt.
 * Avec `time:write:own`, le backend exige aussi une tâche modifiable ; avec
 * `time:write:any`, une tâche lisible suffit. Sans ces droits, le minuteur n'est
 * pas proposé : l'interface n'envoie pas un enregistrement voué à échouer.
 * Le serveur reste la référence : ces tests ne servent qu'à l'affichage.
 */
export function canReadOwnTasks(user) {
  return can(user, "task:read:any") || can(user, "task:read:assigned") || can(user, "task:read:own");
}

export function canLogTime(user) {
  return can(user, "time:write:any") || can(user, "time:write:own");
}

export function canUseTimer(user) {
  if (!canReadOwnTasks(user) || !canLogTime(user)) return false;

  // time:write:own asks the backend to requireWritable(task), not merely to
  // requireReadable(task). Do not offer a timer whose first save would 404.
  return can(user, "time:write:any") || can(user, "task:write:any") || can(user, "task:write:own");
}
