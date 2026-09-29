# Deploiement — Comexa backend

Runbook pour mettre l'API en production sur **une VM unique, toujours allumee**.

Chaque affirmation de ce document a ete mesuree (version de Node, `docker compose
config`, sortie reelle des commandes citees), pas recopiee d'un tutoriel.

> **Deux chemins, un seul jeu de reglages.** Les sections 1 a 17 decrivent le
> deploiement sur **VM**. Si vous n'avez pas de machine — pas de carte bancaire,
> rien a administrer — l'**annexe A** decrit le meme deploiement sur **Render**,
> avec ce que ce palier gratuit impose en plus. Neon, Mailjet et Backblaze B2 s'y
> configurent a l'identique.

---

## 1. L'architecture retenue, et pourquoi

| Brique | Choix | Role |
|---|---|---|
| Machine | VM Ubuntu 24.04, 1 vCPU / 2 Go minimum | Fait tourner deux conteneurs |
| Base de donnees | **Neon** (deja en place) | Hors de la machine : survit a sa perte |
| Fichiers | **Backblaze B2** (S3-compatible, 10 Go gratuits, sans carte) | Les binaires ne vont jamais en base |
| TLS | **Caddy** | Certificat Let's Encrypt automatique |
| Courriel | **Mailjet** (6 000/mois et 200/jour gratuits, sans domaine) | Reinitialisation de mot de passe, envoi des devis et des factures |

### Pourquoi une VM, et pas une plateforme serverless

Trois fonctionnalites du backend exigent un processus qui **vit en continu**, et
une seule instance :

1. `InvoiceOverdueService` porte un `@Cron(CronExpression.EVERY_HOUR)`. Sur une
   plateforme qui endort les services inactifs, la relance des factures en
   retard ne part **jamais** — sans erreur, sans trace.
2. `@nestjs/websockets` + socket.io gardent des connexions ouvertes, qu'une mise
   en veille coupe.
3. Le limiteur de debit et le verrouillage de compte tiennent leur etat en
   **memoire vive**. Deux instances = deux compteurs, donc une limite reellement
   deux fois plus haute que celle qui est annoncee.

> **Mesure du 29/09/2026, conservee ici parce qu'elle a decide du choix.** Le
> palier gratuit de Render endort un service apres 15 min sans trafic, plafonne a
> 750 heures-instance par mois pour un mois qui en compte 720 a 744, et **bloque
> en sortie les ports SMTP 25, 465 et 587** (mesure prise depuis le 26/09/2025).
> Avec `nodemailer`, cela ne donne pas une erreur d'authentification mais un
> `ETIMEDOUT` reseau : le serveur demarre, et chaque courriel echoue en silence.

---

## 2. Ce qu'il faut avoir avant de commencer

- [ ] Un **nom de domaine** que vous administrez (`exemple.tld`) et l'acces a sa
      zone DNS — **ou** un sous-domaine gratuit (voir l'encadre plus bas).
- [ ] Un **compte Backblaze** — 10 Go gratuits a vie, **aucune carte bancaire
      demandee** tant que vous restez sous 10 Go.
- [ ] Un **compte Mailjet** — 6 000 courriels/mois et 200/jour gratuits, aucun
      domaine requis (validation d'une simple adresse d'expedition).
- [ ] La **chaine de connexion Neon**, en deux exemplaires : l'hote *pooli*
      (`-pooler`) et l'hote *direct*.
- [ ] Environ **45 minutes**.

> **Point d'honnetete sur la carte bancaire.** Oracle l'ecrit ainsi : « For
> security purposes, **most users** need a mobile phone number and a credit card
> to create an account. » — *most*, pas *all*. La carte sert a verifier
> l'identite et n'est **jamais debitee** tant que vous restez dans les limites du
> palier gratuit. Le `e2-micro` de Google Cloud, lui, l'exige sans cette reserve.
> Autrement dit : tentez l'inscription Oracle meme sans carte ; si elle est
> refusee, la section **« Si vous n'avez pas de carte »** en §3 donne les deux
> seules voies qui restent en 2026, avec ce que chacune coute. Backblaze, lui, ne
> la demande pas du tout : c'est pourquoi le stockage est chez eux et non chez
> Cloudflare R2, qui l'exige.

> **Si vous n'avez pas encore de domaine.** Caddy a besoin d'un NOM, pas d'un
> achat : un sous-domaine gratuit chez **DuckDNS** (`comexa-api.duckdns.org`)
> convient, et Let's Encrypt delivre un certificat pour ce nom exactement comme
> pour un autre. Ce n'est pas un pis-aller : c'est la bonne etape avant d'avoir
> un domaine. Le jour ou vous en achetez un, vous changez `API_DOMAIN`, vous
> recreez l'enregistrement A, et Caddy obtient un nouveau certificat au
> redemarrage.
>
> La seule chose a ne PAS faire est de laisser `exemple.tld` dans
> `.env.production` : Caddy demanderait un certificat pour un nom qui appartient
> a quelqu'un d'autre, la validation echouerait, et l'API resterait injoignable.
>
> **Et si le frontend part sur Vercel.** Le domaine du frontend
> (`xxx.vercel.app`) n'a aucun parent commun avec celui de l'API : dans ce cas
> `COOKIE_SAMESITE=none` devient necessaire, avec ce que cela coute — voir la
> ligne correspondante du tableau en §10. C'est le seul reglage ou heberger les
> deux sur la meme machine serait plus simple.

---

## 3. Creer la VM

### Oracle Cloud — palier « Always Free »

1. Inscription sur <https://www.oracle.com/cloud/free/>, region **la plus proche
   de vos utilisateurs** (elle est definitive : on ne peut pas la changer).
   Depuis l'Algerie, les deux plus proches sont **`eu-marseille-1`** (France
   Sud) et `eu-paris-1`. Sur la carte bancaire, la formulation officielle est :
   « For security purposes, **most users** need a mobile phone number and a
   credit card to create an account. Your credit card will not be charged unless
   you upgrade your account. » — *most*, donc pas tous, et la carte n'est jamais
   debitee tant que vous restez sur le palier gratuit. Cela vaut donc la peine
   d'essayer meme sans carte : c'est une inscription de dix minutes. Si elle est
   refusee, voir « Si vous n'avez pas de carte » plus bas.
2. **Compute → Instances → Create instance** :
   - Image : **Ubuntu 24.04**
   - Shape : **`VM.Standard.A1.Flex`** (ARM Ampere), **2 OCPU / 12 Go**.
     C'est le plafond du palier gratuit depuis le 15/06/2026 — il valait
     4 OCPU / 24 Go auparavant, et **les instances plus grosses sont supprimees
     au bout de 30 jours** si l'on reste sur un compte gratuit.
   - **Assign a public IPv4 address** : oui.
3. Telecharger la **cle privee SSH** proposee a la creation. Elle n'est
   **proposee qu'une fois** ; sans elle, la seule sortie est de recreer la VM.

> **`Out of host capacity`.** C'est le message le plus courant, et il ne signale
> pas une erreur de votre part : les hotes ARM gratuits sont sursouscrits.
> Reessayez, changez de domaine de disponibilite, ou repassez quelques heures
> plus tard. C'est une loterie d'approvisionnement, pas un diagnostic.

