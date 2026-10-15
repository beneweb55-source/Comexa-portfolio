"use client";

import { useEffect, useRef, useState } from "react";
import { messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";
import { primaryButton, secondaryButton, inputClass } from "@/components/workspace/ui";

/**
 * Assistant IA Comexa — tiroir flottant.
 *
 * Envoie les messages au proxy Next.js `/api/agent-chat`, qui relaie vers le
 * webhook n8n avec le JWT de session. Historique conservé en mémoire (par onglet),
 * une sessionId stable est générée à la première ouverture.
 */

const QUICK_PROMPTS = [
  "Bilan de l'agence ce mois-ci",
  "Mes tâches en cours",
  "Mes prochains événements",
];

function genSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function timestamp() {
  return new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" }).format(new Date());
}

export default function AiAgentDrawer() {
  const { request } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pendingAction, setPendingAction] = useState(null); // ex: {text, actionId}
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      if (!sessionId) setSessionId(genSessionId());
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, sessionId]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  async function send(text, { confirmedAction } = {}) {
    const content = (text ?? input).trim();
    if (!content || busy) return;

    setError(null);
    setBusy(true);
    const userMsg = { role: "user", content, ts: timestamp() };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    if (pendingAction) setPendingAction(null);

    try {
      // L'API route `/api/agent-chat` est un fichier Next.js (route.js),
      // elle passe devant la réécriture vers le backend car les routes
      // App Router ont la priorité sur les rewrites.
      const { data } = await request("/agent-chat", {
        method: "POST",
        body: {
          chatInput: content,
          sessionId: sessionId ?? genSessionId(),
          ...(confirmedAction ? { actionId: confirmedAction } : {}),
        },
      });

      const reply = typeof data === "string" ? data : (data?.reply ?? data?.output ?? data?.message ?? JSON.stringify(data));
      const action = data?.proposedAction ?? data?.action ?? null;

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: reply,
          ts: timestamp(),
          action,
        },
      ]);

      if (action) {
        setPendingAction(action);
      }
    } catch (caught) {
      setError(messageOf(caught) || "L&apos;assistant n&apos;a pas pu répondre.");
      setMessages((m) => [...m, { role: "error", content: messageOf(caught) || "Erreur", ts: timestamp() }]);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    send();
  }

  function onConfirmAction() {
    // Envoie un message spécial confirmant l'action proposée
    if (!pendingAction) return;
    send("Confirmer l'action", { confirmedAction: pendingAction.actionId ?? pendingAction.id ?? "confirm" });
  }

  function onCancelAction() {
    setPendingAction(null);
    setMessages((m) => [...m, { role: "system", content: "Action annulée.", ts: timestamp() }]);
  }

  return (
    <>
      {/* Bouton d'ouverture flottant */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ouvrir l'assistant IA"
        className="fixed bottom-5 right-5 z-50 flex h-14 items-center gap-2 rounded-full bg-[var(--comexa-accent-strong)] px-5 text-[14px] font-semibold text-white shadow-lg shadow-black/20 transition hover:scale-105"
      >
        <span aria-hidden="true" style={{ fontSize: 18 }}>✨</span>
        Assistant IA
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30" onClick={() => setOpen(false)}>
          <aside
            className="flex h-full w-full max-w-[420px] flex-col border-l border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Assistant IA Comexa"
          >
            <header className="flex items-center justify-between border-b border-[var(--comexa-border-soft)] px-4 py-3">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--comexa-ink)]">Assistant IA Comexa</h3>
                <p className="text-[12px] text-[var(--comexa-ink-muted)]">Votre copilote pour l&apos;agence</p>
              </div>
              <button type="button" className={secondaryButton} onClick={() => setOpen(false)} aria-label="Fermer">
                Fermer
              </button>
            </header>

            <div ref={listRef} className="flex-1 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                  <div className="text-4xl">🤖</div>
                    <p className="text-[14px] text-[var(--comexa-ink-soft)]">
                    Posez une question sur vos projets, vos tâches ou l&apos;activité de l&apos;agence.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {QUICK_PROMPTS.map((p) => (
                      <button key={p} type="button" className={secondaryButton} onClick={() => send(p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <ul className="flex flex-col gap-3">
                  {messages.map((msg, i) => (
                    <li
                      key={i}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2 text-[14px] leading-relaxed ${
                          msg.role === "user"
                            ? "bg-[var(--comexa-accent-strong)] text-white"
                            : msg.role === "error"
                              ? "bg-[var(--comexa-error-soft)] text-[var(--comexa-error)]"
                              : msg.role === "system"
                                ? "bg-[var(--comexa-neutral-100)] text-[var(--comexa-ink-muted)] italic"
                                : "bg-[var(--comexa-neutral-100)] text-[var(--comexa-ink)]"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        <p className={`mt-1 text-[11px] ${msg.role === "user" ? "text-white/70" : "text-[var(--comexa-ink-muted)]"}`}>
                          {msg.ts}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Proposition d'action avec boutons Confirmer/Annuler */}
            {pendingAction ? (
              <div className="border-t border-[var(--comexa-border-soft)] bg-[var(--comexa-accent-soft)] p-4">
                <p className="text-[13px] text-[var(--comexa-ink)]">
                  <strong>Action proposée :</strong> {pendingAction.label ?? pendingAction.description ?? "Confirmer cette action."}
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className={primaryButton} onClick={onConfirmAction} disabled={busy}>
                    Confirmer
                  </button>
                  <button type="button" className={secondaryButton} onClick={onCancelAction} disabled={busy}>
                    Annuler
                  </button>
                </div>
              </div>
            ) : null}

            {error && !pendingAction ? (
              <div className="px-4"><p className="text-[12.5px] text-[var(--comexa-error)]">{error}</p></div>
            ) : null}

            <form onSubmit={onSubmit} className="border-t border-[var(--comexa-border-soft)] p-3">
              {messages.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  {QUICK_PROMPTS.map((p) => (
                    <button key={p} type="button" className={secondaryButton} onClick={() => send(p)}>
                      {p}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  className={inputClass}
                  placeholder="Posez votre question…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={busy}
                />
                <button type="submit" className={primaryButton} disabled={busy || !input.trim()}>
                  {busy ? "…" : "Envoyer"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </>
  );
}
