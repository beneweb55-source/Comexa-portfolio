"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/dashboard/icons";
import { messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";

/**
 * CONSOLE COMEXA — panneau de pilotage conversationnel.
 *
 * L'outil s'appelle « Console Comexa » et non « assistant IA » : c'est un
 * poste de commande qui interroge les donnees de l'agence (projets, agenda,
 * CRM, facturation) et propose des operations que l'utilisateur confirme.
 * Aucun emoji, aucune paillette : des pictogrammes en trait fin (voir
 * `components/dashboard/icons.jsx`) et un monogramme `CX` pour les reponses
 * du systeme.
 *
 * Les messages passent par la route Next.js `/api/agent-chat`, qui relaie vers
 * le webhook n8n avec le JWT de session : l'agent agit donc avec les droits de
 * la personne connectee. L'historique vit en memoire (par onglet) et une
 * `sessionId` stable est generee a la premiere ouverture.
 */

/** Deux largeurs : lecture a cote du travail, ou bilan d'agence a l'aise. */
const PANEL_WIDTHS = { side: 440, wide: 760 };

/** Hauteur maximum du champ de saisie avant qu'il ne defile. */
const COMPOSER_MAX_HEIGHT = 200;

const CATEGORIES = [
  {
    id: "pilotage",
    label: "Pilotage",
    icon: "chart",
    prompts: [
      "Bilan de l’agence ce mois-ci",
      "Charge de l’équipe cette semaine",
      "Projets en retard et risques à remonter",
    ],
  },
  {
    id: "projets",
    label: "Projets & Tâches",
    icon: "folder",
    prompts: [
      "Mes tâches en cours, par échéance",
      "Avancement des projets actifs",
      "Tâches à livrer cette semaine",
    ],
  },
  {
    id: "agenda",
    label: "Agenda",
    icon: "calendar",
    prompts: [
      "Mon agenda d’aujourd’hui",
      "Mes prochains événements",
      "Réunions de l’équipe cette semaine",
    ],
  },
  {
    id: "crm",
    label: "CRM & Factures",
    icon: "invoice",
    prompts: [
      "Factures impayées et relances à prévoir",
      "Devis en attente de réponse",
      "Chiffre d’affaires encaissé ce mois-ci",
    ],
  },
];

const SHORTCUT_LABEL = "Alt+C";

/**
 * References metier et montants : on les reconnait pour les afficher en
 * badges, jamais en texte brut perdu au milieu d'une phrase.
 */
const INLINE_PATTERN = new RegExp(
  [
    "(\\*\\*[^*]+\\*\\*)", // **gras**
    "(`[^`]+`)", // `code`
    "(\\[[^\\]]+\\]\\([^)]+\\))", // [libelle](url)
    "(\\b(?:PRJ|FAC|DEV|PRO|TCH|CLI)-[A-Za-z0-9][A-Za-z0-9_-]*)", // references metier
    "((?:(?:€|\\$|EUR|USD|DZD|DA)\\s?)?\\d[\\d\\s  .,]*\\s?(?:€|\\$|EUR|USD|DZD|DA))", // montants
    "(\\*[^*\\n]+\\*|_[^_\\n]+_)", // *italique*
  ].join("|"),
  "g",
);

/** `/confirmer <id>` : uuid complet ou identifiant opaque d'au moins 6 caracteres. */
const CONFIRM_PATTERN =
  /\/confirmer\s+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9_-]{6,})/;

const TABLE_SEPARATOR = /^:?-{2,}:?$/;

function genId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function genSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function timestamp(date = new Date()) {
  return new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" }).format(date);
}

// ---------------------------------------------------------------------------
// Rendu du texte : jamais de syntaxe Markdown brute a l'ecran.
// ---------------------------------------------------------------------------