> **Un risque a connaitre AVANT de choisir ce palier : la recuperation des
> instances inactives.** Oracle peut reprendre automatiquement une instance
> Always Free jugee inactive sur une fenetre **continue de 7 jours** — quand
> TROIS mesures passent sous 20 % en meme temps : le CPU (95e centile), le
> reseau, et la memoire pour les formes A1. Une API a faible trafic remplit les
> trois, par construction : elle fonctionne, et c'est precisement ce qui la rend
> « inactive » au sens de la mesure. L'instance peut donc disparaitre sans
> avertissement. Le volume de demarrage survit ; la machine, non.
>
> Ce n'est pas une raison d'ecarter ce palier, c'est une raison de traiter cette
> VM comme **remplacable**. Tout ce qui compte est dans git (§7), dans
> `.env.production` (§10), et la base vit chez Neon : rien d'irremplacable ne
> tient sur le disque de cette machine. Concretement, cela veut dire que
> `git clone`, un `.env.production` et deux commandes Compose suffisent a la
> reconstruire — le jour ou cela devient penible, c'est ce enchainement qu'il
> faudra ecrire comme un script. Il n'existe pas encore.
>
> **Et pourquoi cela n'arrive probablement pas.** Les trois mesures forment un
> **ET**, pas un OU : il suffit que l'une seule reste au-dessus de 20 % pour
> sortir de la definition. Sur une forme A1, la memoire est la moins couteuse a
> tenir : 20 % de 12 Go font 2,4 Go, et un conteneur qui retient de la memoire ne
> consomme pas de CPU pour autant — contrairement a un script qui ferait tourner
> `openssl speed` en boucle. Des outils communautaires existent pour cela. Mais
> c'est du territoire **non documente par Oracle**, et deux avertissements valent
> mieux qu'un espoir : la mesure est un **95e centile**, pas une moyenne — pour la
> faire bouger, il faut de la charge pendant au moins 5 % de la fenetre, soit
> environ **1 h 12 par jour** cumulees. Un ping quotidien n'y change donc rien,
> et c'est precisement l'erreur que reprennent la plupart des guides. Rien de
> tout cela ne doit remplacer le paragraphe precedent sur le caractere
> remplacable de la machine : c'est un pari raisonnable, pas un acquis.
>
> Deux gestes utiles des maintenant : une **surveillance externe** qui interroge
> `/api/health` toutes les 5 minutes (UptimeRobot, Healthchecks.io) — elle ne
> protege pas de la recuperation, mais elle vous previent que la machine a
> disparu, au lieu de vous le faire decouvrir par un client ; et les
> **sauvegardes de §15**, qui ne dependent pas de cette machine.
>
> Le passage en compte *Pay As You Go* est souvent presente comme exemptant les
> ressources Always Free de ce mecanisme. Cette exemption n'est **pas documentee**
> par Oracle, et les retours de la communaute se contredisent : a traiter comme
> non confirme, jamais comme une garantie.
>
> A verifier sur la source, car ces valeurs ont deja change sans annonce :
> *Oracle Cloud Infrastructure Free Tier* — page « Always Free Resources »,
> rubrique **Reclamation of Idle Compute Instances** —
> <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>.
> Pour le passage de 4 OCPU / 24 Go a 2 OCPU / 12 Go le 15/06/2026, sans
> communique : <https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/>
> et <https://korben.info/oracle-cloud-always-free-arm-reduit.html>.

### Google Cloud — pourquoi ce palier ne convient pas ici

`e2-micro` dans `us-central1`, `us-west1` ou `us-east1` est gratuit en permanence
(1 vCPU partage, **1 Go de RAM**, 30 Go de disque). Ces trois regions sont les
seules : en deployer ailleurs est facture au tarif normal.

> **Ces 1 Go sont ceux de la MACHINE ENTIERE** — noyau, Docker, Caddy et l'API
> comprises. Or `docker-compose.prod.yml` demande a lui seul `mem_limit: 1g` pour
> l'API, avec un tas Node plafonne a 768 Mo. Il ne reste donc rien pour le reste,
> et le noyau tue le processus ; `restart: unless-stopped` le relance, et l'API
> alterne entre fonctionnement et mort — le genre de panne qui ne se diagnostique
> jamais, parce qu'elle se repare toute seule juste assez longtemps pour ne pas
> etre vue.
>
> Ce n'est pas un reglage a ajuster en baissant `--max-old-space-size` : c'est un
> plafond de memoire. Pour cette pile, prenez Oracle, ou un palier payant.

### Si vous n'avez pas de carte

Oracle ecrit « *most users* », pas « tous » : essayez d'abord, c'est dix minutes.
Si l'inscription est refusee, l'etat du marche en 2026 ne laisse que deux issues,
et il faut choisir en connaissance de cause.

**1. Une machine que vous possedez, plus Tailscale Funnel.** Aucune carte, aucun
port a ouvrir, aucune IP publique a demander. Funnel sort vers l'exterieur et
rend le service joignable en HTTPS sur un nom stable du type
`comexa.<votre-reseau>.ts.net`, certificat Let's Encrypt compris. Et comme il
fonctionne par connexions **sortantes**, le CGNAT de certains operateurs n'est
pas un obstacle — contrairement a un enregistrement DNS pointant vers une IP
publique, qui ne fonctionnerait pas du tout. Deux consequences sur ce depot :
**Caddy n'a plus de role**, Funnel terminant le TLS lui-meme ; et il faut
`TRUST_PROXY=1` pour que l'API sache qu'elle est derriere un proxy, sans quoi le
cookie `secure` sera refuse et aucune session ne survivra a un rechargement. Le
prix a payer est materiel — la machine doit rester allumee — et Funnel est encore
marque *beta*, avec une limite de bande passante non documentee.

