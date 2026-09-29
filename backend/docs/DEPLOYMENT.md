# Deploiement — Comexa backend

Runbook pour mettre l'API en production sur **une VM unique, toujours allumee**.

Chaque affirmation de ce document a ete mesuree (version de Node, `docker compose
config`, sortie reelle des commandes citees), pas recopiee d'un tutoriel.

---

## 1. L'architecture retenue, et pourquoi

| Brique | Choix | Role |
|---|---|---|
| Machine | VM Ubuntu 24.04, 1 vCPU / 2 Go minimum | Fait tourner deux conteneurs |
| Base de donnees | **Neon** (deja en place) | Hors de la machine : survit a sa perte |
| Fichiers | **Backblaze B2** (S3-compatible, 10 Go gratuits, sans carte) | Les binaires ne vont jamais en base |
| TLS | **Caddy** | Certificat Let's Encrypt automatique |
| Courriel | **Brevo** (300/jour gratuits, sans domaine) | Reinitialisation de mot de passe |

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
- [ ] Un **compte Brevo** — 300 courriels/jour gratuits, aucun domaine requis
      (verification d'un simple expediteur).
- [ ] La **chaine de connexion Neon**, en deux exemplaires : l'hote *pooli*
      (`-pooler`) et l'hote *direct*.
- [ ] Environ **45 minutes**.

> **Point d'honnetete sur la carte bancaire.** Tous les hebergeurs de VM
> gratuites — Oracle Cloud *Always Free* comme le `e2-micro` de Google Cloud —
> **demandent une carte a l'inscription**, pour verifier l'identite. Elle n'est
> pas debitee tant que vous restez dans les limites du palier gratuit, mais elle
> est exigee a l'entree. Backblaze, lui, ne la demande pas : c'est pourquoi le
> stockage est chez eux et non chez Cloudflare R2, qui l'exige.

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
   Sud) et `eu-paris-1`. Une carte bancaire est exigee a l'inscription, meme pour
   le palier gratuit — et les cartes a debit immediat, prepayees, virtuelles ou a
   usage unique sont refusees.
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

Le depot est public : aucun jeton n'est necessaire.

```bash
git clone --branch feat/backend-comexa-api \
  https://github.com/beneweb55-source/Comexa-portfolio.git ~/comexa
cd ~/comexa/backend
```

> La branche. L'API vit sur `feat/backend-comexa-api`. Le jour ou elle est
> fusionnee dans `main`, remplacez le `--branch` ci-dessus — sinon cette machine
> continuera de suivre une branche qui ne bouge plus.

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

## 9. Le courriel (Brevo)

1. Compte sur <https://www.brevo.com/> — 300 courriels/jour, **aucun domaine
   requis** sur le palier gratuit.
2. **SMTP & API → SMTP** : notez le serveur (`smtp-relay.brevo.com`), le port
   `587`, votre identifiant SMTP et la cle SMTP.
3. Verifiez l'adresse d'expediteur que vous mettrez dans `SMTP_FROM`.

```bash
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<identifiant SMTP>
SMTP_PASSWORD=<cle SMTP>
SMTP_FROM="Comexa <no-reply@exemple.tld>"
```

> Le serveur **refuse de demarrer** en production sans `SMTP_HOST`. Ce n'est pas
> une tracasserie : la route « mot de passe oublie » repond toujours `200`, meme
> sur une adresse inconnue, pour ne pas reveler quels comptes existent. Cette
> reponse n'est honnete que si le courriel part quand le compte existe.
>
> Sur le palier gratuit de Brevo, un pied de page « Sent with Brevo » est ajoute
> aux messages. C'est le prix du palier gratuit, pas un defaut de configuration.

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
declaree **une seule fois** dans `.env.example` : la section « PRODUCTION » de ce
fichier donne le numero de ligne a modifier, elle ne recopie aucune valeur (deux
occurrences d'une meme cle, dans un fichier que `dotenv` et `docker compose` ne
lisent pas dans le meme ordre, donnent une valeur de developpement qui gagne en
silence) :

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
| `SMTP_*` | voir §9 | `SMTP_HOST` est **obligatoire** en production |

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

**Les quatre `-e` sont a renseigner, aucun n'est facultatif.** Le détail :

- `SEED_ALLOW_PRODUCTION=yes` — le seed refuse de tourner en production sans ce
  drapeau (`prisma/seed.ts:1290`). Il n'est **volontairement pas** dans
  `docker-compose.prod.yml` : l'y laisser faisait de ce refus une formalite.
- `SEED_ADMIN_PASSWORD` et `SEED_DEMO_PASSWORD` — si vous les omettez, le seed en
  **génère** et les **affiche** (`prisma/seed.ts:1557` et `:1570`). Ils se
  retrouvent alors en clair dans les journaux du conteneur, conservés sur le
  disque de la VM. Les fournir ici ne laisse rien derrière.
- `SEED_ADMIN_EMAIL` — **la valeur par défaut n'est pas celle des captures
  d'écran** : sans cette variable, l'administrateur est créé sous
  `admin@comexa.example` (`prisma/seed.ts:1306`). Une version antérieure de ce
  runbook annonçait `admin@comexa.com` : suivie à la lettre, elle donnait un
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
> travail d'un depot **public**, il ne fallait qu'un `git add -A` distrait.
> `/tmp` est efface au redemarrage, et `cookies.txt` est de toute facon
> desormais ignore par git (`.gitignore`).

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
# 1. Le dossier. HORS de ~/comexa, qui est un depot git PUBLIC.
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
>    `comexa-<date>.dump` dans l'arbre du depot — un depot **public**. Un
>    `git add -A`, geste banal, publiait alors une sauvegarde logique COMPLETE de
>    la production : empreintes argon2 des mots de passe, clients, devis,
>    factures, paiements. Le fichier est desormais dans `~/backups`, et `*.dump`
>    a ete ajoute a `.gitignore` comme seconde barriere.
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
| Le serveur refuse de demarrer, `SMTP_HOST` cite | C'est **voulu** | Renseigner §9 |
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
- **Le renouvellement du domaine** et les enregistrements SPF/DKIM. Brevo fournit
  ceux de son propre domaine ; y ajouter le votre ameliore la delivrabilite et se
  configure chez votre registraire, pas ici.
- **Le durcissement de la VM** (fail2ban, mises a jour automatiques, cle SSH
  renommee, desactivation de l'authentification par mot de passe). Recommande,
  hors du perimetre de ce runbook.
