"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { KeyRound, LogOut, Monitor, ShieldCheck, Smartphone } from "lucide-react";
import { formatDate, messageOf } from "@/lib/api";
import { hasTeamAccess } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useAction, useListing } from "@/lib/use-listing";
import { Notice, primaryButton, secondaryButton } from "@/components/workspace/ui";
import { Panel } from "@/components/softui/panels";
import { Button } from "@/components/softui/primitives";
import CurrencyScopeToggle from "@/components/softui/CurrencyScopeToggle";
import { Empty } from "@/components/workspace/ui";
import BalancePanel from "@/components/workspace/BalancePanel";
import TelegramLinkCard from "@/components/workspace/TelegramLinkCard";
import UserAvatar from "@/components/workspace/UserAvatar";
import { roleLabel } from "@/lib/labels";

const MIN_PASSWORD = 12;

/** Libellé lisible du navigateur, quand l'agent utilisateur est une bouillie. */
function deviceLabel(userAgent) {
  const ua = String(userAgent ?? "");
  if (!ua) return "Navigateur inconnu";
  if (/iPhone|iPad|iPod/i.test(ua)) return "Appareil Apple";
  if (/Android/i.test(ua)) return "Appareil Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Navigateur";
}

/**
 * Mon compte : identité, changement de mot de passe, sessions ouvertes.
 * Partagé entre les deux espaces. Fermer une session ou toutes les sessions
 * n'affecte que les sessions : la session courante finit par expirer côté API.
 *
 * Habillage : design system « soft UI pastel dans une coque noire », le même
 * que le tableau de bord de Comexa Space — panneaux blancs très arrondis,
 * pastels, un seul bouton noir par panneau pour l'action principale.
 */
