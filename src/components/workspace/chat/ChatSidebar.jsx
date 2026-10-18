"use client";

import { useState, useCallback, useEffect } from "react";
import { Plus, Search } from "lucide-react";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { formatDate, messageOf } from "@/lib/api";
import { useListing } from "@/lib/use-listing";
import { Empty, Notice, primaryButton, secondaryButton } from "@/components/workspace/ui";
import { conversationTitle, isGroupConversation, participantName } from "@/lib/conversation-labels";

/**
 * Barre laterale du chat : la liste des conversations du porteur.
 *
 * DEUX REGLES TIENTENT CETTE LISTE.
 *
 * 1. L'API n'accepte que `page`, `perPage` et `includeArchived` : tout autre
 *    parametre fait echouer la requete (400), et la liste entiere disparait.
 *    La recherche et le filtre « non lues » se font donc ICI, sur la page
 *    chargee — pas cote serveur.
 * 2. La liste ne se recharge que lorsqu'il le faut. Un rechargement declenche
 *    par un changement d'identite de l'objet `conversations` (qui change a
 *    chaque rendu) relancerait une requete a chaque rendu, sans fin.
 *
 * Habillage : design system « soft UI pastel dans une coque noire ».
 */
export function ChatSidebar({
  selectedConversationId,
  onSelectConversation,
  onCreateConversation,
  className = "",
}) {
  const { request, user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all, unread, archived
  const [creating, setCreating] = useState(false);
  const [conversationPage, setConversationPage] = useState(1);

  const canCreate = can(user, "conversation:create:own");

  // Seuls `page`, `perPage` et `includeArchived` sont acceptes par l'API.
  const conversations = useListing(
    `/conversations?page=${conversationPage}&perPage=50${filter === "archived" ? "&includeArchived=true" : ""}`,
  );
  const { reload } = conversations;

  // Recharger apres selection : la liste contient le compteur de non-lus, qui
  // doit repasser a zero une fois la conversation ouverte.
  useEffect(() => {
    if (selectedConversationId) {
      reload();
    }
    // `reload` est stable tant que le chemin ne change pas : l'inclure evite
    // de reconstruire la liste a chaque rendu.
  }, [selectedConversationId, reload]);

  // Gestion de la selection : le panneau attend un IDENTIFIANT de conversation.
  const handleSelect = useCallback(
    (conversation) => {
      onSelectConversation(conversation.id);

      // Marquer comme lu (l'echec n'empeche pas l'ouverture du fil).
      if (conversation.unreadCount > 0) {
        request(`/conversations/${conversation.id}/read`, { method: "POST" }).catch(() => null);
      }
    },
    [onSelectConversation, request],
  );

  // Filtres appliques a la page chargee (voir la regle 1 ci-dessus).
  const visibleConversations = (conversations.items ?? []).filter((conversation) => {
    if (filter === "unread" && !(conversation.unreadCount > 0)) return false;
    if (filter === "archived" && !conversation.isArchived) return false;

    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return true;
    const haystack = [
      conversation.subject ?? "",
      conversation.lastMessagePreview ?? "",
      ...(conversation.participants ?? []).map((participant) => participantName(participant)),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });

  // Compter les conversations non lues de la page chargee.
  const unreadCount = (conversations.items ?? []).reduce(
    (sum, conversation) => sum + (conversation.unreadCount || 0),
    0,
  );

  const TYPE_LABEL = { DIRECT: "Direct", PROJECT: "Projet", CLIENT: "Client", SUPPORT: "Support" };
  const FILTERS = [
    { id: "all", label: "Toutes" },
    { id: "unread", label: "Non lues", count: unreadCount },
    { id: "archived", label: "Archivées" },
  ];

  return (
    <div className={`sui-chat__aside ${className}`.trim()}>
      {/* En-tête : titre de la colonne + action principale (un seul bouton noir). */}
      <div className="sui-chat__aside-head">
        <h2 className="sui-section__title">Conversations</h2>
        {canCreate ? (
          <button type="button" className={`${primaryButton} sui-btn--sm`} onClick={() => setCreating((value) => !value)}>
            <Plus size={15} strokeWidth={2} aria-hidden="true" /> Nouvelle
          </button>
        ) : null}
      </div>

      {/* Recherche et filtres, sur le fond de panneau. */}
      <div className="sui-chat__tools">
        <label className="sui-search">
          <Search size={17} strokeWidth={1.75} aria-hidden="true" />
          <span className="sui-visually-hidden">Rechercher une conversation</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Rechercher…"
          />
        </label>
        <div className="sui-chat__filters">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="sui-pill"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              {item.count ? <span className="sui-pill__count">{item.count}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {/* Liste des conversations */}
      <div className="sui-chat__list">
        {conversations.error ? (
          <div className="p-4">
            <Notice>{conversations.error}</Notice>
          </div>
        ) : null}

        {conversations.items === null && !conversations.error ? (
          <p className="sui-card__desc" style={{ padding: 18 }}>Chargement des conversations…</p>
        ) : null}

        {conversations.items !== null && visibleConversations.length === 0 ? (
          <div className="p-4">
            <Empty>
              {searchQuery
                ? "Aucune conversation ne correspond à cette recherche."
                : "Aucune conversation trouvée."}
            </Empty>
          </div>
        ) : null}

        {visibleConversations.map((conversation) => {
          const isSelected = conversation.id === selectedConversationId;
          const hasUnread = conversation.unreadCount > 0;
          const isGroup = isGroupConversation(conversation);
          const title = conversationTitle(conversation, user?.id);

          return (
            <button
              key={conversation.id}
              type="button"
              onClick={() => handleSelect(conversation)}
              className={`sui-chat__row${isSelected ? " sui-chat__row--active" : ""}`}
              aria-current={isSelected ? "true" : undefined}
            >
              <span className="sui-chat__avatar" aria-hidden="true">
                {title.charAt(0).toUpperCase() || "U"}
              </span>

              <span className="sui-chat__meta">
                <span className="sui-chat__top">
                  <span className="sui-chat__title">{title}</span>
                  {conversation.lastMessageAt ? (
                    <span className="sui-chat__time">{formatDate(conversation.lastMessageAt)}</span>
                  ) : null}
                </span>
                <span className="sui-chat__preview">
                  {isGroup
                    ? `Groupe · ${conversation.participants?.length || 0} membres`
                    : TYPE_LABEL[conversation.type] ?? conversation.type}
                  {conversation.isArchived ? " · archivée" : ""}
                </span>
                {conversation.lastMessagePreview ? (
                  <span className="sui-chat__preview">{conversation.lastMessagePreview}</span>
                ) : null}
              </span>

              {hasUnread ? (
                <span className="sui-chat__unread" aria-label={`${conversation.unreadCount} messages non lus`}>
                  {conversation.unreadCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Pagination */}
      {conversations.meta && conversations.meta.totalPages > 1 ? (
        <div className="sui-chat__foot">
          <button
            type="button"
            className={`${secondaryButton} sui-btn--sm`}
            onClick={() => setConversationPage((page) => Math.max(1, page - 1))}
            disabled={conversationPage <= 1}
          >
            Précédent
          </button>
          <span>
            Page {conversationPage} sur {conversations.meta.totalPages}
          </span>
          <button
            type="button"
            className={`${secondaryButton} sui-btn--sm`}
            onClick={() => setConversationPage((page) => page + 1)}
            disabled={conversationPage >= conversations.meta.totalPages}
          >
            Suivant
          </button>
        </div>
      ) : null}

      {/* Formulaire de création de conversation */}
      {creating && canCreate ? (
        <NewConversationForm
          onCreated={(created) => {
            setCreating(false);
            onCreateConversation(created);
            // La nouvelle conversation doit apparaitre dans la liste.
            reload();
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Création d'une conversation. Dans un tiroir latéral plutôt qu'une modale
 * posée sur la liste : la liste reste visible, on voit ce qu'on vient de créer.
 */
function NewConversationForm({ onCreated, onClose }) {
  const { request, user } = useAuth();
  const canReadMembers = can(user, "user:read:any");
  const [subject, setSubject] = useState("");
  const [type, setType] = useState("DIRECT");
  const [participantIds, setParticipantIds] = useState([]);
  const [participantPage, setParticipantPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const memberPath = canReadMembers
    ? `/users?page=${participantPage}&perPage=25&status=ACTIVE${search ? `&search=${encodeURIComponent(search)}` : ""}`
    : null;
  const directory = useListing(memberPath);
  const members = (directory.items ?? []).filter((member) => member.id !== user?.id);

  function toggle(id) {
    setParticipantIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  async function submit(event) {
    event.preventDefault();
    if (!subject.trim()) {
      setError("Le sujet est obligatoire.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { data } = await request("/conversations", {
        method: "POST",
        body: { subject: subject.trim(), type, participantIds },
      });
      setSubject("");
      setParticipantIds([]);
      onCreated(data);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="sui-chat__new">
      <div className="sui-chat__aside-head">
        <h3 className="sui-section__title">Nouvelle conversation</h3>
        <button type="button" className="sui-iconbtn sui-iconbtn--ghost" onClick={onClose} aria-label="Annuler">
          <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>×</span>
        </button>
      </div>

      <div className="sui-form">
        {error ? <Notice>{error}</Notice> : null}

        <div className="sui-field">
          <label htmlFor="chat-new-subject" className="sui-field__label">Sujet</label>
          <input
            id="chat-new-subject"
            type="text"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={200}
            className="sui-input"
            placeholder="Sujet de la conversation"
          />
        </div>

        <div className="sui-field">
          <label htmlFor="chat-new-type" className="sui-field__label">Type</label>
          <select id="chat-new-type" value={type} onChange={(event) => setType(event.target.value)} className="sui-input">
            <option value="DIRECT">Direct</option>
            <option value="PROJECT">Projet</option>
            <option value="CLIENT">Client</option>
            <option value="SUPPORT">Support</option>
          </select>
        </div>

        {!canReadMembers ? (
          <Notice tone="info">Vous serez ajouté automatiquement comme participant.</Notice>
        ) : (
          <>
            <div className="sui-field">
              <label htmlFor="chat-new-search" className="sui-field__label">Rechercher des participants</label>
              <div className="flex gap-2">
                <input
                  id="chat-new-search"
                  type="search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
                  placeholder="Nom ou adresse e-mail"
                  className="sui-input"
                />
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => { setSearch(searchDraft.trim()); setParticipantPage(1); }}
                >
                  Rechercher
                </button>
              </div>
            </div>

            {directory.error ? <Notice>{directory.error}</Notice> : null}
            {directory.items === null && !directory.error ? (
              <p className="sui-card__desc">Chargement des membres…</p>
            ) : null}
            {directory.items !== null && !directory.error && members.length === 0 ? (
              <p className="sui-card__desc">Aucun participant trouvé.</p>
            ) : null}

            {members.length > 0 ? (
              <fieldset className="sui-fieldset">
                <legend className="sui-field__label">Participants</legend>
                <div className="sui-chat__members">
                  {members.map((member) => (
                    <label key={member.id} className="sui-check">
                      <input
                        type="checkbox"
                        checked={participantIds.includes(member.id)}
                        onChange={() => toggle(member.id)}
                      />
                      {`${member.firstName || ""} ${member.lastName || ""}`.trim() || member.email}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={onClose}>Annuler</button>
          <button type="submit" disabled={busy || !subject.trim()} className={primaryButton}>
            {busy ? "Création…" : "Créer la conversation"}
          </button>
        </div>
      </div>
    </form>
  );
}

export default ChatSidebar;