**2. Render, palier gratuit.** Pas de carte : la documentation de Render l'ecrit
elle-meme. Trois consequences a connaitre avant de choisir cette voie :
- l'instance **s'endort apres 15 minutes** d'inactivite, et met de quelques
  dizaines de secondes a une minute a se reveiller (les deux mesures ont ete
  vues : ~15 s en mediane, jusqu'a une minute). Un appel toutes les 10 minutes la
  maintient eveillee, et les 750 heures par mois du palier suffisent a couvrir un
  mois continu de 744 heures — avec 6 heures de marge, donc sans place pour un
  second service gratuit dans le meme workspace ;
- **512 Mo de RAM et 0,1 vCPU** quand ce depot demande 1 Go et 1 vCPU : il faut
  baisser `--max-old-space-size` en consequence ;
- **le SMTP sortant est bloque** sur le palier gratuit — ports 25, 465 et 587 —
  depuis le 26/09/2025. Un relais SMTP sur le port 587 ne repondra donc pas, et
  l'envoi de courriel echouerait **silencieusement** : c'est la panne la plus dure
  a diagnostiquer de cette liste, parce que rien ne la signale. Le module de
  courriel sait l'eviter : renseigner le couple `MAILJET_API_KEY` +
  `MAILJET_SECRET_KEY` fait passer les envois par une API HTTP, sur le port 443,
  qui n'est jamais filtre (§9.1). C'est la raison d'etre de ce second transport.

Le deploiement complet sur Render — creation du service, variables
d'environnement, migrations et reveil periodique — est decrit a l'**annexe A**.

**Ce qui n'existe plus en 2026**, malgre ce qu'en disent encore beaucoup
d'articles : Koyeb a ete rachete par Mistral AI le 17/02/2026 et son palier
gratuit est ferme aux nouvelles inscriptions (le premier palier ouvert est a
~29 $/mois) ; Railway a supprime son credit gratuit en aout 2025 ; l'offre
gratuite de Fly.io a effectivement disparu. Toute comparaison qui les compte
encore a 0 $ est perimee.

---

## 4. Ouvrir les ports 80 et 443 — les DEUX couches

C'est ici que la plupart des deploiements Oracle echouent, parce qu'il y a
**deux pare-feu distincts**, et qu'ouvrir un seul ne suffit pas.

### Couche 1 — le reseau cloud (VCN)

**Networking → Virtual Cloud Networks → votre VCN → Security Lists → Default
Security List → Add Ingress Rules**, trois fois :

| Source CIDR | IP Protocol | Destination Port Range |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |
| `0.0.0.0/0` | UDP | `443` |

### Couche 2 — le pare-feu de l'instance

Les images Ubuntu d'Oracle embarquent des regles `iptables` qui **rejettent** le
trafic entrant et **ne sont pas visibles** depuis la console. Sans cette etape,
les ports restent fermes malgre la couche 1.

Reperez d'abord la position de la regle `REJECT`, puis inserez **avant** elle :

```bash
sudo iptables -L INPUT --line-numbers --numeric   # repere la ligne REJECT
```

En general elle est en position 6 sur ces images, d'ou :

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save      # sinon tout disparait au redemarrage
```

Verification, depuis **votre machine**, pas la VM :

```bash
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 5 http://<ip-publique>/
```

---

## 5. DNS

Creez un enregistrement **A** pointant vers l'IP publique :

```
api.exemple.tld   A   <ip-publique>
```

**A faire AVANT le premier demarrage de Caddy.** Caddy demande un certificat
Let's Encrypt pour ce nom exact, et Let's Encrypt verifie la reponse par un appel
sur le port 80. Si le nom ne resout pas encore, la demande echoue et le site
reste injoignable.

Verifiez la propagation avant de continuer :

```bash
dig +short api.exemple.tld      # doit renvoyer votre IP publique
```

---

## 6. Installer Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker        # ou se deconnecter / se reconnecter
docker run --rm hello-world
```

> **Sur le `curl | sudo sh`.** C'est la methode que Docker documente, et elle est
> acceptable ici : le script vient de `get.docker.com` en HTTPS, et vous etes sur
> une VM que vous venez de creer. Mais elle execute du code distant en root sans
> que personne ne l'ait lu. Si cela vous gene, la meme page propose le depot APT
> a installer a la main — c'est plus long, et strictement equivalent.

**Le client PostgreSQL n'est PAS installe par cette commande**, et il est
necessaire a la sauvegarde (§15) :

```bash
sudo apt-get update && sudo apt-get install -y postgresql-client
pg_dump --version
```

Sans lui, `pg_dump` echoue en `command not found` — le jour ou l'on en a besoin,
c'est-a-dire trop tard.

---

## 7. Recuperer le code

**Le depot est prive, donc un jeton est necessaire.** Un `git clone` en HTTPS sur
un depot prive demande des identifiants, et sur une machine sans navigateur il
n'y a rien pour les saisir : la commande echoue ou reste en attente.

Le plus simple est un **jeton d'acces personnel** en lecture seule sur ce depot
(GitHub : *Settings → Developer settings → Personal access tokens → Fine-grained*,
droits *Contents: Read*), puis :

```bash
git clone --branch feat/backend-comexa-api \
  https://<jeton>@github.com/beneweb55-source/Comexa-portfolio.git ~/comexa
cd ~/comexa/backend
```

Le jeton se retrouve alors dans `~/comexa/.git/config`, en clair, sur cette
machine. Il est en LECTURE SEULE et limite a ce depot : c'est ce qui rend le
compromis acceptable. Si la machine est partagee, une cle de deploiement SSH est
preferable — elle se retire cote GitHub en un clic.

> La branche. L'API vit sur `feat/backend-comexa-api`. Le jour ou elle est
> fusionnee dans `main`, remplacez le `--branch` ci-dessus — sinon cette machine
> continuera de suivre une branche qui ne bouge plus.

> **Sur Render, rien de tout ceci ne sert** : la connexion se fait par
> l'autorisation de la *GitHub App*, decrite en A.3.

---

## 8. Le bucket de fichiers (Backblaze B2)

1. **B2 Cloud Storage → Buckets → Create a Bucket**
   - Nom : `comexa-documents` (ou ce que vous voulez, il doit correspondre a
     `S3_BUCKET`)
   - **Files in Bucket are: Private** — jamais public : les fichiers sont servis
     par des URL signees a duree courte, pas par un lien permanent.
   - Notez la **region** (`us-west-004`, `eu-central-003`…).
2. **Application Keys → Add a New Application Key**
   - **Restreignez la cle a ce bucket.** Inutile de donner a l'application
     l'acces a tout le compte.
   - Droits : lecture, ecriture, suppression.
   - L'`applicationKey` **n'est affichee qu'une seule fois** : copiez-la tout de
     suite, elle ne sera pas recuperable.

> **Pourquoi une cle restreinte suffit, et c'est mesure.** `s3.driver.ts`
> n'appelle que `PutObject`, `DeleteObject`, `GetObject` (uniquement pour
> *signer* une URL — aucun appel reseau) et `HeadObject`. Il n'appelle **jamais**
> `ListBuckets` ni `ListObjects`, et ne cree jamais de bucket. Une cle limitee a
> un bucket couvre donc exactement le besoin, sans surplus de droits.

Variables correspondantes :

```bash
S3_ENDPOINT=https://s3.<region>.backblazeb2.com
S3_REGION=<region>                 # identique a celle du bucket, sinon "bucket not found"
S3_BUCKET=comexa-documents
S3_ACCESS_KEY_ID=<keyID>
S3_SECRET_ACCESS_KEY=<applicationKey>
S3_FORCE_PATH_STYLE=true
```

> **L'alternative Oracle Object Storage** offre 20 Go sur le meme compte que la
> VM. Deux pieges : l'`endpoint` porte le **namespace du locataire** (a lire sur
> la page du bucket, ce n'est **pas** votre identifiant de connexion), et il faut
> une **« Customer Secret Key »** — pas une cle d'API OCI. Confondre les deux
> produit une erreur de signature qui ne dit pas laquelle est en cause.
> `S3_ENDPOINT=https://<namespace>.compat.objectstorage.<region>.oraclecloud.com`

---

## 9. Le courriel (Mailjet)

