"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatDate, messageOf } from "@/lib/api";
import { hasTeamAccess } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useAction, useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Field, Notice, inputClass, primaryButton, secondaryButton } from "@/components/workspace/ui";

const MIN_PASSWORD = 12;
const BOT_USERNAME = "@ComexaWork_bot";

async function copyToClipboardText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

/**
 * Mon compte : identité, changement de mot de passe, sessions ouvertes.
 * Partagé entre les deux espaces. Fermer une session ou toutes les sessions
 * n'affecte que les sessions : la session courante finit par expirer côté API.
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
  const [telegramState, setTelegramState] = useState({ status: "loading", data: null, error: null });
  const [telegramCode, setTelegramCode] = useState(null);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramCopied, setTelegramCopied] = useState(false);
  const teamUser = hasTeamAccess(user);

  useEffect(() => {
    request("/auth/me")
      .then(({ data }) => setMe(data?.user ?? data ?? null))
      .catch(() => setMe(null));
  }, [request]);

  useEffect(() => {
    if (!teamUser) return;
    setTelegramState((s) => ({ ...s, status: "loading" }));
    request("/me/telegram-link")
      .then(({ data }) => setTelegramState({ status: "ready", data, error: null }))
      .catch((err) => setTelegramState({ status: "error", data: null, error: messageOf(err) }));
  }, [request, teamUser]);

  async function generateTelegramCode() {
    setTelegramBusy(true);
    setTelegramState((s) => ({ ...s, error: null }));
    try {
      const { data } = await request("/me/telegram-link/code", { method: "POST" });
      setTelegramCode(data);
      // Refresh state
      const state = await request("/me/telegram-link");
      setTelegramState({ status: "ready", data: state.data, error: null });
    } catch (err) {
      setTelegramState((s) => ({ ...s, error: messageOf(err) }));
    } finally {
      setTelegramBusy(false);
    }
  }

  async function disconnectTelegram() {
    setTelegramBusy(true);
    setTelegramState((s) => ({ ...s, error: null }));
    try {
      await request("/me/telegram-link", { method: "DELETE" });
      setTelegramCode(null);
      const state = await request("/me/telegram-link");
      setTelegramState({ status: "ready", data: state.data, error: null });
    } catch (err) {
      setTelegramState((s) => ({ ...s, error: messageOf(err) }));
    } finally {
      setTelegramBusy(false);
    }
  }

  async function copyCommand() {
    if (!telegramCode?.code) return;
    try {
      await copyToClipboardText(`/lier ${telegramCode.code}`);
      setTelegramCopied(true);
      setTimeout(() => setTelegramCopied(false), 2000);
    } catch {
      // ignore copy errors
    }
  }

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

  return (
    <div className="flex flex-col gap-6">
      {teamUser ? (
        <Card
          title={`Bot Telegram Comexa (${BOT_USERNAME})`}
          action={
            telegramState.data?.linked ? <Badge tone="success">Lié</Badge> : <Badge tone="neutral">Non lié</Badge>
          }
        >
          {telegramState.error ? <Notice>{telegramState.error}</Notice> : null}
          {telegramState.status === "loading" ? <p className="cx-small">Chargement de l’état de liaison…</p> : null}

          {telegramState.data?.linked ? (
            <div className="flex flex-col gap-4">
              <p className="text-[14.5px]">
                Votre compte Comexa est lié au compte Telegram{" "}
                <strong>{telegramState.data.telegramUsername ? `@${telegramState.data.telegramUsername}` : (telegramState.data.telegramUserId ?? "")}</strong>
                {telegramState.data.pairedAt ? <> depuis le {formatDate(telegramState.data.pairedAt)}</> : null}.
              </p>
              <div>
                <button type="button" className={secondaryButton} onClick={disconnectTelegram} disabled={telegramBusy}>
                  {telegramBusy ? "Déconnexion…" : "Déconnecter mon Telegram"}
                </button>
              </div>
            </div>
          ) : null}

          {!telegramState.data?.linked ? (
            <div className="flex flex-col gap-4">
              <p className="text-[14.5px]">
                Liez votre compte Telegram au bot {BOT_USERNAME} pour recevoir des notifications et piloter Comexa directement depuis une conversation Telegram, avec vos droits d’équipe.
              </p>
              {telegramCode ? (
                <div className="rounded-lg border-2 border-[var(--comexa-accent-strong)] bg-[var(--comexa-accent-soft)] p-4">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--comexa-ink-muted)]">Code d’appairage</p>
                  <p className="mt-1 text-[28px] font-bold tracking-[0.3em] text-[var(--comexa-ink)]">{telegramCode.code}</p>
                  <p className="mt-2 text-[13px] text-[var(--comexa-ink-soft)]">
                    Envoyez la commande suivante à {BOT_USERNAME} sur Telegram dans les 10 minutes :
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <code className="rounded-md bg-[var(--comexa-surface)] px-3 py-2 font-mono text-[15px] font-semibold">
                      /lier {telegramCode.code}
                    </code>
                    <button type="button" className={secondaryButton} onClick={copyCommand}>
                      {telegramCopied ? "Commande copiée" : "Copier la commande"}
                    </button>
                  </div>
                  <p className="mt-2 text-[12px] text-[var(--comexa-ink-muted)]">
                    Expire le {new Date(telegramCode.expiresAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}.
                  </p>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryButton} onClick={generateTelegramCode} disabled={telegramBusy}>
                  {telegramBusy ? "Génération…" : telegramCode ? "Générer un nouveau code" : "Générer un code de liaison"}
                </button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}
      <Card title="Mon profil">
        {profile ? (
          <dl className="grid gap-3 text-[14.5px] md:grid-cols-2">
            <div>
              <dt className="cx-label">Nom</dt>
              <dd>{profile.firstName} {profile.lastName}</dd>
            </div>
            <div>
              <dt className="cx-label">E-mail</dt>
              <dd>{profile.email}</dd>
            </div>
            {profile.phone ? (
              <div>
                <dt className="cx-label">Téléphone</dt>
                <dd>{profile.phone}</dd>
              </div>
            ) : null}
            {profile.lastLoginAt ? (
              <div>
                <dt className="cx-label">Dernière connexion</dt>
                <dd>{formatDate(profile.lastLoginAt)}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="cx-small">Chargement du profil…</p>
        )}
      </Card>

      <Card title="Changer le mot de passe">
        <form onSubmit={changePassword} className="grid max-w-[520px] gap-4">
          {pwError ? <Notice>{pwError}</Notice> : null}
          {pwSuccess ? <Notice tone="success">{pwSuccess}</Notice> : null}
          <Field id="pw-current" label="Mot de passe actuel">
            <input id="pw-current" type="password" autoComplete="current-password" required className={inputClass} value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
          </Field>
          <Field id="pw-new" label={`Nouveau mot de passe (${MIN_PASSWORD} caractères minimum)`}>
            <input id="pw-new" type="password" autoComplete="new-password" required className={inputClass} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          </Field>
          <Field id="pw-confirm" label="Confirmer le nouveau mot de passe">
            <input id="pw-confirm" type="password" autoComplete="new-password" required className={inputClass} value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
          </Field>
          <div>
            <button type="submit" disabled={pwBusy} className={primaryButton}>{pwBusy ? "Enregistrement…" : "Modifier le mot de passe"}</button>
          </div>
        </form>
      </Card>

      <Card
        title="Sessions ouvertes"
        action={
          <button type="button" className={secondaryButton} onClick={logoutEverywhere}>
            Déconnecter partout
          </button>
        }
      >
        {action.error ? <Notice>{action.error}</Notice> : null}
        {action.success ? <Notice tone="success">{action.success}</Notice> : null}
        {sessions.error ? <Notice>{sessions.error}</Notice> : null}
        {sessions.items === null && !sessions.error ? <p className="cx-small">Chargement…</p> : null}
        {sessions.items !== null && items.length === 0 ? <Empty>Aucune session ouverte.</Empty> : null}
        <ul className="flex flex-col gap-3">
          {items.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--comexa-border-soft)] p-4">
              <div className="min-w-0 text-[14px]">
                <p className="font-medium text-[var(--comexa-ink)]">{session.ipAddress ?? "Adresse inconnue"}</p>
                <p className="truncate text-[12.5px] text-[var(--comexa-ink-muted)]">{session.userAgent ?? "Navigateur inconnu"}</p>
                <p className="text-[12.5px] text-[var(--comexa-ink-muted)]">Ouverte le {formatDate(session.createdAt)} · expire le {formatDate(session.expiresAt)}</p>
              </div>
              <button
                type="button"
                className={secondaryButton}
                disabled={action.busy === `session:${session.id}`}
                onClick={() => action.run(`session:${session.id}`, `/auth/sessions/${session.id}`, { method: "DELETE" }, "Session fermée.")}
              >
                Fermer
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