function renderInline(text, keyPrefix) {
  const source = String(text ?? "");
  const nodes = [];
  let cursor = 0;
  let index = 0;

  for (const match of source.matchAll(INLINE_PATTERN)) {
    const [raw, bold, code, link, reference, amount, italic] = match;
    const start = match.index ?? 0;

    if (start > cursor) nodes.push(source.slice(cursor, start));
    const key = `${keyPrefix}-${index}`;
    index += 1;

    if (bold) {
      nodes.push(
        <strong key={key} className="cx-console-strong">
          {renderInline(bold.slice(2, -2), `${key}b`)}
        </strong>,
      );
    } else if (code) {
      nodes.push(
        <code key={key} className="cx-console-code">
          {code.slice(1, -1)}
        </code>,
      );
    } else if (link) {
      const parsed = link.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      nodes.push(
        <a key={key} className="cx-console-link" href={parsed?.[2] ?? "#"} target="_blank" rel="noreferrer noopener">
          {parsed?.[1] ?? link}
        </a>,
      );
    } else if (reference) {
      nodes.push(
        <span key={key} className="cx-console-ref">
          {reference}
        </span>,
      );
    } else if (amount) {
      nodes.push(
        <span key={key} className="cx-console-amount">
          {amount}
        </span>,
      );
    } else if (italic) {
      nodes.push(<em key={key}>{renderInline(italic.slice(1, -1), `${key}i`)}</em>);
    } else {
      nodes.push(raw);
    }

    cursor = start + raw.length;
  }

  if (cursor < source.length) nodes.push(source.slice(cursor));
  return nodes;
}

function flushParagraph(blocks, lines, key) {
  if (lines.length === 0) return;
  blocks.push({ kind: "paragraph", text: lines.join("\n"), key: `p${key}` });
  lines.length = 0;
}

/** Decoupe une reponse en blocs lisibles : titres, listes, tableaux, paragraphes. */
function parseBlocks(source) {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;
  let table = null;

  const flushAll = (index) => {
    flushParagraph(blocks, paragraph, index);
    if (list) {
      blocks.push(list);
      list = null;
    }
    if (table) {
      blocks.push(table);
      table = null;
    }
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd();

    // Separateur horizontal : `---`, `***`, `___`.
    if (/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
      flushAll(index);
      blocks.push({ kind: "rule", key: `r${index}` });
      return;
    }

    // Ligne de tableau Markdown : `| A | B |`.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph(blocks, paragraph, index);
      if (list) {
        blocks.push(list);
        list = null;
      }
      const cells = line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
      const isSeparator = cells.every((cell) => TABLE_SEPARATOR.test(cell));
      if (isSeparator) return;
      if (!table) table = { kind: "table", header: null, rows: [], key: `t${index}` };
      if (!table.header) table.header = cells;
      else table.rows.push(cells);
      return;
    }

    flushAll(index);

    if (line.trim() === "") return;

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: Math.min(3, heading[1].length), text: heading[2].trim(), key: `h${index}` });
      return;
    }

    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      if (!list || list.ordered) {
        list = { kind: "list", ordered: false, items: [], key: `l${index}` };
      }
      list.items.push(bullet[1].trim());
      return;
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      if (!list || !list.ordered) {
        list = { kind: "list", ordered: true, items: [], key: `l${index}` };
      }
      list.items.push(numbered[1].trim());
      return;
    }

    paragraph.push(line.trim());
  });

  flushAll(lines.length);
  if (list) blocks.push(list);
  if (table) blocks.push(table);
  return blocks;
}