Compte sur <https://www.mailjet.com/> — **6 000 courriels/mois et 200/jour**, sans
carte bancaire et sans verification par SMS, **aucun domaine requis** pour
commencer (il suffit de valider une adresse d'expedition).

> **Pourquoi le nom de Brevo a circule ici, et pourquoi il n'y est plus.** Brevo
> demande une verification par SMS a l'inscription ; elle n'a pas abouti. Le
> module de courriel avait justement ete ecrit pour rendre ce genre de
> substitution peu couteuse — un transport, une ligne de choix, deux variables —
> et ce remplacement a servi de premier essai reel a cette abstraction : aucun
> gabarit, aucune route, aucun test de bout en bout n'a bouge.

Mailjet expose **deux chemins d'envoi**, et le backend sait parler les deux. Le
choix n'est pas cosmetique : il decide si le courriel part ou non.

### 9.1 Par l'API HTTP — le chemin a preferer

**C'est le seul chemin qui fonctionne sur un hebergeur qui filtre le SMTP**, et
donc celui de l'annexe A (Render). Plusieurs plateformes bloquent en sortie les
ports `25`, `465` et `587` pour empecher le spam. Sur ces plateformes, un envoi
SMTP **n'echoue pas** : la connexion n'aboutit jamais, il n'y a aucune erreur
d'authentification, et le seul symptome est un courriel qui n'arrive pas. Le port
`443`, lui, n'est jamais filtre — c'est celui par lequel l'API repond.

1. **Account Settings → API Key Management.** Mailjet y affiche **deux** cles :
   une *API Key* (publique) et une *Secret Key*. Les deux sont necessaires : la
   premiere sert d'identifiant, la seconde de mot de passe, en HTTP Basic. **Il
   n'existe pas de forme condensee.**
2. Copiez-les. **Ce ne sont PAS les identifiants SMTP du meme ecran** : ceux-la
   servent a §9.2, et l'API les refuse avec un `401`.
3. Validez l'adresse d'expedition dans **Sender domains & addresses**. Mailjet
   envoie un courriel a cette boite ; il faut y cliquer le lien. Une adresse non
   validee fait refuser l'envoi.

```bash
MAILJET_API_KEY=<API Key>
MAILJET_SECRET_KEY=<Secret Key>
SMTP_FROM="Comexa <no-reply@exemple.tld>"
```

`SMTP_HOST` reste **vide** dans ce cas.

> **Le refus peut arriver sous un `200`, et c'est le piege de cette API.**
> Mailjet repond `200 OK` meme quand il rejette le message : le rejet vit dans le
> **corps** de la reponse, sous `Messages[].Status`, et le vrai code dans
> `Errors[].StatusCode`. Un transport qui se fierait au code HTTP annoncerait un
> succes sur un courriel que personne ne recevra — pire qu'un echec franc, puisque
> plus personne ne cherche la panne du cote de l'envoi. Le transport lit donc le
> corps, et va plus loin : **une reponse qu'il ne sait pas lire est traitee comme
> un echec, jamais comme un succes.** Le doute n'est pas un accord. C'est ce qui
> fait remonter un envoi refuse jusqu'a l'appelant au lieu de disparaitre.

> **Deux limites du palier gratuit ne produisent AUCUNE erreur.**
> - **200 courriels par jour.** Au-dela, les messages sont abandonnes en silence :
>   pas de `429`, pas de ligne dans les journaux.
> - **Le « Test Mode » d'un compte neuf : 10 courriels par heure.** Mailjet leve
>   cette limite apres une verification manuelle du compte — usage prevu, volume
>   envoye, origine de la liste, site web — demandee par courriel et traitee en
>   general en un jour ouvre. Un envoi qui part une fois puis s'arrete au bout de
>   dix est ce symptome-la, pas une regression.

> **Un domaine, a terme, n'est pas un luxe.** Sans domaine, la seule adresse
> validable est une adresse gratuite (`@gmail.com`, ...). Envoyer
> `From: vous@gmail.com` par un service d'envoi tiers **echoue au controle
> DMARC** que Gmail applique depuis fevrier 2024 : Mailjet accepte l'envoi, et le
> destinataire ne le voit jamais — le refus arrive plus tard, dans une boite qui
> n'est pas la votre, sous la forme d'un rebond `550 5.7.26`. Valider une adresse
> gratuite suffit donc pour **essayer**, et encore : sur votre propre boite. Pas
> pour facturer un client. Le jour ou le frontend est en ligne, lui rattacher un
> domaine et declarer ses enregistrements SPF et DKIM est la seule correction qui
> compte.

### 9.2 Par SMTP — pour une machine classique

Utile sur une VM (Oracle, ou une machine a vous), ou aucun filtrage en sortie
n'existe.

1. **Account Settings → API Key Management**, puis le tableau des identifiants
   SMTP : le serveur (chez Mailjet, `in-v3.mailjet.com`), le port `587`, et un
   couple identifiant / mot de passe **distinct** des deux cles d'API.

```bash
SMTP_HOST=in-v3.mailjet.com
SMTP_PORT=587
SMTP_USER=<identifiant SMTP>
SMTP_PASSWORD=<mot de passe SMTP>
SMTP_FROM="Comexa <no-reply@exemple.tld>"
```

`MAILJET_API_KEY` et `MAILJET_SECRET_KEY` restent **vides** dans ce cas.

### 9.3 Ce que fait le backend, dans tous les cas

> **Si les deux sont renseignes, l'API HTTP gagne** (voir
> `MailService.resolveTransport`). Ce n'est pas un detail d'implementation :
> choisir l'autre transport sur un hebergeur qui filtre le SMTP ferait echouer
> chaque envoi en silence. La presence des identifiants **est** le choix — il n'y
> a pas de variable a positionner.
>
> **Le serveur refuse de demarrer** en production si ni le couple
> `MAILJET_API_KEY` + `MAILJET_SECRET_KEY` ni `SMTP_HOST` n'est renseigne. Ce
> n'est pas une tracasserie : la route « mot de passe oublie » repond toujours
> `200`, meme sur une adresse inconnue, pour ne pas reveler quels comptes
> existent. Cette reponse n'est honnete que si le courriel part quand le compte
> existe. **Une seule des deux cles est un cas a part** : le refus nomme alors
> celle qui manque, parce qu'un « aucun moyen d'envoi » affiche devant une cle
> qu'on vient de coller envoie chercher la panne partout sauf dans la variable
> non remplie.
>
> **`ALLOW_BOOT_WITHOUT_MAIL=true` leve ce refus**, et c'est le seul moyen de
> deployer le backend avant d'avoir un compte chez un fournisseur. A retirer des
> que le transport est configure : dans cet etat, « mot de passe oublie » repond
> `200` sans rien expedier, chaque envoi manque est recopie dans les journaux sous
> une banniere, et `MailService` ecrit un avertissement au demarrage.
>
> **Le transport retenu est annonce au demarrage.** Cherchez la ligne `Courriel :`
> dans les journaux (`docker compose logs api` sur la VM, l'onglet *Logs* sur
> Render). Elle dit quel chemin est actif et avec quel expediteur : c'est la
> premiere chose a lire quand un courriel ne part pas.

---

## 10. Le fichier `.env.production`

A la racine du `backend/`, sur la VM. Il est **ignore par git**
(`.gitignore` ligne 50, `.env.*`).

```bash
cd ~/comexa/backend
cp .env.example .env.production
chmod 600 .env.production          # AVANT d'y ecrire quoi que ce soit
nano .env.production
```

> **Le `chmod 600` n'est pas cosmetique.** `cp` cree le fichier avec l'umask du
> shell — `0644` le plus souvent, donc **lisible par tous les comptes de la
> machine**. Ce fichier-ci porte la chaine Neon, les deux secrets JWT, la cle
> SMTP et la cle de stockage objet. A refaire si vous le recreez un jour
> (`cp` ne conserve pas les droits d'un `.env.production` qui existait deja si
> vous ecrasez par un autre chemin).

**Generez les secrets sur la machine**, jamais ailleurs :

```bash
openssl rand -base64 48      # JWT_ACCESS_SECRET
openssl rand -base64 48      # JWT_REFRESH_SECRET — DIFFERENT du precedent
```

Les deux secrets doivent **differ** : `env.validation.ts` refuse le demarrage
s'ils sont identiques, et chacun doit faire au moins 32 caracteres.

Les valeurs qui **changent** par rapport au fichier de developpement. Chacune est
declaree **une seule fois** dans `.env.example` : la section « Ce que
`.env.production` doit porter EN PLUS » **nomme la section a modifier**, elle ne
recopie aucune valeur (deux occurrences d'une meme cle, dans un fichier que
`dotenv` et `docker compose` ne lisent pas dans le meme ordre, donnent une valeur
de developpement qui gagne en silence). Ces declarations sont citees **par le nom
de leur section, jamais par un numero de ligne** : un numero devient faux au
premier paragraphe insere, et envoie alors vers une variable sans rapport.

Les variables a changer :

| Variable | Valeur en production | Pourquoi |
|---|---|---|
| `NODE_ENV` | `production` | Active `secure: true` sur le cookie, coupe Swagger |
| `API_DOMAIN` | `api.exemple.tld` | Le nom pour lequel Caddy obtient un certificat |
| `ACME_EMAIL` | votre adresse | Let's Encrypt y signale une expiration imminente |
| `CORS_ORIGIN` | `https://www.exemple.tld` | Le domaine reel du frontend — **jamais `*`** |
| `FRONTEND_URL` | `https://www.exemple.tld` | Cible des liens dans les courriels |
| `TRUST_PROXY` | `1` | Force par Compose ; sinon 429 pour tout le monde |
| `COOKIE_SAMESITE` | `lax` (meme domaine parent) ou `none` (**frontend heberge ailleurs**, ex. Vercel) | Sinon la session disparait au rechargement. `none` exige HTTPS **et** retire la barriere `SameSite` : `CORS_ORIGIN` doit alors ne contenir que vos domaines, jamais `*` |
| `STORAGE_DRIVER` | `s3` | `local` est **refuse au demarrage** en production |
| `S3_*` | voir §8 | |
| `MAILJET_API_KEY` + `MAILJET_SECRET_KEY` | voir §9.1 | **L'un des deux chemins est obligatoire.** A preferer : le port 443 n'est jamais filtre. **Les deux cles vont ensemble** — une seule donne un `401` a chaque envoi, et le demarrage est refuse |
| `SMTP_*` | voir §9.2 | **L'un des deux chemins est obligatoire.** A n'utiliser que si l'API HTTP est impossible |
| `ALLOW_BOOT_WITHOUT_MAIL` | `false` | Doit rester `false` en production. `true` leve le refus de demarrer sans transport : « mot de passe oublie » repond alors `200` sans rien envoyer |

Verifiez le fichier **avant** de demarrer. Les quatre commandes ci-dessous
repondent chacune a une erreur qui ne se manifeste pas au demarrage :

