# Utiliser Comexa Desktop hors connexion

## Ce qui est déjà disponible

L'application desktop peut démarrer sans Vercel : l'installateur embarque une
interface Next.js autonome, servie localement. Le backend reste distant ; sans
réseau, Comexa s'appuie sur les données et les opérations locales décrites ci-dessous.

Après une première connexion réussie **dans l'application desktop**, le poste
peut conserver un accès local au même compte :

- le mot de passe n'est jamais conservé en clair ; un vérificateur scrypt est
  stocké dans une base SQLite chiffrée par le système via Electron `safeStorage`
  (DPAPI sous Windows) ;
- un mot de passe hors ligne valide est requis à chaque connexion ; les essais
  sont temporisés et l'autorisation expire au plus tard sept jours après la
  dernière confirmation en ligne ;
- le profil, les espaces et permissions sont isolés par compte ; le preload ne
  donne pas accès direct aux fichiers ou à la base, et les appels IPC vérifient
  l'origine locale et le compte actif ;
- les réponses JSON des lectures authentifiées réussies sont enregistrées par
  utilisateur, espace et URL, puis réutilisées si le réseau est coupé ;
- les modifications explicitement prises en charge sont gardées dans une file
  locale chiffrée et synchronisées au retour du réseau. Un identifiant stable
  empêche de créer deux fois une même opération ; les données concurrentes sont
  conservées et présentées pour arbitrage au lieu d'être écrasées sans prévenir.

## Préparer le poste avant de perdre le réseau

1. Installez la **version récente de Comexa Desktop avec son interface intégrée**.
   Le workflow GitHub `Application desktop` produit l'installateur Windows ; le
   lancer manuellement dépose l'installateur dans l'artefact
   `comexa-desktop-windows` du run. Une version qui ouvre seulement le site
   hébergé ne peut pas démarrer hors connexion.
2. Connectez-vous une première fois en ligne dans l'application desktop avec le
   compte qui sera utilisé hors connexion. Après cette connexion, l'indicateur
   **« Accès hors ligne prêt »** confirme que l'autorisation locale est active.
   Un simple login dans un navigateur ne prépare pas le stockage desktop.
3. Ouvrez en ligne les espaces et les pages dont vous aurez besoin. Le cache est
   alimenté par les lectures effectuées : il n'est pas une copie exhaustive de
   toutes les données de la plateforme. Une page jamais consultée sur cet
   appareil peut donc être indisponible hors connexion.
4. En cas de coupure, relancez Comexa Desktop puis utilisez **« Se connecter
   sans Internet »** avec le même e-mail et le même mot de passe. Si le système
   sait déjà qu'il n'y a pas de réseau, le bouton normal de connexion tente
   également l'accès local directement.
5. Les pages en cache restent consultables. Les opérations de la liste
   ci-dessous sont sauvegardées localement ; au retour du réseau, elles se
   synchronisent automatiquement ou via le bouton **« Synchroniser »**.
   Vérifiez l'indicateur des opérations en attente et les éventuels conflits.

> **Ce mode concerne l'application desktop.** Le site web dans un navigateur
> nécessite toujours une connexion Internet. L'accès local doit avoir été
> préparé en ligne sur l'appareil concerné ; le premier démarrage hors ligne
> d'un compte jamais authentifié localement n'est pas autorisé.

## Modifications actuellement mises en file

La politique est volontairement explicite dans `offline-store.js` et `api.js` :
une route absente de la liste n'est jamais présentée comme modifiée avec succès.
Les domaines couverts incluent, selon les routes disponibles et les droits du
compte :

- projets, tâches, jalons et saisies de temps ;
- tâches et objectifs personnels, associations tâche-objectif, calendrier
  personnel et rapports journaliers ;
- clients, contacts et prospects ;
- demandes de génération de rapports (le rapport lui-même est généré une fois
  connecté) ;
- métadonnées de documents et notifications (pas leur contenu binaire).

La file gère les IDs locaux des créations et les dépendances entre opérations,
les réessaie avec la même clé d'idempotence, compare les snapshots disponibles
et expose les erreurs/conflits dans l'interface. Les droits sont néanmoins
revérifiés par le serveur à la synchronisation. Une modification refusée ou
ambiguë reste visible et conservée localement jusqu'à résolution.

Les détails par espace et les routes couvertes sont dans
[`OFFLINE-INVENTORY.md`](./OFFLINE-INVENTORY.md).

## Limites importantes

- **Cache à la première visite :** seules les réponses déjà demandées sont
  disponibles. Le cache est borné à 1 000 réponses et 128 Mio par compte ; les
  entrées les plus anciennes sont retirées en priorité. Certaines vues, filtres
  ou pages de détail peuvent demander une URL différente et provoquer un cache
  manquant.
- **Droits et sécurité :** une révocation de compte ou de permissions ne peut
  pas être connue pendant la coupure. Le profil hors ligne reflète le dernier
  état confirmé et son autorisation expire au bout de sept jours ; reconnectez-
  vous pour confirmer les droits actuels.
- **Effets distants :** factures/devis, paiements, envoi d'e-mail, intégrations,
  messagerie temps réel, changements de compte/rôle, PDF, téléversements et
  téléchargements protégés nécessitent Internet. La génération d'un rapport
  peut être mise en attente, mais pas son calcul côté serveur.
- **Conflits :** certaines modifications peuvent être rejouées automatiquement
  si les champs changés sont indépendants. En cas de changement concurrent sur
  les mêmes champs, les deux versions sont gardées pour un choix explicite.
- **Stockage sécurisé :** si le système ne propose pas un backend de chiffrement
  fiable, la préparation hors ligne est désactivée plutôt que de conserver des
  données métier en clair.
- **Version hébergée :** en développement, si aucun build local n'est présent,
  Electron peut ouvrir le site hébergé en ligne. Un installateur desktop ne doit
  pas utiliser ce repli ; il exige l'interface intégrée et affiche une erreur
  locale claire si le bundle manque.

## Tester le parcours

1. Sur un poste propre, installer l'artefact desktop et ouvrir une session en
   ligne ; vérifier **« Accès hors ligne prêt »**.
2. Consulter quelques pages et effectuer une opération mise en file.
3. Fermer l'application, couper le réseau, la relancer et se connecter avec le
   bouton **« Se connecter sans Internet »**.
4. Vérifier le chargement des pages déjà consultées et la présence de la
   modification locale après fermeture/réouverture.
5. Rétablir le réseau, synchroniser, puis vérifier côté serveur que chaque
   opération n'a été appliquée qu'une fois et qu'un conflit reste visible.

Les tests unitaires du stockage et de la file sont dans `desktop/tests/` ; ils
peuvent être lancés avec `cd desktop && npm ci && npm test`. Ils ne remplacent pas
un essai sur l'installateur Windows, les services du système et un backend réel.
