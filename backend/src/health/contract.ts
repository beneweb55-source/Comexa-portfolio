/**
 * CONTRAT D'API — VERSION ET FONCTIONNALITES ATTENDUES PAR LE FRONTEND.
 *
 * -----------------------------------------------------------------------
 * POURQUOI CE FICHIER EXISTE
 * -----------------------------------------------------------------------
 * Deux pannes de production (« 404 sur /api/timer », « 400 property personalOnly
 * should not exist ») avaient la meme cause : le BACKEND deploye tournait sur un
 * build ANTERIEUR au frontend. Le code du depot etait correct ; les deux pieces
 * de la pile ne parlaient pas la meme version du contrat. Un tel ecart se
 * manifeste toujours par des erreurs de validation obscures ou des 404 de
 * routeur, qui ne disent jamais « votre backend est perime ».
 *
 * Le correctif architectural est la POIGNEE DE MAIN DE CONTRAT :
 *
 *  - toute reponse API porte l'en-tete `X-Comexa-Contract` (voir
 *    `app.setup.ts`) ;
 *  - `GET /api/health` expose ce bloc `contract` ;
 *  - le frontend (`src/lib/contract.js`) compare les FONCTIONNALITES qu'il
 *    utilise a celles que le serveur declare, et affiche une alerte explicite
 *    si le serveur est trop ancien — au lieu de laisser des 404/400 silencieux
 *    dans la console.
 *
 * La comparaison se fait par FONCTIONNALITE et non par numero : « le serveur
 * declare-t-il le minuteur ? les taches personnelles ? le calendrier ? » dit
 * exactement ce qui manque, la ou un numero de version ne ferait qu'ordonner.
 *
 * -----------------------------------------------------------------------
 * QUAND INCREMENTER
 * -----------------------------------------------------------------------
 * `version` change a chaque evolutive du contrat (route, champ, regle). Une
 * nouvelle clee dans `features` accompagne chaque fonctionnalite que le
 * frontend utilise DESORMAIS et qu'un ancien serveur ne connait pas.
 */
export interface ApiContract {
  /** Version du contrat (calendrier de l'equipe, informatif). */
  readonly version: string;
  /**
   * Fonctionnalites servies par CE build. Le frontend reclame les siennes
   * dans `src/lib/contract.js` ; toute clee absente ici est un serveur perime.
   */
  readonly features: Readonly<Record<string, true>>;
}

export const API_CONTRACT: ApiContract = {
  version: '2026-10-21.2',
  features: {
    // P2 : suivi du temps persiste cote serveur.
    timer: true,
    // P1 : taches personnelles sans projet ni assignation.
    personalTasks: true,
    // P3 : calendriers personnel et equipe.
    calendar: true,
    // Filtre « par personne » des taches : `?reporterId=` sur la liste d'un
    // projet et `GET /projects/:id/tasks/creators`. Un serveur anterieur repond
    // 400 sur le parametre inconnu et 404 sur la route : le frontend doit le
    // savoir avant d'afficher des cartes sans createur.
    taskCreators: true,
    // Objectifs personnels : `GET|POST /me/goals`, liaison des taches.
    goals: true,
    // Minuteur v2 : `GET /timer/tasks|recent-tasks|summary`, `PATCH /timer`,
    // `POST /timer/discard`, note et description a l'arret. Un serveur
    // anterieur repond 404 : le selecteur de taches de projet serait vide.
    timerTasks: true,
    // Assignation depuis l'ecran : `GET /projects/:id/tasks/assignees`.
    taskAssignees: true,
    // Guide de demarrage : `GET /guide`, `POST /guide/steps/:id/complete`. Un
    // serveur anterieur repond 404 : la pastille « Premiers pas » resterait
    // silencieuse (aucun ecran casse, mais aucune etape non plus).
    guide: true,
  },
};

/** Valeur de l'en-tete `X-Comexa-Contract` (version seule, legible par un humain). */
export const API_CONTRACT_HEADER = 'X-Comexa-Contract';