```bash
# 1. Les deux secrets JWT existent et DIFFERENT (le serveur refuse de demarrer
#    s'ils sont identiques, mais autant le voir avant).
grep -c "^JWT_ACCESS_SECRET=" .env.production     # doit valoir 1
grep -c "^JWT_REFRESH_SECRET=" .env.production    # doit valoir 1

# 2. Aucune valeur de developpement ne subsiste.
grep -n "localhost" .env.production               # ne doit RIEN renvoyer

# 3. AUCUNE CLE DUPLIQUEE. C'est la verification qui manquait : une variable
#    presente deux fois n'a pas de comportement defini (dotenv retient la
#    premiere, docker compose la derniere).
awk -F= '/^[A-Z_][A-Z0-9_]*=/ {print $1}' .env.production | sort | uniq -d
#    ne doit RIEN renvoyer

# 4. Les trois bascules qui ne sont pas des preferences.
grep -n "^NODE_ENV=production"  .env.production   # doit renvoyer une ligne
grep -n "^STORAGE_DRIVER=s3"    .env.production   # doit renvoyer une ligne
grep -n "^TRUST_PROXY=1"        .env.production   # doit renvoyer une ligne

# 5. UN moyen d'envoi de courriel, et UN SEUL. `grep -c` compte les lignes NON
#    VIDES. Trois compteurs, dont la lecture est plus fine qu'une somme :
#      - les deux cles Mailjet valent SOIT 1 et 1, SOIT 0 et 0. Un 1 et un 0 est
#        le pire des cas : Mailjet authentifie en HTTP Basic, et une cle seule
#        donne un 401 a chaque envoi. Le serveur refuse d'ailleurs de demarrer
#        dans cet etat, en nommant la manquante ;
#      - si le couple est vide (0 et 0), SMTP_HOST doit valoir 1.
grep -c "^MAILJET_API_KEY=..*"    .env.production
grep -c "^MAILJET_SECRET_KEY=..*" .env.production
grep -c "^SMTP_HOST=..*"          .env.production

# 6. La derogation de courriel doit etre FERMEE. `true` ici est legal, mais
#    signifie que « mot de passe oublie » repond 200 sans rien envoyer.
grep -n "^ALLOW_BOOT_WITHOUT_MAIL=true" .env.production   # ne doit RIEN renvoyer
```

---

## 11. Demarrer

```bash
cd ~/comexa/backend

# 1. Les migrations d'abord — geste delibere, jamais un effet de bord.
docker compose --env-file .env.production -f docker-compose.prod.yml \
  --profile tools run --rm migrate

# 2. Puis la pile.
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

# 3. L'etat.
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api
```

Le `--env-file` n'est pas facultatif : sans lui, Compose interpolerait les
`${API_DOMAIN}` depuis `backend/.env` — le fichier de developpement, qui porte
la vraie chaine Neon.

---

## 12. Verifier

```bash
# Depuis n'importe ou : la sonde interroge reellement la base.
curl -sS https://api.exemple.tld/api/health
# attendu : {"success":true,"data":{"status":"ok","database":"up",...}}

# Le certificat est valide et non auto-signe.
curl -sSI https://api.exemple.tld/api/health | head -1

# Une route protegee refuse bien sans jeton (et non 500).
curl -sS -o /dev/null -w '%{http_code}\n' https://api.exemple.tld/api/projects
# attendu : 401

# Le stockage repond : le journal de demarrage le dit.
docker compose --env-file .env.production -f docker-compose.prod.yml \
  logs api | grep "Stockage objet"
```

---

## 13. Premier administrateur

Si la base contient deja les comptes, rien a faire. Sinon :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  --profile tools run --rm \
  -e SEED_ALLOW_PRODUCTION=yes \
  -e SEED_ADMIN_EMAIL=vous@exemple.tld \
  -e SEED_ADMIN_PASSWORD='<mot de passe initial, 12 caracteres minimum>' \
  -e SEED_DEMO_PASSWORD='<mot de passe des comptes de demonstration>' \
  seed
```

**Les quatre `-e` sont a renseigner, aucun n'est facultatif.** Le detail :

- `SEED_ALLOW_PRODUCTION=yes` — le seed refuse de tourner en production sans ce
  drapeau (`prisma/seed.ts:1290`). Il n'est **volontairement pas** dans
  `docker-compose.prod.yml` : l'y laisser faisait de ce refus une formalite.
- `SEED_ADMIN_PASSWORD` et `SEED_DEMO_PASSWORD` — si vous les omettez, le seed en
  **genere** et les **affiche** (`prisma/seed.ts:1557` et `:1570`). Ils se
  retrouvent alors en clair dans les journaux du conteneur, conserves sur le
  disque de la VM. Les fournir ici ne laisse rien derriere.
- `SEED_ADMIN_EMAIL` — **la valeur par defaut n'est pas celle des captures
  d'ecran** : sans cette variable, l'administrateur est cree sous
  `admin@comexa.example` (`prisma/seed.ts:1306`). Une version anterieure de ce
  runbook annoncait `admin@comexa.com` : suivie a la lettre, elle donnait un
  `401` au premier appel.

> Le seed **ne reecrit pas** le mot de passe d'un compte existant (voir
> `upsertAccount` dans `prisma/seed.ts`) : le relancer ne remet rien a zero et ne
> casse aucun acces en cours.
>
> **Mais attention a `SEED_ADMIN_EMAIL` sur une base deja peuplee.** Le seed
> reconnait un compte par son ADRESSE : si un administrateur existe deja sous un
> autre nom, en passer un ici n'en remplace aucun — vous en creez un SECOND, avec
> les memes droits. Pour connaitre les comptes existants, utilisez `psql` (§15)
> ou l'interface d'administration. N'essayez pas de le deduire d'une connexion a
> l'aveugle : un `401` ne distingue pas « compte absent » de « mot de passe
> different », et chaque tentative fait monter le compteur de verrouillage.

Ensuite, **premier appel authentifie a faire** : le changement de mot de passe.

> **Le `-c` ecrit dans `/tmp`, jamais dans le depot.** Ce n'est pas un detail de
> rangement : ce fichier contient le cookie de rafraichissement, donc un jeton
> valable jusqu'a 30 jours sur le compte **administrateur**. Dans l'arbre de
> travail, il ne fallait qu'un `git add -A` distrait. La visibilite du depot ne
> protege de rien : il est prive aujourd'hui, mais un depot s'ouvre en un clic,
> s'archive, se duplique, et un commit reste dans l'historique meme si le
> fichier est supprime ensuite. `/tmp` est efface au redemarrage, et
> `cookies.txt` est de toute facon desormais ignore par git (`.gitignore`).

```bash
COOKIES=/tmp/comexa-admin-cookies.txt
read -rp 'Adresse de l administrateur : ' ADMIN_EMAIL
read -rsp 'Mot de passe initial : ' ADMIN_PASSWORD; echo

curl -sS -X POST https://api.exemple.tld/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "$(printf '{"email":"%s","password":"%s"}' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")" \
  -c "$COOKIES"
```

Puis, avec le meme `$COOKIES` :

```bash
read -rsp 'Nouveau mot de passe : ' NEW_PASSWORD; echo

curl -sS -X POST https://api.exemple.tld/api/auth/change-password \
  -H 'Content-Type: application/json' -b "$COOKIES" \
  -d "$(printf '{"currentPassword":"%s","newPassword":"%s","confirmPassword":"%s"}' \
        "$ADMIN_PASSWORD" "$NEW_PASSWORD" "$NEW_PASSWORD")"

rm -f "$COOKIES"     # le jeton a rempli son role : ne le laissons pas trainer
```

> **Tant que ce n'est pas fait, tout repond `403 PASSWORD_CHANGE_REQUIRED`.**
> Ce n'est pas une panne : un compte cree par un administrateur a un mot de passe
> que quelqu'un d'autre connait, donc le serveur ferme tout sauf
> `/auth/change-password`, `/auth/me`, `/auth/logout` et `/auth/refresh`. Le
> refus vient du **serveur**, pas d'un bouton cache cote frontend.

Le nouveau mot de passe doit faire **12 caracteres minimum**, avec minuscule,
majuscule et chiffre, sans contenir votre adresse e-mail.

---

## 14. Mettre a jour

```bash
cd ~/comexa && git pull
cd backend
docker compose --env-file .env.production -f docker-compose.prod.yml \
  --profile tools run --rm migrate          # si de nouvelles migrations
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Le volume `comexa_caddy_data` conserve les certificats : pas de nouvelle demande
a Let's Encrypt a chaque redeploiement.

### Mettre a jour Caddy — un geste, pas un effet de bord

