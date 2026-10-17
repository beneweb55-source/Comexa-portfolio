"use client";

import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/lib/session";
import { can } from "@/lib/access";
import { formatDate, messageOf } from "@/lib/api";
import { useListing } from "@/lib/use-listing";
import { Empty, Notice } from "@/components/workspace/ui";
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
 */
export function ChatSidebar({
  selectedConversationId,
  onSelectConversation,
  onCreateConversation,
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

  return (
    <div className="flex flex-col h-full border-r border-[var(--comexa-border-soft)] bg-[var(--comexa-surface)]">
      {/* En-tête */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--comexa-border-soft)]">
        <h2 className="text-lg font-bold text-[var(--comexa-ink)]">Messages</h2>

        {/* Bouton nouvelle conversation */}
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            className="px-3 py-1.5 text-sm font-medium text-[var(--comexa-blue-500)] bg-[var(--comexa-blue-50)] rounded-lg hover:bg-[var(--comexa-blue-100)] transition-colors"
          >
            + Nouveau
          </button>
        )}
      </div>

      {/* Barre de recherche */}
      <div className="p-4 border-b border-[var(--comexa-border-soft)]">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--comexa-ink-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher une conversation..."
            className="w-full pl-10 pr-4 py-2 text-sm bg-[var(--comexa-neutral-50)] rounded-lg border border-[var(--comexa-border-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--comexa-blue-500)] focus:border-transparent transition-all"
          />
        </div>
      </div>

      {/* Filtres */}
      <div className="flex border-b border-[var(--comexa-border-soft)]">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            filter === "all"
              ? "bg-[var(--comexa-blue-50)] text-[var(--comexa-blue-500)]"
              : "text-[var(--comexa-ink-muted)] hover:bg-[var(--comexa-neutral-100)]"
          }`}
        >
          Toutes
        </button>
        <button
          type="button"
          onClick={() => setFilter("unread")}
          className={`flex-1 py-2 text-sm font-medium transition-colors relative ${
            filter === "unread"
              ? "bg-[var(--comexa-blue-50)] text-[var(--comexa-blue-500)]"
              : "text-[var(--comexa-ink-muted)] hover:bg-[var(--comexa-neutral-100)]"
          }`}
        >
          Non lues
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-[var(--comexa-blue-500)] text-white text-xs rounded-full flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setFilter("archived")}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            filter === "archived"
              ? "bg-[var(--comexa-blue-50)] text-[var(--comexa-blue-500)]"
              : "text-[var(--comexa-ink-muted)] hover:bg-[var(--comexa-neutral-100)]"
          }`}
        >
          Archivées
        </button>
      </div>

      {/* Liste des conversations */}
      <div className="flex-1 overflow-y-auto">
        {conversations.error ? (
          <div className="p-4">
            <Notice>{conversations.error}</Notice>
          </div>
        ) : null}

        {conversations.items === null && !conversations.error ? (
          <div className="p-4 text-center text-sm text-[var(--comexa-ink-muted)]">
            Chargement...
          </div>
        ) : null}

        {conversations.items !== null && visibleConversations.length === 0 ? (
          <div className="p-4">
            <Empty>
              {searchQuery
                ? "Aucune conversation ne correspond a cette recherche."
                : "Aucune conversation trouvee."}
            </Empty>
          </div>
        ) : null}

        <div className="divide-y divide-[var(--comexa-border-soft)]">
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
                className={`relative w-full p-4 text-left transition-colors hover:bg-[var(--comexa-neutral-50)] ${
                  isSelected ? "bg-[var(--comexa-blue-50)]" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar de groupe ou utilisateur */}
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--comexa-blue-100)] flex items-center justify-center text-sm font-semibold text-[var(--comexa-blue-600)]">
                    {title.charAt(0).toUpperCase() || "U"}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Ligne 1: Sujet et date */}
                    <div className="flex items-center justify-between gap-2 pr-6">
                      <span className="text-sm font-semibold text-[var(--comexa-ink)] truncate">
                        {title}
                      </span>
                      {conversation.lastMessageAt && (
                        <span className="text-xs text-[var(--comexa-ink-muted)] whitespace-nowrap">
                          {formatDate(conversation.lastMessageAt)}
                        </span>
                      )}
                    </div>

                    {/* Ligne 2: type et participants */}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-[var(--comexa-ink-muted)]">
                        {isGroup
                          ? `Groupe · ${conversation.participants?.length || 0} membres`
                          : TYPE_LABEL[conversation.type] ?? conversation.type}
                      </span>
                      {conversation.isArchived ? (
                        <span className="text-xs text-[var(--comexa-ink-subtle)]">Archivée</span>
                      ) : null}
                    </div>

                    {/* Ligne 3: dernier message */}
                    {conversation.lastMessagePreview && (
                      <p className="text-xs text-[var(--comexa-ink-subtle)] truncate mt-1">
                        {conversation.lastMessagePreview}
                      </p>
                    )}

                    {/* Badge de messages non lus */}
                    {hasUnread && (
                      <div className="absolute top-4 right-4 w-5 h-5 bg-[var(--comexa-blue-500)] text-white text-xs rounded-full flex items-center justify-center">
                        {conversation.unreadCount}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pagination */}
      {conversations.meta && conversations.meta.totalPages > 1 && (
        <div className="p-4 border-t border-[var(--comexa-border-soft)]">
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => setConversationPage((p) => Math.max(1, p - 1))}
              disabled={conversationPage <= 1}
              className="px-3 py-1 text-[var(--comexa-ink-muted)] hover:text-[var(--comexa-ink)] disabled:opacity-50"
            >
              Précédent
            </button>
            <span className="text-[var(--comexa-ink-muted)]">
              Page {conversationPage} sur {conversations.meta.totalPages}
            </span>
            <button
              type="button"
              onClick={() => setConversationPage((p) => p + 1)}
              disabled={conversationPage >= conversations.meta.totalPages}
              className="px-3 py-1 text-[var(--comexa-ink-muted)] hover:text-[var(--comexa-ink)] disabled:opacity-50"
            >
              Suivant
            </button>
          </div>
        </div>
      )}

      {/* Modal de création de conversation */}
      {creating && canCreate && (
        <NewConversationModal
          onCreated={(created) => {
            setCreating(false);
            onCreateConversation(created);
            // La nouvelle conversation doit apparaitre dans la liste.
            reload();
          }}
          onError={(text) => {
            // Afficher une erreur
            console.error("Erreur création conversation:", text);
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

/**
 * Modal de création de nouvelle conversation
 */
function NewConversationModal({ onCreated, onError, onClose }) {
  const { request, user } = useAuth();
  const canReadMembers = can(user, "user:read:any");
  const [subject, setSubject] = useState("");
  const [type, setType] = useState("DIRECT");
  const [participantIds, setParticipantIds] = useState([]);
  const [participantPage, setParticipantPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const memberPath = canReadMembers
    ? `/users?page=${participantPage}&perPage=25&status=ACTIVE${search ? `&search=${encodeURIComponent(search)}` : ""}`
    : null;
  const directory = useListing(memberPath);
  const members = (directory.items ?? []).filter((member) => member.id !== user?.id);

  function toggle(id) {
    setParticipantIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--comexa-surface)] rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-[var(--comexa-ink)]">Nouvelle conversation</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[var(--comexa-neutral-100)] transition-colors"
          >
            <svg className="w-5 h-5 text-[var(--comexa-ink-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--comexa-ink)] mb-1">Sujet</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              className="w-full px-3 py-2 text-sm bg-[var(--comexa-neutral-50)] rounded-lg border border-[var(--comexa-border-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--comexa-blue-500)] transition-all"
              placeholder="Sujet de la conversation"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--comexa-ink)] mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--comexa-neutral-50)] rounded-lg border border-[var(--comexa-border-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--comexa-blue-500)] transition-all"
            >
              <option value="DIRECT">Direct</option>
              <option value="PROJECT">Projet</option>
              <option value="CLIENT">Client</option>
              <option value="SUPPORT">Support</option>
            </select>
          </div>

          {!canReadMembers ? (
            <Notice>Vous serez ajouté automatiquement comme participant.</Notice>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-[var(--comexa-ink)] mb-1">Rechercher des participants</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
                    placeholder="Nom ou adresse e-mail"
                    className="flex-1 px-3 py-2 text-sm bg-[var(--comexa-neutral-50)] rounded-lg border border-[var(--comexa-border-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--comexa-blue-500)] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => { setSearch(searchDraft.trim()); setParticipantPage(1); }}
                    className="px-3 py-2 text-sm font-medium text-[var(--comexa-blue-500)] bg-[var(--comexa-blue-50)] rounded-lg hover:bg-[var(--comexa-blue-100)] transition-colors"
                  >
                    Rechercher
                  </button>
                </div>
              </div>

              {directory.error ? (
                <Notice>{directory.error}</Notice>
              ) : null}

              {directory.items === null && !directory.error ? (
                <p className="text-sm text-[var(--comexa-ink-muted)]">Chargement des membres...</p>
              ) : null}

              {directory.items !== null && !directory.error && members.length === 0 ? (
                <p className="text-sm text-[var(--comexa-ink-muted)]">Aucun participant trouvé.</p>
              ) : null}

              {members.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-[var(--comexa-ink)] mb-2">Participants</label>
                  <div className="max-h-40 overflow-y-auto border border-[var(--comexa-border-soft)] rounded-lg p-2 bg-[var(--comexa-neutral-50)]">
                    {members.map((member) => (
                      <label key={member.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--comexa-white)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={participantIds.includes(member.id)}
                          onChange={() => toggle(member.id)}
                          className="rounded border-[var(--comexa-border-soft)] text-[var(--comexa-blue-500)] focus:ring-[var(--comexa-blue-500)]"
                        />
                        <span className="text-sm text-[var(--comexa-ink)]">
                          {`${member.firstName || ""} ${member.lastName || ""}`.trim() || member.email}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-[var(--comexa-border-soft)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-[var(--comexa-ink-muted)] bg-[var(--comexa-neutral-100)] rounded-lg hover:bg-[var(--comexa-neutral-200)] transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={busy || !subject.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-[var(--comexa-blue-500)] rounded-lg hover:bg-[var(--comexa-blue-600)] disabled:bg-[var(--comexa-neutral-300)] disabled:cursor-not-allowed transition-colors"
            >
              {busy ? "Création..." : "Créer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ChatSidebar;
