"use client";

/* Messagerie partagée entre l'espace équipe et l'espace client (même API, mêmes droits côté serveur). */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { formatDate, messageOf } from "@/lib/api";
import { Badge, Card, Empty, Notice, inputClass, primaryButton, secondaryButton, selectClass, textareaClass, Field } from "@/components/workspace/ui";

const TYPE_LABEL = { DIRECT: "Direct", PROJECT: "Projet", CLIENT: "Client", SUPPORT: "Support" };
const ROLE_LABEL = { OWNER: "Propriétaire", MEMBER: "Membre", GUEST: "Invité" };

function fullName(person) {
  if (!person) return "Inconnu";
  return `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || person.email || "Inconnu";
}

/**
 * Messagerie interne de l'équipe. Liste des conversations à gauche, fil à droite.
 * Chaque appel passe par `request` (jeton + rafraîchissement) et affiche son erreur.
 * L'API renvoie les messages du plus récent au plus ancien : on les remet dans l'ordre.
 */
export default function MessagingPanel() {
  const { request, user } = useAuth();
  const [conversations, setConversations] = useState({ items: null, error: null });
  const [selectedId, setSelectedId] = useState(null);
  const [thread, setThread] = useState({ conversation: null, messages: [], nextCursor: null, error: null, loading: false });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);
  const [creating, setCreating] = useState(false);
  const [members, setMembers] = useState(null);

  const loadConversations = useCallback(async () => {
    try {
      const { data } = await request("/conversations?perPage=50");
      setConversations({ items: data ?? [], error: null });
    } catch (caught) {
      setConversations((current) => ({ ...current, error: messageOf(caught) }));
    }
  }, [request]);

  const loadThread = useCallback(
    async (id) => {
      if (!id) return;
      setThread((current) => ({ ...current, loading: true, error: null }));
      try {
        const [{ data: conversation }, page] = await Promise.all([
          request(`/conversations/${id}`),
          request(`/conversations/${id}/messages?perPage=50`),
        ]);
        setThread({
          conversation,
          messages: [...(page.data ?? [])].reverse(),
          nextCursor: page.meta?.nextCursor ?? null,
          error: null,
          loading: false,
        });
        await request(`/conversations/${id}/read`, { method: "POST" }).catch(() => null);
        loadConversations();
      } catch (caught) {
        setThread((current) => ({ ...current, loading: false, error: messageOf(caught) }));
      }
    },
    [request, loadConversations],
  );

  useEffect(() => {
    loadConversations();
    // Annuaire interne : réservé aux porteurs de `user:read:any` (le client n'y a pas accès).
    if (!can(user, "user:read:any")) return;
    request("/users?perPage=100&status=ACTIVE")
      .then(({ data }) => setMembers(data ?? []))
      .catch(() => setMembers([]));
  }, [request, loadConversations, user]);

  useEffect(() => {
    if (selectedId) loadThread(selectedId);
  }, [selectedId, loadThread]);

  async function loadOlder() {
    if (!thread.nextCursor) return;
    try {
      const page = await request(`/conversations/${selectedId}/messages?perPage=50&cursor=${encodeURIComponent(thread.nextCursor)}`);
      setThread((current) => ({
        ...current,
        messages: [...[...(page.data ?? [])].reverse(), ...current.messages],
        nextCursor: page.meta?.nextCursor ?? null,
      }));
    } catch (caught) {
      setNotice({ tone: "error", text: messageOf(caught) });
    }
  }

  async function send(event) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !selectedId) return;
    setSending(true);
    setNotice(null);
    try {
      await request(`/conversations/${selectedId}/messages`, { method: "POST", body: { body } });
      setDraft("");
      await loadThread(selectedId);
    } catch (caught) {
      setNotice({ tone: "error", text: messageOf(caught) });
    } finally {
      setSending(false);
    }
  }

  async function archive() {
    try {
      await request(`/conversations/${selectedId}`, { method: "PATCH", body: { isArchived: true } });
      setNotice({ tone: "success", text: "Conversation archivée." });
      setSelectedId(null);
      setThread({ conversation: null, messages: [], nextCursor: null, error: null, loading: false });
      loadConversations();
    } catch (caught) {
      setNotice({ tone: "error", text: messageOf(caught) });
    }
  }

  const items = conversations.items ?? [];
  const conversation = thread.conversation;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      {notice ? (
        <div className="lg:col-span-2">
          <Notice tone={notice.tone}>{notice.text}</Notice>
        </div>
      ) : null}

      <Card
        title="Conversations"
        action={
          <button type="button" className={secondaryButton} onClick={() => setCreating((value) => !value)}>
            {creating ? "Fermer" : "Nouvelle"}
          </button>
        }
      >
        {creating ? (
          <NewConversation
            members={members}
            onCreated={async (created) => {
              setCreating(false);
              await loadConversations();
              setSelectedId(created.id);
            }}
            onError={(text) => setNotice({ tone: "error", text })}
          />
        ) : null}

        {conversations.error ? <Notice>{conversations.error}</Notice> : null}
        {conversations.items === null && !conversations.error ? <p className="cx-small">Chargement…</p> : null}
        {conversations.items !== null && items.length === 0 ? <Empty>Aucune conversation pour le moment.</Empty> : null}

        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                aria-current={item.id === selectedId ? "true" : undefined}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  item.id === selectedId
                    ? "border-[var(--comexa-ink)] bg-[var(--comexa-neutral-100)]"
                    : "border-[var(--comexa-border-soft)] hover:bg-[var(--comexa-neutral-100)]"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[14.5px] font-semibold text-[var(--comexa-ink)]">{item.subject || "Sans sujet"}</span>
                  {item.unreadCount > 0 ? <Badge tone="info">{item.unreadCount}</Badge> : null}
                </span>
                <span className="mt-1 block text-[12.5px] text-[var(--comexa-ink-muted)]">
                  {TYPE_LABEL[item.type] ?? item.type}
                  {item.lastMessageAt ? ` · ${formatDate(item.lastMessageAt)}` : ""}
                </span>
                {item.lastMessagePreview ? <span className="mt-1 block truncate text-[13px] text-[var(--comexa-ink-soft)]">{item.lastMessagePreview}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={conversation?.subject || "Fil de discussion"} action={conversation ? <button type="button" className={secondaryButton} onClick={archive}>Archiver</button> : null}>
        {!selectedId ? <Empty>Sélectionnez une conversation pour lire les messages.</Empty> : null}
        {thread.error ? <Notice>{thread.error}</Notice> : null}
        {thread.loading && !conversation ? <p className="cx-small">Chargement…</p> : null}

        {conversation ? (
          <div className="flex flex-col gap-4">
            <p className="cx-small">
              {TYPE_LABEL[conversation.type] ?? conversation.type} · Participants :{" "}
              {conversation.participants.map((p) => `${fullName(p)} (${ROLE_LABEL[p.role] ?? p.role})`).join(", ")}
            </p>

            <div className="flex max-h-[480px] min-h-[200px] flex-col gap-3 overflow-y-auto rounded-lg bg-[var(--comexa-neutral-100)] p-4">
              {thread.nextCursor ? (
                <button type="button" onClick={loadOlder} className={`${secondaryButton} self-center`}>
                  Messages plus anciens
                </button>
              ) : null}
              {thread.messages.length === 0 ? <Empty>Aucun message. Écrivez le premier.</Empty> : null}
              {thread.messages.map((message) => {
                const mine = message.senderId === user?.id;
                return (
                  <div key={message.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-[14px] ${mine ? "bg-[var(--comexa-ink)] text-white" : "bg-white text-[var(--comexa-ink)]"}`}>
                      {message.type === "SYSTEM" ? <em>{message.body}</em> : message.deletedAt ? <em>Message supprimé</em> : message.body}
                    </div>
                    <span className="mt-1 text-[12px] text-[var(--comexa-ink-muted)]">
                      {mine ? "Vous" : fullName(message.sender)} · {formatDate(message.createdAt)}
                    </span>
                  </div>
                );
              })}
            </div>

            <form onSubmit={send} className="flex flex-col gap-3">
              <Field id="message-body" label="Votre message">
                <textarea id="message-body" rows={3} maxLength={10000} value={draft} onChange={(e) => setDraft(e.target.value)} className={textareaClass} />
              </Field>
              <div>
                <button type="submit" disabled={sending || !draft.trim()} className={primaryButton}>
                  {sending ? "Envoi…" : "Envoyer"}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function NewConversation({ members, onCreated, onError }) {
  const { request } = useAuth();
  const [subject, setSubject] = useState("");
  const [type, setType] = useState("DIRECT");
  const [participantIds, setParticipantIds] = useState([]);
  const [busy, setBusy] = useState(false);

  function toggle(id) {
    setParticipantIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  async function submit(event) {
    event.preventDefault();
    if (!subject.trim()) {
      onError("Le sujet est obligatoire.");
      return;
    }
    setBusy(true);
    try {
      const { data } = await request("/conversations", {
        method: "POST",
        body: { subject: subject.trim(), type, participantIds },
      });
      setSubject("");
      setParticipantIds([]);
      onCreated(data);
    } catch (caught) {
      onError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-5 flex flex-col gap-3 rounded-lg border border-[var(--comexa-border-soft)] p-4">
      <Field id="conv-subject" label="Sujet">
        <input id="conv-subject" className={inputClass} maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field id="conv-type" label="Type">
        <select id="conv-type" className={selectClass} value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>
      {members === null ? <p className="cx-small">Chargement des membres…</p> : null}
      {members && members.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="cx-label">Participants</legend>
          {members.map((member) => (
            <label key={member.id} className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={participantIds.includes(member.id)} onChange={() => toggle(member.id)} />
              {fullName(member)}
            </label>
          ))}
        </fieldset>
      ) : null}
      <div>
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? "Création…" : "Créer la conversation"}
        </button>
      </div>
    </form>
  );
}