La version de Caddy est **epinglee** dans `docker-compose.prod.yml`
(`caddy:2.11.4-alpine`). C'est delibere : un tag flottant ferait changer le serveur
web qui termine votre TLS au premier `pull`, sur une machine que personne
n'administre au quotidien, sans qu'aucune ligne du depot n'ait bouge. Caddy fait
evoluer sa syntaxe entre versions mineures, et une configuration qui ne se charge
plus ne degrade pas le service — elle le rend injoignable.

Pour monter de version, donc :

```bash
cd ~/comexa/backend
# 1. Relire la note de version avant de toucher au tag :
#    https://github.com/caddyserver/caddy/releases
# 2. Changer le tag dans docker-compose.prod.yml, puis :
docker compose --env-file .env.production -f docker-compose.prod.yml pull caddy
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail 30 caddy
# attendu : aucune erreur de configuration, et le certificat toujours servi
curl -sSI https://api.exemple.tld/api/health | head -1
```

Le retour arriere est un `git checkout` du tag precedent suivi du meme `up -d` :
les certificats vivent dans le volume, pas dans l'image.

---

## 15. Sauvegardes

La base vit chez **Neon**, donc hors de cette machine : la perte de la VM ne perd
pas les donnees. Ce paragraphe couvre ce que Neon ne couvre pas — une suppression
accidentelle, une migration destructrice, un `DELETE` sans `WHERE`.

### Le client PostgreSQL

`postgresql-client` est installe en §6. S'il ne l'est pas, `pg_dump` echoue en
`command not found`, c'est-a-dire au pire moment.

### Prendre la sauvegarde

```bash
# 1. Le dossier. HORS de ~/comexa, qui est l'arbre de travail du depot.
mkdir -p ~/backups/comexa && chmod 700 ~/backups/comexa

# 2. Le mot de passe : jamais dans la ligne de commande, jamais dans l'historique.
#    `read -s` n'affiche rien a l'ecran ; `export` le passe par l'environnement,
#    que `ps aux` ne montre PAS.
read -rsp 'Mot de passe de la base (DIRECT_URL) : ' PGPASSWORD; echo
export PGPASSWORD

# 3. La sauvegarde, via la connexion DIRECTE (pas la poolie).
#    L'URL ci-dessous ne porte PAS le mot de passe : libpq le prend dans
#    PGPASSWORD. Collez l'utilisateur et l'hote DIRECTS — sans `-pooler`.
pg_dump \
  'postgresql://<utilisateur>@<hote-direct>/<base>?sslmode=require' \
  --format=custom \
  --file="$HOME/backups/comexa/comexa-$(date +%F).dump"

chmod 600 "$HOME/backups/comexa/"*.dump
unset PGPASSWORD
```

> **DEUX CHOSES QUE CETTE COMMANDE NE DOIT PAS FAIRE, ET QU'ELLE FAISAIT.**
>
> 1. **Ecrire dans `~/comexa`.** La version precedente produisait
>    `comexa-<date>.dump` dans l'arbre du depot. Un `git add -A` suivi d'un
>    `push`, deux gestes banals, publiaient alors une sauvegarde logique COMPLETE
>    de la production : empreintes argon2 des mots de passe, clients, devis,
>    factures, paiements. Que le depot soit prive n'y change rien — un commit
>    reste dans l'historique, et l'historique se clone. Le fichier est desormais
>    dans `~/backups`, et `*.dump` a ete ajoute a `.gitignore` comme seconde
>    barriere.
> 2. **Mettre le mot de passe dans `argv`.** L'ancienne forme,
>    `pg_dump "$DIRECT_URL"`, placait la chaine Neon entiere — mot de passe
>    compris — dans la table des processus, lisible par tout compte de la machine
>    avec un simple `ps aux`, le temps du dump.

### Verifier la sauvegarde

Un dump au format `custom` ne se lit pas comme du texte, mais on peut en
**lister le sommaire** sans rien restaurer :

```bash
pg_restore --list "$HOME/backups/comexa/comexa-$(date +%F).dump" | head -30
```

Faites-le le jour ou vous creez le dump, pas le jour du sinistre.

### Rapatrier et tester

Rapatriez le fichier ailleurs que sur la VM — une sauvegarde qui vit sur la
machine sauvegardee ne protege de rien, et `~/backups` est sur le meme disque
unique :

```bash
# depuis VOTRE machine
scp ubuntu@<ip-publique>:~/backups/comexa/comexa-$(date +%F).dump .
```

Puis **restaurez-la au moins une fois**, sur une base jetable — jamais sur celle
de production. Une sauvegarde jamais restauree n'est pas une sauvegarde, c'est
une hypothese. La restauration se fait avec `pg_restore`, vers une base **vide**
et distincte :

```bash
read -rsp 'Mot de passe de la base JETABLE : ' PGPASSWORD; echo
export PGPASSWORD

pg_restore \
  --dbname='postgresql://<utilisateur>@<hote-jetable>/<base-jetable>?sslmode=require' \
  --clean --if-exists --no-owner \
  "$HOME/backups/comexa/comexa-$(date +%F).dump"

unset PGPASSWORD
```

> **`--clean --if-exists` n'est pas anodin.** Ces deux options SUPPRIMENT les
> objets existants avant de les recreer. Sur la base de production, elles
> detruisent ce qu'elles remplacent — c'est-a-dire exactement l'accident contre
> lequel on sauvegarde. D'ou l'URL distincte ci-dessus : la cible doit etre une
> base jetable, et le `--dbname` doit se lire avant d'appuyer sur Entree.

> **Ce que Neon couvre deja, et pourquoi ce paragraphe existe quand meme.** Neon
> conserve un historique de restauration a point dans le temps, ce qui repond a
> « j'ai supprime une table il y a vingt minutes ». Ce paragraphe repond a
> l'autre cas : projet supprime, compte perdu, fournisseur qui change de
> conditions. Un dump que vous detenez est le seul actif qui ne depend d'aucun
> tiers.

---

## 16. Pannes courantes

| Symptome | Cause | Correction |
|---|---|---|
| `502` de Caddy | L'API n'ecoute pas | `... logs api` — souvent une variable d'environnement manquante |
| Certificat non delivre | DNS pas propage, ou port 80 ferme | `dig +short api.exemple.tld`, puis §4 |
| `STORAGE_DRIVER=local est refuse en production` | `.env.production` non charge | Le `--env-file` a ete oublie |
| Le serveur refuse de demarrer, aucun moyen d'envoi cite | C'est **voulu** | Renseigner §9 — le couple `MAILJET_API_KEY` + `MAILJET_SECRET_KEY` **ou** `SMTP_HOST` |
| Le serveur refuse de demarrer en nommant `MAILJET_SECRET_KEY` (ou `MAILJET_API_KEY`) | Une seule des deux cles est renseignee | Coller **les deux** : Mailjet authentifie en HTTP Basic, et une cle seule donne un `401` a chaque envoi |
| Le serveur demarre, aucun courriel n'arrive, aucune erreur | L'hebergeur filtre le SMTP en sortie : la connexion n'aboutit jamais | Passer au couple `MAILJET_*` (§9.1) et laisser `SMTP_HOST` vide |
| Mailjet accepte l'envoi, et le courriel n'arrive pas | Plafond gratuit atteint — 200/jour, ou 10/heure tant que le compte est en « Test Mode ». **Ces deux limites ne produisent aucune erreur** | §9.1 — attendre, ou faire verifier le compte par Mailjet |
| `400` de l'API Mailjet citant l'expediteur | L'adresse de `SMTP_FROM` n'est pas validee chez Mailjet | §9.1, etape 3 — cliquer le lien envoye a cette boite |
| `401` de l'API Mailjet | Les identifiants SMTP ont ete colles a la place des deux cles d'API | §9.1, etape 1 — « Account Settings → API Key Management » |
| `429` pour tout le monde | Le limiteur compte sous l'adresse du proxy | `TRUST_PROXY=1` (deja force par Compose) |
| Connecte, puis deconnecte au rechargement | Cookie refuse par le navigateur | `COOKIE_SAMESITE` correct, et HTTPS reellement actif |
| `403 PASSWORD_CHANGE_REQUIRED` | Premier mot de passe jamais change | §13 |
| Le disque se remplit | Journaux de conteneur | Deja borne a 30 Mo/service ; verifier `docker system df` |
| `pg_dump: command not found` | Client PostgreSQL absent de la VM | §6 — `apt-get install postgresql-client` |
| Le frontend est bloque, mais le serveur demarre sans rien signaler | `CORS_ORIGIN` reste sur `http://localhost:3000` | §10 — verifier les cles dupliquees (`uniq -d`) |
| Le `seed` refuse de tourner malgre la commande du runbook | `SEED_ALLOW_PRODUCTION` n'est plus pose par Compose | §13 — le passer a l'appel, avec les deux mots de passe |
| `401` au premier appel authentifie | L'administrateur n'est pas sous l'adresse attendue | §13 — l'adresse par defaut est `admin@comexa.example`, ou celle de `SEED_ADMIN_EMAIL` |
| Caddy sort sur `permission denied` en liant `:80` ou `:443` | `cap_drop: ALL` sans `cap_add: NET_BIND_SERVICE` | Les deux sont declares cote a cote pour `caddy` dans `docker-compose.prod.yml`. Si l'erreur persiste, retirer ces deux lignes pour revenir aux capacites par defaut de Docker |
| Un client ne parvient pas a utiliser HTTP/3 | Le port `443/udp` n'est pas publie, et c'est **voulu** | Voir le commentaire des `ports` : HTTP/3 demande `NET_ADMIN`. Les clients se replient seuls en HTTP/2 |
| `pull` ne change pas la version de Caddy | Le tag est epingle | Voulu — §14, « Mettre a jour Caddy » |

