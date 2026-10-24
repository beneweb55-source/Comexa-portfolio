# Mode hors ligne éditable — cadrage

## Décisions retenues

- Le `.exe` doit permettre de poursuivre le travail **dans tous les espaces**,
  pas seulement d'afficher un écran d'erreur ou une copie en lecture seule.
- L'accès hors ligne est permis uniquement après une première connexion en ligne
  sur cet appareil et pour le compte déjà utilisé.
- Les changements sont conservés sur l'appareil, puis synchronisés au retour du
  réseau.
- Les champs indépendants peuvent être fusionnés automatiquement. Une
  suppression, une facture ou un conflit ambigu est mis en attente et présenté
  à l'utilisateur ; aucune version n'est écrasée silencieusement.

## État actuel (important)

Socle désormais implémenté : l'installateur embarque le build standalone de
Next.js ; les réponses JSON réussies des GET authentifiés sont mises en cache
par compte/espace dans SQLite WASM. Le fichier complet est chiffré avec
`safeStorage` du système (DPAPI sous Windows) ; les rendus n'accèdent jamais à
SQL directement : le preload n'expose que des méthodes IPC allowlistées et le
processus principal vérifie l'origine locale ainsi que l'identité serveur avant
d'enregistrer un compte. Les migrations SQLite sont numérotées.

Après un premier login serveur confirmé, le mot de passe est converti en
vérificateur scrypt et seul le vérificateur salé est conservé dans la base
chiffrée. Le login hors ligne demande à nouveau ce mot de passe, limite et
temporise les essais, et expire sept jours après la dernière validation serveur.
Les réponses sont compartimentées par utilisateur/espace ; la déconnexion
verrouille la base en mémoire et le compte doit être authentifié pour la rouvrir.
Le backend ajoute `POST /api/auth/offline-authorization`, protégé par le token
actif et limité en débit : il revérifie le mot de passe courant sans émettre de
nouveau jeton/refresh cookie, puis journalise la préparation. Le desktop confirme
cet appel depuis le processus principal avant d'enregistrer le profil local.
Le schéma SQLite local en est à la migration 3 ; une horloge reculée de plus de
cinq minutes bloque l'autorisation au lieu de prolonger sa durée.

**Le mode hors ligne complet n'est pas encore livré.** Le cache ne contient que
les réponses effectivement demandées pendant une connexion antérieure ; aucun
préchargement exhaustif n'a lieu. Le cache est borné à 1 000 réponses / 128 Mio
par compte ; les plus anciennes sont élaguées en priorité. Les écritures sont groupées
sur 100 ms et forcées à la fermeture normale. Un arrêt forcé pendant cette courte
fenêtre peut perdre les toutes dernières lectures mises en cache. Les écritures,
téléchargements, PDFs, emails, la messagerie temps réel et intégrations restent
en ligne uniquement. Aucune
file n'envoie encore les modifications au serveur et aucune règle de conflit
n'est appliquée. Le bandeau hors ligne explique explicitement cette limite.

La révocation de compte ou de droits par le serveur ne peut pas être connue
pendant une coupure : l'accès local peut donc durer au maximum sept jours après
la dernière authentification serveur réussie, puis exige une reconnexion.

## Architecture nécessaire

Une mise en file générique des requêtes HTTP n'est pas sûre pour Comexa : les
créations peuvent nécessiter un identifiant serveur, les réponses déterminent
parfois la navigation, et les actions de facturation, d'envoi ou de suppression
ont des effets externes qui ne doivent pas être rejoués aveuglément. Le mode
hors ligne doit être construit par opérations métier explicites.

1. **Interface embarquée — implémentée** — distribuer les ressources de
   l'application avec le `.exe` et les charger depuis un serveur local. Le
   démarrage du frontend ne dépend plus de Vercel.
