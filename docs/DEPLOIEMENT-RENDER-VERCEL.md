# Déploiement — API sur Render, front sur Vercel, base sur Neon, courriel Mailjet

Aucun secret dans ce document ni dans le dépôt. Toutes les valeurs se saisissent dans les
tableaux de bord Render et Vercel.

## 0. Avant tout

- **Changer le mot de passe du rôle `neondb_owner`** dans la console Neon : il a été partagé
  en clair pendant la préparation. Utiliser ensuite uniquement la nouvelle valeur.
- Générer les secrets (une fois, à conserver dans un gestionnaire de mots de passe) :
  - `openssl rand -base64 48` → `JWT_ACCESS_SECRET`
  - `openssl rand -base64 48` → `JWT_REFRESH_SECRET` (**différent** du précédent)
  - `openssl rand -hex 32` → `REVALIDATE_SECRET` (**identique** sur Render et Vercel)
- Préparer Mailjet : clés API, et un expéditeur **validé** (`SMTP_FROM`).
- Préparer le stockage S3-compatible (Backblaze B2 documenté) : bucket **créé à l'avance**.

## 1. Base Neon : migrations

Deux URL : `DIRECT_URL` (hôte **sans** `-pooler`) pour les migrations, `DATABASE_URL`
(hôte `-pooler`) pour l'application.

```bash
cd backend
DIRECT_URL='postgresql://…' npm run prisma:deploy   # migrations, geste délibéré
```

Ne **pas** lancer `npm run db:seed` en production : le seed crée des comptes de démonstration
à mot de passe connu et des partenaires fictifs. Les vraies données se saisissent ensuite via
l'espace Admin.

> Point ouvert avant mise en production : vérifier que les rôles et permissions existent en
> base sans passer par le seed de démonstration (un script « rôles seuls » est à prévoir si
> ce n'est pas le cas). Sans eux, aucun compte ne peut se connecter avec des droits.

## 2. API sur Render

1. Dashboard Render → **New → Blueprint** → sélectionner le dépôt et la branche
   `arena/243ea272-comexa-portfolio` (ou `main` après fusion).
2. Render lit `render.yaml` et propose le service `comexa-api` (Docker, `backend/Dockerfile`,
   région Frankfurt, palier Starter).
3. Renseigner les variables marquées « à saisir » (liste dans `render.yaml`) :
   `CORS_ORIGIN` et `FRONTEND_URL` = URL publique du front (Vercel ou domaine personnalisé),
   `DATABASE_URL`, `DIRECT_URL`, `JWT_*`, `REVALIDATE_SECRET`, `MAILJET_API_KEY`,
   `MAILJET_SECRET_KEY`, `SMTP_FROM`, `S3_*`.
4. Déployer. Contrôle : `https://<service>.onrender.com/api/health` doit répondre 200 et
   confirmer la base.

Le serveur **refuse de démarrer** si un secret manque, si les deux JWT sont identiques, ou si
aucun moyen d'envoi de courriel n'est configuré (voulu). Le message de démarrage nomme la
variable en cause.

## 3. Front sur Vercel

1. Dashboard Vercel → **Add New → Project** → importer le dépôt, dossier racine `.`,
   framework Next.js (détecté).
2. Variables d'environnement (Production) :
   - `BACKEND_URL` = `https://<service>.onrender.com` (sans slash final)
   - `REVALIDATE_SECRET` = **la même valeur** que sur Render
3. Déployer.

Le navigateur n'appelle jamais Render directement : `next.config.mjs` relaie `/api/*` vers
`BACKEND_URL`. Le cookie de rafraîchissement reste donc sur le domaine du front
(`COOKIE_SAMESITE=lax` suffit).

## 4. Boucle finale

- Revenir sur Render, vérifier que `CORS_ORIGIN` et `FRONTEND_URL` pointent vers l'URL Vercel
  exacte (schéma et domaine), puis **redéployer** le service.
- Tester : connexion d'un compte, déconnexion, mot de passe oublié (le courriel doit arriver),
  modification d'un service (la page publique doit se mettre à jour : c'est la revalidation).

## 5. Points connus à garder en tête

- Le 401 sur `/api/auth/refresh` des pages publiques est **connu et laissé tel quel** (décision).
- La documentation API est fermée en production (`DOCS_ENABLED=false`).
- Un compte dont l'e-mail n'est pas vérifié ne peut pas se connecter (décision maintenue).
- Les comptes de test créés en local ne doivent exister qu'en local.