---

## 17. Ce que ce document ne couvre pas

- **Le frontend.** Perimetre distinct, heberge separement. Caddy n'a qu'un bloc ;
  un second suffira le jour ou il rejoint cette machine.
- **Le renouvellement du domaine** et les enregistrements SPF/DKIM. Un service
  d'envoi fournit ceux de son propre domaine ; y ajouter le votre ameliore la
  delivrabilite et se configure chez votre registraire, pas ici. **Sans domaine,
  c'est la ligne qui manque** : l'encadre DMARC du §9.1 explique pourquoi une
  adresse gratuite validee permet d'essayer, pas de facturer.
- **Le durcissement de la VM** (fail2ban, mises a jour automatiques, cle SSH
  renommee, desactivation de l'authentification par mot de passe). Recommande,
  hors du perimetre de ce runbook.

---

## Annexe A. Deployer sur Render (sans VM)

Second chemin de deploiement, pour le cas ou aucune VM n'est disponible. Il ne
remplace pas les sections 1 a 17 : Neon, Mailjet et Backblaze B2 s'y configurent
exactement de la meme facon. **Seul l'hebergement change.**

> **A lire avant de choisir.** Le §1 explique pourquoi une VM a ete retenue : le
> palier gratuit de Render endort un service inactif, et `InvoiceOverdueService`
> porte un `@Cron` horaire qui ne part alors *jamais*. Cette annexe ne fait pas
> disparaitre cette contrainte — elle l'encadre par un reveil periodique (A.6),
> qui est la piece sans laquelle le reste ne sert a rien. **Si vous pouvez
> obtenir une VM, la VM reste le meilleur choix.**

### A.1 Ce que Render fait a votre place

| Ce que la VM faisait | Ce qui le remplace |
|---|---|
| Caddy + certificat Let's Encrypt | Render termine le TLS lui-meme |
| `systemd` + `docker compose up -d` | Render construit l'image et redemarre le conteneur |
| `docker compose logs -f` | L'onglet *Logs* du tableau de bord |
| Le disque de la VM | **Rien** — il est efface a chaque redeploiement |

La derniere ligne est la seule qui oblige a changer un reglage : voir A.4.

### A.2 Les trois limites du palier gratuit, et ce qu'elles imposent

Mesures du 29/09/2026, conservees ici pour la meme raison qu'au §1.

1. **15 minutes sans trafic entrant endorment le service**, qui met de quelques
   dizaines de secondes a une minute a repartir. Consequence directe : sans
   reveil periodique, le `@Cron` horaire de `InvoiceOverdueService` ne s'execute
   jamais, et la relance des factures en retard est silencieusement morte. Voir
   A.6.
2. **750 heures-instance par mois et par workspace.** Un mois de 31 jours en
   compte 744 : un service maintenu eveille en permanence y tient, avec
   **6 heures de marge**. Pas de quoi ajouter un second service gratuit au meme
   workspace.
3. **Les ports SMTP 25, 465 et 587 sont bloques en sortie.** C'est ce qui a
   motive le transport par API HTTP de Mailjet (le couple `MAILJET_API_KEY` +
   `MAILJET_SECRET_KEY`, port 443) decrit au §9.1. Sur Render, renseigner
   `SMTP_HOST` ne produit pas une erreur d'authentification mais une connexion
   qui n'aboutit jamais.

Les WebSockets, eux, ne posent pas de probleme : les messages echanges sur une
connexion ouverte comptent comme du trafic entrant et maintiennent le service
eveille. Le chat temps reel fonctionne donc — et allonge meme la periode
d'eveil.

### A.3 Creer le service

1. **New + → Web Service**, puis *Build and deploy from a Git repository*.
   Indiquer le depot `beneweb55-source/Comexa-portfolio`.

   > **Le depot est prive, et cela se paie une fois.** Render ne peut pas lire un
   > depot prive sans y etre autorise : a la premiere connexion, il demande
   > l'installation de son *GitHub App*. L'accorder, puis **verifier qu'elle
   > porte bien sur ce depot** — GitHub propose *All repositories* ou une
   > selection, et une selection qui omet `Comexa-portfolio` produit un
   > deploiement qui echoue a la recuperation du code, avec un message qui ne
   > dit pas qu'il s'agit d'un probleme de droits. Sans cette autorisation, il
   > n'y a rien a construire.

2. Renseigner les champs ainsi :

| Champ | Valeur | Pourquoi |
|---|---|---|
| Language | **Docker** | Le `Dockerfile` du depot est deja ecrit et teste ; laisser Render installer Node l'obligerait a deviner l'etape `prisma generate` |
| Branch | `main` apres fusion, sinon la branche de travail | |
| Root Directory | `backend` | Le depot est un monorepo : la racine est `Comexa Portfolio`, l'API vit dans `backend/` |
| Dockerfile Path | `./Dockerfile` | Chemin **relatif au Root Directory**, donc `backend/Dockerfile` |
| Instance Type | **Free** | |
| Health Check Path | `/api/health` | Route reelle, qui interroge la base — le `/api` vient de `API_PREFIX` |
| Auto-Deploy | **Yes** | Redeploie a chaque `git push` sur la branche surveillee |

> Laisser `Docker Build Context` vide. Le contexte par defaut est le Root
> Directory, c'est-a-dire `backend/`, et le `Dockerfile` fait bien
> `COPY package.json`, `COPY prisma` et `COPY src` depuis cette racine.

3. **Ne pas demarrer le service tout de suite.** A.4 demande les variables
   d'environnement, et un demarrage sans elles echoue.

### A.4 Les variables d'environnement

A saisir dans *Environment → Environment Variables*. `backend/.env.example`
documente chaque variable ; ce tableau ne retient que celles qui changent ou qui
sont obligatoires.

**Obligatoires**

| Variable | Valeur | Note |
|---|---|---|
| `NODE_ENV` | `production` | Active les controles de demarrage (`assertMailConfigured`, refus du stockage local) et supprime les traces de pile des reponses |
| `DATABASE_URL` | URL Neon **pooli** (hote `-pooler`) | Celle que l'application utilise |
| `DIRECT_URL` | URL Neon **directe** | Lue en premier par la CLI Prisma ; necessaire si vous lancez une migration depuis l'onglet *Shell* de Render |
| `JWT_ACCESS_SECRET` | chaine aleatoire longue | **Doit differer** de `JWT_REFRESH_SECRET`, sinon le demarrage est refuse (`assertSecretsDiffer`) |
| `JWT_REFRESH_SECRET` | autre chaine aleatoire longue | Voir ci-dessus |
| `MAILJET_API_KEY` + `MAILJET_SECRET_KEY` | *API Key* et *Secret Key* (Account Settings → API Key Management) | §9.1. **Les deux, jamais une seule** : une cle seule donne un `401` a chaque envoi. Laisser `SMTP_HOST` **vide** |
| `ALLOW_BOOT_WITHOUT_MAIL` | `false` | Doit rester `false`. `true` fait demarrer le serveur sans transport : « mot de passe oublie » repond alors `200` sans rien envoyer |
| `STORAGE_DRIVER` | `s3` | Le disque est ephemere : `local` est refuse au demarrage |

Pour engendrer les deux secrets, plutot que de les inventer a la main :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**Stockage — Backblaze B2** (meme compte qu'au §3)

| Variable | Valeur |
|---|---|
| `S3_REGION` | la region du compte, telle qu'affichee en console (ex. `us-west-004`) |
| `S3_BUCKET` | le nom du bucket |
| `S3_ENDPOINT` | `https://s3.<S3_REGION>.backblazeb2.com` |
| `S3_ACCESS_KEY_ID` | *keyID* de la cle d'application B2 |
| `S3_SECRET_ACCESS_KEY` | *applicationKey* associee |
| `S3_FORCE_PATH_STYLE` | `true` |

Deux pieges sur ce bloc. `S3_ENDPOINT` doit inclure le schema : le SDK le prend
tel quel. Et **`S3_FORCE_PATH_STYLE` reste a `true`** — Backblaze n'accepte pas
l'adressage par sous-domaine que le SDK emploierait sinon. C'est deja le defaut
du code, mais l'ecrire evite qu'un futur changement de defaut ne casse ce
deploiement sans prevenir.

Employer une **cle d'application** B2, jamais la cle maitre : elle peut etre
limitee a ce seul bucket.

**Selon votre situation**

| Variable | Valeur | Note |
|---|---|---|
| `COOKIE_SAMESITE` | `none` | **Obligatoire si le frontend est sur Vercel.** Un site different est un site tiers : un cookie `lax` n'y est jamais envoye, et la connexion semble echouer sans message |
| `CORS_ORIGIN` | l'URL Vercel de production, exacte et sans slash final (ex. `https://comexa.vercel.app`) | Mettre l'URL de **production**, pas une URL de previsualisation |
| `FRONTEND_URL` | la meme URL | Sert a construire les liens profonds des courriels (§9.3) |
| `TRUST_PROXY` | `1` | Render place **un** proxy devant le conteneur. Sans ce reglage, tous les visiteurs partagent l'adresse du proxy : le limiteur de debit les compte comme un seul client, et le premier venu epuise la limite pour tout le monde |
| `PORT` | ne pas la definir | Render l'injecte, et `main.ts` la lit deja |

> `COOKIE_SAMESITE=none` exige un cookie `Secure`, ce que la production fait
> deja. En revanche, `none` avec un frontend servi en `http://` ne fonctionne
> pas : la combinaison ne devient testable qu'une fois le frontend en HTTPS.

### A.5 Appliquer les migrations depuis votre machine

Les migrations ne sont **pas** jouees par le conteneur au demarrage, et c'est
volontaire : un demarrage qui applique un DDL sur la base de production rendrait
le retour arriere dependant d'un redemarrage.

Depuis `backend/`, avec le `.env` local qui porte `DIRECT_URL` :

```bash
npm run prisma:deploy    # = prisma migrate deploy
npm run prisma:status    # = prisma migrate status, pour verifier
```

A faire **avant** le premier demarrage, puis apres chaque fusion qui ajoute une
migration. L'URL directe est celle qui convient : l'hote pooli gere mal le DDL.

> Ne jamais lancer `npm run db:reset` (`prisma migrate reset --force`) contre la
> base Neon : cette commande **efface** les donnees avant de rejouer les
> migrations. Elle ne vise que la base locale.

### A.6 Le reveil periodique — obligatoire, pas optionnel

C'est la piece qui rend cette voie praticable, et la seule a ne pas oublier.

Le palier gratuit endort le service apres 15 minutes sans trafic entrant. Or
`InvoiceOverdueService` porte un `@Cron(CronExpression.EVERY_HOUR)` : endormi,
il ne part pas du tout. Pas d'erreur, pas de trace, des factures en retard qui
ne sont jamais relancees.

Il faut donc un **appel sortant regulier** vers `/api/health`, **toutes les 10
minutes**, depuis un service qui ne dort pas. Un planificateur externe gratuit
convient : `cron-job.org`, UptimeRobot, ou tout autre.

```
URL        https://<votre-service>.onrender.com/api/health
Methode    GET
Frequence  toutes les 10 minutes
```

Deux remarques.

- **10 minutes, pas 14.** La marge n'est pas un exces de prudence : un
  planificateur gratuit peut lui-meme accuser du retard, et le compteur des 15
  minutes ne repart pas de zero apres un echec isole.
- **Ne pas utiliser un *Cron Job* Render pour cela.** Les services d'un meme
  workspace partagent les 750 heures-instance (A.2), et ce planificateur en
  consommerait aussi. Un reveil externe ne coute rien.

Le reveil rend le `@Cron` possible ; il ne le rend pas ponctuel. Un `@Cron`
horaire s'execute « environ » toutes les heures, avec le retard du reveil — sans
consequence ici, la relance des factures en retard n'ayant pas a se faire a la
minute pres.

### A.7 Verifier que le deploiement a reussi

Dans l'ordre ; chaque etape repond a une question differente.

1. **Le deploiement est passe au vert.** Sinon, ouvrir les journaux de *build* :
   le `Dockerfile` engendre le client Prisma pendant la construction, et une
   erreur TypeScript n'apparait qu'ici.
2. **`GET https://<service>.onrender.com/api/health` repond `200`.** Render
   attend cette route avant de declarer le service en bonne sante ; des echecs
   repetes finissent par annuler le deploiement.
3. **Les journaux de demarrage annoncent les bons services.** Chercher, dans
   l'onglet *Logs* :
   - une ligne `Courriel : API HTTP Mailjet, expediteur ...`. Si elle dit `SMTP`,
     c'est que `SMTP_HOST` a ete renseigne alors qu'il ne faut pas (A.2,
     limite 3) ;
   - une ligne de stockage annoncant le pilote S3, et non « stockage local ».
4. **Le mot de passe oublie arrive vraiment.** C'est le seul essai qui exerce le
   chemin complet — Mailjet, l'adresse d'expedition validee, le lien profond
   construit depuis `FRONTEND_URL`. Le declencher depuis le frontend, pas avec
   `curl` : c'est le parcours reel qu'on veut valider.

   > **Ce que ce test ne prouve pas.** Sur le palier gratuit, Mailjet plafonne a
   > 200 courriels par jour et, tant que le compte n'est pas verifie
   > manuellement, a 10 par heure — **sans renvoyer la moindre erreur au-dela**.
   > Un envoi qui reussit une fois puis cesse de partir sans rien dire est ce
   > symptome-la, pas une regression (§9.1).
   >
   > Et si l'adresse de `SMTP_FROM` est une adresse gratuite plutot qu'une
   > adresse de votre domaine, le message partira de Mailjet et sera refuse par
   > le destinataire (DMARC, §9.1). Verifier depuis une **autre** boite que la
   > votre : c'est la seule facon de voir cette difference.

### A.8 Ce que cette voie ne permet pas

- **Aucun disque persistant.** C'est la raison du `STORAGE_DRIVER=s3` ; un
  retour a `local` ferait disparaitre les fichiers au premier redeploiement,
  alors que leurs lignes resteraient en base.
- **Une seule instance.** Le limiteur de debit et le verrouillage de compte
  tiennent leur etat en memoire vive : deux instances, et chaque limite est
  reellement doublee. Le palier gratuit n'en offre qu'une, ce qui rend la chose
  sans objet — mais l'interdit le jour ou vous voudriez monter en puissance
  sans deplacer cet etat.
- **Un premier appel lent.** Apres un endormissement, la premiere requete attend
  le redemarrage, de quelques dizaines de secondes a une minute (A.2). Le reveil
  de A.6 supprime ce cas de figure en pratique — a condition de ne pas le
  desactiver.
