"use client";

/*
 * Liaison du compte au bot Telegram @ComexaWork_bot (Mon compte).
 *
 * Le parcours repose sur le mécanisme existant, sans rien inventer :
 *   1. `POST /me/telegram-link/code` génère un code à 6 chiffres (10 min) ;
 *   2. le membre envoie `/lier <code>` au bot, qui appelle le serveur ;
 *   3. cette carte interroge `GET /me/telegram-link` jusqu'à ce que le SERVEUR
 *      confirme la liaison. « Lié » ne s'affiche jamais sur une supposition.
 *
 * Le code n'est connu qu'au moment de sa génération (le serveur n'en garde
 * que l'empreinte) : après un rechargement, la carte sait qu'un code attend,
 * jusqu'à quand, et continue de guetter la confirmation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { formatDate, messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { Badge, Card, Notice, primaryButton, secondaryButton } from "@/components/workspace/ui";

const BOT_USERNAME = "@ComexaWork_bot";
const BOT_URL = "https://t.me/ComexaWork_bot";
const POLL_MS = 3000;

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

/** « 9:41 » : minutes et secondes restantes. */
function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function TelegramLinkCard() {
  const { request } = useAuth();
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [justLinked, setJustLinked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const copiedTimer = useRef(null);
  const wasLinked = useRef(false);

  const linked = Boolean(state.data?.linked);
  const expiresAt = code?.expiresAt ?? state.data?.pairingExpiresAt ?? null;
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : null;
  const pending = !linked && expiresMs !== null && expiresMs > now;
  const expired = !linked && code !== null && expiresMs !== null && expiresMs <= now;

  const refresh = useCallback(
    async ({ quiet = false } = {}) => {
      try {
        const { data } = await request("/me/telegram-link");
        // Bandeau de succès seulement quand la confirmation arrive pendant
        // l'attente (pas au simple chargement d'un compte déjà lié).
        if (quiet && !wasLinked.current && data?.linked) setJustLinked(true);
        wasLinked.current = Boolean(data?.linked);
        setState({ status: "ready", data, error: null });
        if (data?.linked) setCode(null);
      } catch (caught) {
        if (!quiet) setState((current) => ({ ...current, status: "error", error: messageOf(caught) }));
      }
    },
    [request],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  /* Tant qu'un code attend : horloge à la seconde, et interrogation du serveur
     toutes les 3 s (et dès que l'onglet redevient visible). */
  useEffect(() => {
    if (!pending) return undefined;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh({ quiet: true });
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh({ quiet: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pending, refresh]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  async function generate() {
    setBusy(true);
    setJustLinked(false);
    setState((current) => ({ ...current, error: null }));
    try {
      const { data } = await request("/me/telegram-link/code", { method: "POST" });
      setCode(data);
      setNow(Date.now());
      await refresh({ quiet: true });
    } catch (caught) {
      setState((current) => ({ ...current, error: messageOf(caught) }));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setJustLinked(false);
    setState((current) => ({ ...current, error: null }));
    try {
      await request("/me/telegram-link", { method: "DELETE" });
      setCode(null);
      await refresh();
    } catch (caught) {
      setState((current) => ({ ...current, error: messageOf(caught) }));
    } finally {
      setBusy(false);
    }
  }

  async function copyCommand() {
    if (!code?.code) return;
    try {
      await copyToClipboardText(`/lier ${code.code}`);
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setState((current) => ({ ...current, error: "Copie impossible : sélectionnez la commande et copiez-la à la main." }));
    }
  }

  const badge =
    state.status === "loading" ? (
      <Badge tone="neutral">Vérification…</Badge>
    ) : linked ? (
      <Badge tone="success">Lié</Badge>
    ) : pending ? (
      <Badge tone="warning">En attente du bot</Badge>
    ) : (
      <Badge tone="neutral">Non lié</Badge>
    );

  return (
    <Card title={`Bot Telegram Comexa (${BOT_USERNAME})`} action={badge}>
      {state.error ? <Notice>{state.error}</Notice> : null}
      {state.status === "loading" ? <p className="sui-card__desc">Chargement de l’état de liaison…</p> : null}

      {linked ? (
        <div className="flex flex-col gap-4">
          {justLinked ? <Notice tone="success">Liaison confirmée par Comexa. Vous pouvez utiliser le bot dès maintenant.</Notice> : null}
          <p className="sui-body">
            Votre compte Comexa est lié au compte Telegram{" "}
            <strong>{state.data.telegramUsername ? `@${state.data.telegramUsername}` : (state.data.telegramUserId ?? "")}</strong>
            {state.data.pairedAt ? <> depuis le {formatDate(state.data.pairedAt)}</> : null}.
          </p>
          <div className="flex flex-wrap gap-2">
            <a className={secondaryButton} href={BOT_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} aria-hidden="true" /> Ouvrir {BOT_USERNAME}
            </a>
            <button type="button" className={secondaryButton} onClick={disconnect} disabled={busy}>
              {busy ? "Déconnexion…" : "Déconnecter mon Telegram"}
            </button>
          </div>
        </div>
      ) : null}

      {state.status !== "loading" && !linked ? (
        <div className="flex flex-col gap-4">
          <p className="sui-body">
            Liez votre compte Telegram au bot {BOT_USERNAME} pour recevoir des notifications et piloter Comexa depuis une conversation
            Telegram, avec vos droits d’équipe.
          </p>

          {code && pending ? (
            <div className="sui-panel sui-panel--tint" style={{ "--tone-bg": "var(--lilac)" }}>
              <p className="sui-field__label">Code de liaison</p>
              <p className="sui-code-big">{code.code}</p>
              <ol className="sui-steps-ol">
                <li>Ouvrez {BOT_USERNAME} en message privé.</li>
                <li>Envoyez la commande ci-dessous.</li>
                <li>Restez sur cette page : la liaison s’affichera dès que Comexa l’aura confirmée.</li>
              </ol>
              <div className="flex flex-wrap items-center gap-2">
                <code className="sui-code">/lier {code.code}</code>
                <button type="button" className={secondaryButton} onClick={copyCommand}>
                  {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                  {copied ? "Commande copiée" : "Copier la commande"}
                </button>
                <a className={secondaryButton} href={BOT_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={15} aria-hidden="true" /> Ouvrir {BOT_USERNAME}
                </a>
              </div>
              <p className="sui-field__hint" aria-live="polite">
                Expire dans <strong className="sui-tabular">{formatCountdown(expiresMs - now)}</strong> · en attente de la confirmation du bot…
              </p>
            </div>
          ) : null}

          {!code && pending ? (
            <Notice tone="info">
              Un code de liaison est en attente jusqu’à{" "}
              {new Date(expiresMs).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}. Si vous ne l’avez plus, générez-en un
              nouveau : l’ancien sera remplacé.
            </Notice>
          ) : null}

          {expired ? <Notice tone="warning">Ce code a expiré sans être utilisé. Générez-en un nouveau pour lier votre compte.</Notice> : null}

          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryButton} onClick={generate} disabled={busy}>
              {code || pending ? <RefreshCw size={15} aria-hidden="true" /> : null}
              {busy ? "Génération…" : code || pending ? "Générer un nouveau code" : "Générer un code de liaison"}
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