2. **Accès hors ligne — première version implémentée** — ne stocker ni mot de
   passe en clair ni jeton. Le main process conserve un vérificateur scrypt et
   profil/droits dans le fichier SQLite chiffré par le backend OS de
   `safeStorage`, limite les essais et applique une durée de sept jours. Les
   canaux IPC sont allowlistés, validés et refusés hors de l'origine localhost
   embarquée. Une révocation distante ne peut être propagée durant une coupure.
3. **Cache local — première version implémentée** — chaque GET JSON authentifié
   réussi est enregistré par compte/espace/URL, puis relu sur les échecs réseau.
   Le cache est limité aux réponses déjà consultées ; il n'existe pas encore de
   téléchargement complet ni de visibilité fine de fraîcheur par écran.
4. **Journal métier hors ligne** — enregistrer des opérations typées avec un
   identifiant stable, leur état (en attente, synchronisée, conflit, échec) et
   les rejouer dans l'ordre pertinent. Ne pas mettre en file les emails, appels
   à des intégrations, paiements, génération/envoi de PDF ou autres effets
   externes sans prise en charge explicite par le backend.
5. **Synchronisation et conflits** — ajouter au backend des clés d'idempotence,
   des versions de données (ou équivalent) et une API de synchronisation. Fusion
   des champs indépendants ; suspendre les suppressions, factures et conflits
   ambigus pour résolution utilisateur. Un échec de synchronisation ne doit
   jamais perdre ni doubler une opération.
6. **Indicateurs d'interface** — état en ligne/hors ligne, nombre d'opérations
   en attente, dernier succès de synchronisation, erreurs et écran de résolution
   des conflits, accessibles depuis chaque espace.

## Découpage de livraison

- **Phase A — socle desktop local (partiellement implémentée) :** frontend
  embarqué, login local après première connexion, SQLite chiffrée, cache des GET
  déjà visités et bannière hors ligne. Les actions non prises en charge restent
  clairement indisponibles. Il manque encore l'écriture locale et la reprise des
  données après conflits.
- **Phase B — données et opérations internes :** mettre en place le protocole de
  synchronisation et l'intégrer progressivement aux modules de travail
  (tâches, calendrier, temps, rapports, projets, contacts, etc.), avec tests de
  coupure réseau et de rejeu idempotent.
- **Phase C — fonctions à effets externes :** définir une règle spécifique pour
  messagerie, factures/devis, documents, emails et intégrations ; ne les déclarer
  hors ligne qu'après validation du backend et des règles de conflit.
- **Phase D — distribution :** installer et tester le `.exe` Windows sur un
  poste propre, sans accès réseau au premier démarrage puis après une première
  connexion, et vérifier mise à jour, déconnexion, comptes multiples, données
  sensibles et reprise après conflit.

## Critères de validation

- Après une connexion réussie en ligne, couper le réseau et relancer le `.exe` :
  l'utilisateur retrouve son espace autorisé et les dernières données
  synchronisées, sans redirection vers Vercel ni écran blanc.
- Les opérations hors ligne annoncées comme disponibles restent visibles après
  fermeture/redémarrage et ne sont ni perdues ni dupliquées à la reconnexion.
- Une modification concurrente sur le serveur est fusionnée uniquement si elle
  est non ambiguë ; sinon l'opération reste en attente avec une explication et
  les deux versions sont conservées jusqu'au choix de l'utilisateur.
- Un autre compte sur le même appareil ne peut pas consulter les données du
  premier compte. La déconnexion efface ou verrouille les données locales selon
  une règle explicite.
- Les fonctions non compatibles (par exemple envoi d'email) ne se présentent
  jamais comme effectuées hors ligne.

## Garde-fous pour les étapes suivantes

La couche actuelle ne rejoue aucune écriture. Les tables `pending_operations`,
`sync_conflicts` et `sync_state` ne sont que des points de schéma réservés ;
aucune opération n'y est encore créée ou synchronisée. Avant d'activer des
modifications hors ligne, le backend doit appliquer l'idempotence et le contrôle
de version sur chaque commande métier prise en charge. Les actions financières,
suppressions et effets externes restent bloqués jusqu'à l'implémentation de leur
règle dédiée.