export default function AccountPanel() {
  const { request, logout, user } = useAuth();
  const router = useRouter();
  const sessions = useListing("/auth/sessions");
  const action = useAction(sessions.reload);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [pwError, setPwError] = useState(null);
  const [pwSuccess, setPwSuccess] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [me, setMe] = useState(null);
  const teamUser = hasTeamAccess(user);

  useEffect(() => {
    request("/auth/me")
      .then(({ data }) => setMe(data?.user ?? data ?? null))
      .catch(() => setMe(null));
  }, [request]);

  async function changePassword(event) {
    event.preventDefault();
    setPwError(null);
    setPwSuccess(null);
    if (form.newPassword.length < MIN_PASSWORD) {
      setPwError(`Le nouveau mot de passe compte au moins ${MIN_PASSWORD} caractères.`);
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setPwError("La confirmation ne correspond pas au nouveau mot de passe.");
      return;
    }
    setPwBusy(true);
    try {
      await request("/auth/change-password", { method: "POST", body: form });
      setPwSuccess("Mot de passe modifié.");
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (caught) {
      setPwError(messageOf(caught));
    } finally {
      setPwBusy(false);
    }
  }

  async function logoutEverywhere() {
    try {
      await request("/auth/logout-all", { method: "POST" });
    } catch (caught) {
      setPwError(messageOf(caught));
      return;
    }
    await logout();
    router.replace("/connexion");
  }

  const profile = me ?? user;
  const items = sessions.items ?? [];
  const roles = (profile?.roles ?? []).map((role) => (typeof role === "string" ? role : role?.code)).filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      {/* Solde : visible seulement pour un porteur qui a le droit de le lire.
          En TÊTE de « Mon compte » : c'est l'info que tout le monde vient
          chercher, présentée comme un compte bancaire. */}
      <BalancePanel />

      {teamUser ? <TelegramLinkCard /> : null}

      {/* Identité : qui est connecté, en un coup d'œil. */}
      <Panel className="sui-panel--identity">
        {profile ? (
          <div className="sui-identity">
            <span className="sui-identity__avatar">
              <UserAvatar profile={profile} size={64} initialsOnly />
            </span>
            <div className="min-w-0 flex-1">
              <p className="sui-identity__eyebrow">Compte connecté</p>
              <h2 className="sui-identity__name">
                {profile.firstName} {profile.lastName}
              </h2>
              <p className="sui-identity__mail">{profile.email}</p>
              {roles.length ? (
                <p className="sui-identity__roles">
                  <span className="sui-lines__icon" style={{ "--tone-bg": "var(--lilac)" }} aria-hidden="true">
                    <ShieldCheck size={15} strokeWidth={1.75} />
                  </span>
                  {roles.map((role) => roleLabel(role)).join(" · ")}
                </p>
              ) : null}
            </div>
            <dl className="sui-identity__meta">
              {profile.phone ? (
                <div>
                  <dt className="sui-field__label">Téléphone</dt>
                  <dd>{profile.phone}</dd>
                </div>
              ) : null}
              <div>
                <dt className="sui-field__label">Dernière connexion</dt>
                <dd>{profile.lastLoginAt ? formatDate(profile.lastLoginAt) : "—"}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="sui-card__desc">Chargement du profil…</p>
        )}
      </Panel>

      <Panel title="Mon profil" subtitle="Vos informations telles que Comexa les connaît.">
        {profile ? (
          <dl className="sui-profile-grid">
            <div>
              <dt className="sui-field__label">Nom</dt>
              <dd>
                {profile.firstName} {profile.lastName}
              </dd>
            </div>
            <div>
              <dt className="sui-field__label">E-mail</dt>
              <dd>{profile.email}</dd>
            </div>
            {profile.phone ? (
              <div>
                <dt className="sui-field__label">Téléphone</dt>
                <dd>{profile.phone}</dd>
              </div>
            ) : null}
            {profile.lastLoginAt ? (
              <div>
                <dt className="sui-field__label">Dernière connexion</dt>
                <dd>{formatDate(profile.lastLoginAt)}</dd>
              </div>
            ) : null}
            {roles.length ? (
              <div>
                <dt className="sui-field__label">Rôles</dt>
                <dd>{roles.map((role) => roleLabel(role)).join(", ")}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="sui-card__desc">Chargement du profil…</p>
        )}
      </Panel>

      {/* Préférence d'AFFICHAGE, pas une donnée comptable : elle ne convertit
          aucun montant et ne modifie aucune facture. */}
      <Panel
        title="Préférences d’affichage"
        subtitle="Choisissez la monnaie des totaux sur les tableaux de bord et les listes. Aucun montant n’est converti : chaque devise garde sa valeur."
      >
        <CurrencyScopeToggle label="Montants affichés en" />
        <p className="sui-card__desc">
          « Les deux » affiche les totaux de chaque devise côte à côte, sans jamais les additionner. Ce choix est
          enregistré dans ce navigateur et s’applique au tableau de bord, aux factures et aux devis.
        </p>
      </Panel>

      <Panel title="Changer le mot de passe" subtitle={`Au moins ${MIN_PASSWORD} caractères.`}>
        <form onSubmit={changePassword} className="sui-form" style={{ maxWidth: 520 }}>
          {pwError ? <Notice>{pwError}</Notice> : null}
          {pwSuccess ? <Notice tone="success">{pwSuccess}</Notice> : null}
          <div className="sui-field">
            <label htmlFor="pw-current" className="sui-field__label">Mot de passe actuel</label>
            <input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              required
              className="sui-input"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
            />
          </div>
          <div className="sui-field">
            <label htmlFor="pw-new" className="sui-field__label">Nouveau mot de passe ({MIN_PASSWORD} caractères minimum)</label>
            <input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              required
              className="sui-input"
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            />
          </div>
          <div className="sui-field">
            <label htmlFor="pw-confirm" className="sui-field__label">Confirmer le nouveau mot de passe</label>
            <input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              required
              className="sui-input"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            />
          </div>
          <div>
            <button type="submit" disabled={pwBusy} className={primaryButton}>
              <KeyRound size={16} strokeWidth={1.9} aria-hidden="true" />
              {pwBusy ? "Enregistrement…" : "Modifier le mot de passe"}
            </button>
          </div>
        </form>
      </Panel>

      <Panel
        title="Sessions ouvertes"
        subtitle="Les appareils actuellement connectés à votre compte."
        action={
          <button type="button" className={`${secondaryButton} sui-btn--sm`} onClick={logoutEverywhere}>
            <LogOut size={14} strokeWidth={2} aria-hidden="true" /> Déconnecter partout
          </button>
        }
      >
        {action.error ? <Notice>{action.error}</Notice> : null}
        {action.success ? <Notice tone="success">{action.success}</Notice> : null}
        {sessions.error ? <Notice>{sessions.error}</Notice> : null}
        {sessions.items === null && !sessions.error ? <p className="sui-card__desc">Chargement…</p> : null}
        {sessions.items !== null && items.length === 0 ? <Empty icon={Monitor}>Aucune session ouverte.</Empty> : null}
        {items.length ? (
          <ul className="sui-lines sui-lines--rows">
            {items.map((session) => (
              <li key={session.id}>
                <span className="sui-lines__icon" style={{ "--tone-bg": "var(--blue)" }} aria-hidden="true">
                  <Smartphone size={15} strokeWidth={1.75} />
                </span>
                <span className="sui-lines__copy">
                  <strong>{deviceLabel(session.userAgent)}</strong>
                  <span>
                    {session.ipAddress ?? "Adresse inconnue"} · ouverte le {formatDate(session.createdAt)} · expire le {formatDate(session.expiresAt)}
                  </span>
                </span>
                <span className="sui-lines__end">
                  <Button
                    size="sm"
                    onClick={() => action.run(`session:${session.id}`, `/auth/sessions/${session.id}`, { method: "DELETE" }, "Session fermée.")}
                    disabled={action.busy === `session:${session.id}`}
                  >
                    Fermer
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>
    </div>
  );
}