function MessageContent({ content }) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  if (blocks.length === 0) return null;

  return (
    <div className="cx-console-md">
      {blocks.map((block) => {
        if (block.kind === "heading") {
          const Tag = block.level === 1 ? "h4" : block.level === 2 ? "h5" : "h6";
          return (
            <Tag key={block.key} className="cx-console-md__title">
              {renderInline(block.text, block.key)}
            </Tag>
          );
        }

        if (block.kind === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={block.key} className="cx-console-md__list">
              {block.items.map((item, itemIndex) => (
                <li key={`${block.key}-${itemIndex}`}>{renderInline(item, `${block.key}-${itemIndex}`)}</li>
              ))}
            </Tag>
          );
        }

        if (block.kind === "table") {
          return (
            <div key={block.key} className="cx-console-md__table-wrap">
              <table className="cx-console-md__table">
                {block.header ? (
                  <thead>
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th key={`${block.key}-h-${cellIndex}`} scope="col">
                          {renderInline(cell, `${block.key}-h-${cellIndex}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                ) : null}
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${block.key}-r-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${block.key}-r-${rowIndex}-${cellIndex}`}>
                          {renderInline(cell, `${block.key}-r-${rowIndex}-${cellIndex}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.kind === "rule") return <hr key={block.key} className="cx-console-md__rule" />;

        return (
          <p key={block.key} className="cx-console-md__text">
            {renderInline(block.text, block.key)}
          </p>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detection des operations a confirmer.
// ---------------------------------------------------------------------------

/**
 * Une operation a confirmer peut venir de deux endroits : la reponse elle-meme
 * (`/confirmer <id>`) ou le champ `proposedAction` renvoye par l'API. Dans les
 * deux cas on garde l'identifiant ; l'utilisateur n'a jamais a le retaper.
 */
function extractOperation(content, data) {
  const proposed = data?.proposedAction ?? data?.action ?? null;
  const proposedId = typeof proposed === "string" ? proposed : (proposed?.actionId ?? proposed?.id ?? null);
  if (typeof proposedId === "string" && proposedId.length > 0) {
    return { id: proposedId, label: proposed?.label ?? proposed?.description ?? null };
  }

  const match = typeof content === "string" ? content.match(CONFIRM_PATTERN) : null;
  if (!match) return null;
  const id = match[1];
  // `/confirmer <uuid>` est un MODELE donne en exemple, pas un identifiant reel.
  if (!id || id.startsWith("<")) return null;

  return { id, label: describeOperation(content, match[0]) };
}

/** Phrase qui accompagne la commande : elle decrit l'operation en clair. */
function describeOperation(content, command) {
  const lines = String(content ?? "").split("\n");
  const line = lines.find((candidate) => candidate.includes(command)) ?? "";
  const cleaned = line.replace(command, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 4) return null;
  return cleaned.length > 220 ? `${cleaned.slice(0, 217).trimEnd()}…` : cleaned;
}

function OperationCard({ operation, state, busy, onConfirm, onCancel }) {
  const settled = state === "confirmed" || state === "cancelled";

  return (
    <div className={`cx-console-op${settled ? ` cx-console-op--${state}` : ""}`}>
      <div className="cx-console-op__head">
        <Icon name="shield" className="h-4 w-4" />
        <span className="cx-console-op__title">Opération à valider</span>
      </div>

      {operation.label ? (
        <div className="cx-console-op__label">
          <MessageContent content={operation.label} />
        </div>
      ) : null}

      <p className="cx-console-op__id">
        Référence <code>{operation.id}</code>
      </p>

      {settled ? (
        <p className="cx-console-op__state">
          <Icon name="check" className="h-4 w-4" />
          {state === "confirmed" ? "Opération confirmée" : "Opération annulée"}
        </p>
      ) : (
        <div className="cx-console-op__actions">
          <button
            type="button"
            className="cx-console-btn cx-console-btn--primary"
            onClick={onConfirm}
            disabled={busy}
          >
            Confirmer l’exécution
          </button>
          <button type="button" className="cx-console-btn cx-console-btn--outline" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panneau.
// ---------------------------------------------------------------------------

function CategoryTabs({ onPick, busy, compact }) {
  const [active, setActive] = useState(CATEGORIES[0].id);
  const category = CATEGORIES.find((item) => item.id === active) ?? CATEGORIES[0];

  return (
    <div className={compact ? "cx-console-suggest cx-console-suggest--compact" : "cx-console-suggest"}>
      <div className="cx-console-suggest__tabs" role="tablist" aria-label="Catégories de commandes">
        {CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === active}
            className={`cx-console-tab${item.id === active ? " is-active" : ""}`}
            onClick={() => setActive(item.id)}
          >
            <Icon name={item.icon} className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </div>
      <div className="cx-console-suggest__list">
        {category.prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="cx-console-suggestion"
            onClick={() => onPick(prompt)}
            disabled={busy}
          >
            <span className="cx-console-suggestion__text">{prompt}</span>
            <Icon name="chevron-right" className="h-4 w-4" />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * `/lier <code>` est une commande du BOT TELEGRAM @ComexaWork_bot : elle associe
 * un compte Telegram au compte Comexa. Tapée ici, elle partait vers l'agent
 * conversationnel, qui ne pouvait que répondre qu'il ne comprenait pas. La
 * Console l'intercepte désormais et explique où l'envoyer — sans rien lier :
 * depuis le navigateur, aucun identifiant Telegram n'est connu.
 */
const LINK_COMMAND = /^\/lier(?:@\w+)?(?:\s|$)/i;

function linkCommandGuidance() {
  return [
    "La commande **/lier** s’envoie au bot Telegram **@ComexaWork_bot**, pas à la Console.",
    "",
    "1. Ouvrez **Mon compte › Bot Telegram** dans Comexa et générez un code (valable 10 minutes).",
    "2. Dans Telegram, ouvrez une conversation **privée** avec @ComexaWork_bot.",
    "3. Envoyez exactement : `/lier 123456` (avec votre code).",
    "",
    "Le bot confirme la liaison ; la page Mon compte affiche alors « Lié ».",
  ].join("\n");
}

export default function AiAgentDrawer({ showLauncher = true }) {
  const { request } = useAuth();
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lastPrompt, setLastPrompt] = useState(null);
  const [sessionId, setSessionId] = useState(genSessionId);
  const [messages, setMessages] = useState([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  const endRef = useRef(null);
  const inputRef = useRef(null);
  // Session courante : une réponse arrivée après « Nouvelle session » est
  // ignorée au lieu d'apparaître dans la conversation suivante.
  const sessionRef = useRef(sessionId);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [open]);

  // Raccourcis : Alt+C ou Ctrl/Cmd+J pour ouvrir ou fermer, Échap pour fermer,
  // ainsi que l'événement personnalisé `comexa:open-ai-console` depuis la barre ou la palette ⌘K.
  useEffect(() => {
    function onKeyDown(event) {
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      const meta = event.ctrlKey || event.metaKey;
      if (meta && key === "j") {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (event.altKey && key === "c") {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (event.key === "Escape") setOpen(false);
    }

    function onOpenEvent() {
      setOpen(true);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("comexa:open-ai-console", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("comexa:open-ai-console", onOpenEvent);
    };
  }, []);

  // Le panneau descend toujours sur le dernier message : sans cela, une
  // reponse longue arrive hors champ et l'utilisateur croit que rien ne vient.
  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy, open, wide, suggestOpen]);

  // Chronometre d'execution : rend l'attente visible et datée.
  useEffect(() => {
    if (!busy || startedAt === null) return undefined;
    const timer = setInterval(() => setElapsed(Math.max(0, Math.round((Date.now() - startedAt) / 1000))), 500);
    return () => clearInterval(timer);
  }, [busy, startedAt]);

  function autoGrow() {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }

  useEffect(autoGrow, [draft, open]);

  function patchMessage(id, patch) {
    setMessages((current) => current.map((message) => (message.id === id ? { ...message, ...patch } : message)));
  }

  const send = useCallback(
    async (text, { actionId } = {}) => {
      const content = (text ?? draft).trim();
      if (!content || busy) return;

      if (LINK_COMMAND.test(content)) {
        setError(null);
        setSuggestOpen(false);
        setDraft("");
        setMessages((current) => [
          ...current,
          { id: genId(), role: "user", content, ts: timestamp() },
          { id: genId(), role: "assistant", content: linkCommandGuidance(), ts: timestamp(), operation: null, operationState: null },
        ]);
        return;
      }

      const sessionAtSend = sessionRef.current;
      setError(null);
      setBusy(true);
      setElapsed(0);
      setStartedAt(Date.now());
      setSuggestOpen(false);
      setLastPrompt(content);

      const userMessage = { id: genId(), role: "user", content, ts: timestamp() };
      setMessages((current) => [...current, userMessage]);
      setDraft("");

      try {
        // La route `/api/agent-chat` est un fichier App Router : elle passe
        // devant la réécriture vers le backend.
        const { data } = await request("/agent-chat", {
          method: "POST",
          body: {
            chatInput: content,
            sessionId: sessionId ?? genSessionId(),
            ...(actionId ? { actionId } : {}),
          },
        });

        if (sessionRef.current !== sessionAtSend) return;
        const payload = Array.isArray(data) ? data[0] : data;
        const reply =
          typeof payload === "string"
            ? payload
            : (payload?.reply ??
              payload?.output ??
              payload?.message ??
              payload?.text ??
              (payload ? JSON.stringify(payload) : "La Console n’a renvoyé aucune réponse exploitable."));

        const operation = extractOperation(reply, payload);

        setMessages((current) => [
          ...current,
          {
            id: genId(),
            role: "assistant",
            content: String(reply),
            ts: timestamp(),
            operation,
            operationState: operation ? "pending" : null,
          },
        ]);
      } catch (caught) {
        if (sessionRef.current !== sessionAtSend) return;
        const text = messageOf(caught) || "La Console n’a pas pu répondre.";
        setError(text);
        setMessages((current) => [...current, { id: genId(), role: "error", content: text, ts: timestamp() }]);
      } finally {
        setBusy(false);
        setStartedAt(null);
        setElapsed(0);
      }
    },
    [busy, draft, request, sessionId],
  );

  function onSubmit(event) {
    event.preventDefault();
    send();
  }

  function onKeyDown(event) {
    // Entrée envoie, Maj+Entrée va à la ligne : le réflexe des messageries
    // professionnelles. `nativeEvent.isComposing` évite d'envoyer en pleine
    // saisie d'un accent ou d'un caractère composé.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function newSession() {
    const next = genSessionId();
    sessionRef.current = next;
    setMessages([]);
    setError(null);
    setDraft("");
    setLastPrompt(null);
    setSessionId(next);
    setSuggestOpen(false);
    setBusy(false);
    setStartedAt(null);
    setElapsed(0);
    inputRef.current?.focus();
  }

  function confirmOperation(message) {
    if (!message.operation || busy) return;
    patchMessage(message.id, { operationState: "confirmed" });
    send(`/confirmer ${message.operation.id}`);
  }

  function cancelOperation(message) {
    if (!message.operation || busy) return;
    patchMessage(message.id, { operationState: "cancelled" });
    send(`/annuler ${message.operation.id}`);
  }

  const panelWidth = wide ? PANEL_WIDTHS.wide : PANEL_WIDTHS.side;
  const hasMessages = messages.length > 0;

  return (
    <>
      {/* Bouton d'ouverture flottant, sauf quand la coque l'intègre au dock.
          Raccourcis réels : Alt+C et Ctrl/Cmd+J (Ctrl+K ouvre la recherche). */}
      {showLauncher ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="cx-console-launcher"
          aria-label="Ouvrir la Console Comexa"
          aria-keyshortcuts="Alt+C Control+J"
        >
          <Icon name="terminal" className="h-[18px] w-[18px]" />
          <span className="cx-console-launcher__label">Console Comexa</span>
          <kbd className="cx-console-launcher__kbd">{SHORTCUT_LABEL}</kbd>
        </button>
      ) : null}

      {open ? (
        <div className="cx-console">
          <div className="cx-console__scrim" onClick={() => setOpen(false)} aria-hidden="true" />

          <aside
            className="cx-console__panel"
            style={{ "--console-width": `${panelWidth}px` }}
            role="dialog"
            aria-modal="true"
            aria-label="Console Comexa"
          >
            <header className="cx-console__header">
              <span className="cx-console__monogram" aria-hidden="true">
                CX
              </span>
              <div className="cx-console__identity">
                <h3 className="cx-console__title">Console Comexa</h3>
                <p className="cx-console__subtitle"><span className="cx-console__presence" aria-hidden="true" />Votre espace de travail, assisté par IA</p>
              </div>

              <div className="cx-console__tools">
                <button
                  type="button"
                  className="cx-console__icon-btn"
                  onClick={() => setWide((value) => !value)}
                  aria-pressed={wide}
                  title={wide ? "Revenir à la vue latérale (440 px)" : "Passer en vue large (760 px)"}
                >
                  <Icon name={wide ? "collapse" : "expand"} className="h-[18px] w-[18px]" />
                  <span className="sr-only">{wide ? "Réduire le panneau" : "Élargir le panneau"}</span>
                </button>
                <button
                  type="button"
                  className="cx-console__icon-btn"
                  onClick={newSession}
                  disabled={busy || !hasMessages}
                  title="Effacer la conversation et ouvrir une nouvelle session"
                >
                  <Icon name="trash" className="h-[18px] w-[18px]" />
                  <span className="sr-only">Effacer / Nouvelle session</span>
                </button>
                <button type="button" className="cx-console__icon-btn" onClick={() => setOpen(false)} title="Fermer">
                  <Icon name="close" className="h-[18px] w-[18px]" />
                  <span className="sr-only">Fermer la Console</span>
                </button>
              </div>
            </header>

            <div className="cx-console__body">
              {!hasMessages ? (
                <div className="cx-console__welcome">
                  <span className="cx-console__monogram cx-console__monogram--lg" aria-hidden="true">
                    CX
                  </span>
                  <span className="cx-console__eyebrow">Un peu de clarté dans votre journée</span>
                  <h4 className="cx-console__welcome-title">Comment puis-je vous aider ?</h4>
                  <p className="cx-console__welcome-text">
                    Projets, tâches, agenda… demandez simplement.
                    Toute modification vous sera proposée pour confirmation.
                  </p>
                  <div className="cx-console__starters" aria-label="Suggestions pour commencer">
                    <button type="button" className="cx-console__starter" disabled={busy} onClick={() => send("Mes tâches en cours, par échéance")}>
                      <span className="cx-console__starter-icon"><Icon name="folder" className="h-[18px] w-[18px]" /></span>
                      <span><strong>Faire le point</strong><small>Mes tâches et priorités</small></span>
                      <Icon name="send" className="h-4 w-4" />
                    </button>
                    <button type="button" className="cx-console__starter" disabled={busy} onClick={() => send("Mon agenda d’aujourd’hui")}>
                      <span className="cx-console__starter-icon"><Icon name="calendar" className="h-[18px] w-[18px]" /></span>
                      <span><strong>Organiser ma journée</strong><small>Mon agenda en un regard</small></span>
                      <Icon name="send" className="h-4 w-4" />
                    </button>
                  </div>
                  <details className="cx-console__commands">
                    <summary>Explorer les commandes</summary>
                    <CategoryTabs onPick={send} busy={busy} />
                  </details>
                </div>
              ) : (
                <ul className="cx-console__messages">
                  {messages.map((message, index) => {
                    const isUser = message.role === "user";
                    const isError = message.role === "error";
                    const isSystem = message.role === "system";
                    const isLast = index === messages.length - 1;

                    return (
                      <li
                        key={message.id}
                        className={[
                          "cx-console-row",
                          isUser ? "cx-console-row--user" : "cx-console-row--agent",
                          isError ? "cx-console-row--error" : "",
                          isSystem ? "cx-console-row--system" : "",
                          isLast && !isUser ? "is-latest" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span className="cx-console-row__avatar" aria-hidden="true">
                          {isUser ? <Icon name="user" className="h-4 w-4" /> : "CX"}
                        </span>

                        <div className="cx-console-row__content">
                          <div className="cx-console-row__meta">
                            <span className="cx-console-row__author">
                              {isUser ? "Vous" : isError ? "Incident" : isSystem ? "Console" : "Console Comexa"}
                            </span>
                            <span className="cx-console-row__time">{message.ts}</span>
                          </div>

                          <div className="cx-console-row__bubble">
                            {isError ? (
                              <p className="cx-console-row__text">{message.content}</p>
                            ) : (
                              <MessageContent content={message.content} />
                            )}

                            {message.operation ? (
                              <OperationCard
                                operation={message.operation}
                                state={message.operationState}
                                busy={busy}
                                onConfirm={() => confirmOperation(message)}
                                onCancel={() => cancelOperation(message)}
                              />
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}

                  {/* L'attente est explicite : la Console travaille, on le voit. */}
                  {busy ? (
                    <li className="cx-console-row cx-console-row--agent cx-console-row--thinking" aria-live="polite">
                      <span className="cx-console-row__avatar" aria-hidden="true">
                        CX
                      </span>
                      <div className="cx-console-row__content">
                        <div className="cx-console-row__meta">
                          <span className="cx-console-row__author">Console Comexa</span>
                        </div>
                        <div className="cx-console-row__bubble cx-console-thinking">
                          <span className="cx-console-dots" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </span>
                          <span className="cx-console-thinking__label">
                            Exécution en cours…
                            {elapsed > 0 ? <span className="cx-console-thinking__timer"> {elapsed} s</span> : null}
                          </span>
                        </div>
                      </div>
                    </li>
                  ) : null}
                </ul>
              )}

              <div ref={endRef} />
            </div>

            <div className="cx-console__foot">
              {error ? (
                <div className="cx-console-error" role="alert">
                  <Icon name="close" className="h-4 w-4" />
                  <span>{error}</span>
                  {lastPrompt ? (
                    <button type="button" className="cx-console-error__retry" onClick={() => send(lastPrompt)} disabled={busy}>
                      Réessayer
                    </button>
                  ) : null}
                </div>
              ) : null}

              {hasMessages ? (
                <div className="cx-console__suggest-toggle">
                  <button
                    type="button"
                    className="cx-console__suggest-btn"
                    onClick={() => setSuggestOpen((value) => !value)}
                    aria-expanded={suggestOpen}
                  >
                    <Icon name="terminal" className="h-4 w-4" />
                    Commandes rapides
                    <Icon name={suggestOpen ? "chevron-up" : "chevron-down"} className="h-4 w-4" />
                  </button>
                  {suggestOpen ? <CategoryTabs onPick={send} busy={busy} compact /> : null}
                </div>
              ) : null}

              <form className="cx-console__composer" onSubmit={onSubmit}>
                <textarea
                  ref={inputRef}
                  className="cx-console__textarea"
                  rows={1}
                  value={draft}
                  placeholder="Écrivez votre demande…"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onKeyDown}
                  aria-label="Message pour la Console Comexa"
                />
                <button
                  type="submit"
                  className="cx-console__send"
                  disabled={busy || draft.trim().length === 0}
                  title="Envoyer"
                >
                  <Icon name="send" className="h-[18px] w-[18px]" />
                  <span className="sr-only">Envoyer</span>
                </button>
              </form>

              <p className="cx-console__hint">
                Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne
              </p>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
