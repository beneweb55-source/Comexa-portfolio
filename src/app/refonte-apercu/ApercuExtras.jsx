"use client";

/*
 * Aperçu des nouveautés — minuteur, mode concentration, notifications.
 *
 * PAGE DE DÉMONSTRATION, en développement seulement. Ce fichier n'est pas
 * utilisé par l'application : il montre, avec des données fixes, les écrans qui
 * demandent sinon une session et une base pour s'afficher.
 *
 * POURQUOI CES APERÇUS SONT ÉCRITS À LA MAIN. Les composants réels
 * (`FocusOverlay`, `NotificationsPanel`) lisent un contexte et une API. Les
 * monter ici demanderait de faux fournisseurs, de fausses réponses HTTP et un
 * socket — c'est-à-dire reécrire la moitié de l'application pour un rendu. Le
 * balisage est donc recopié, avec les MÊMES classes `sui-*` : si la charte
 * change, cet aperçu se démode visiblement, ce qui est le comportement voulu
 * pour un banc d'essai.
 */

import {
  BellOff,
  Check,
  Clock3,
  Flame,
  Inbox,
  Paperclip,
  Pause,
  Play,
  Plus,
  Search,
  SearchX,
  SendHorizontal,
  Square,
  Target,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import TimerDial from "@/components/timer/TimerDial";
import { formatRelativeTime } from "@/components/softui/time";
import { notificationMeta } from "@/components/softui/notification-map";
import { FOCUS_PRESETS, formatFocus, formatPlanned } from "@/lib/focus-store.mjs";
import { SharedResourceCard } from "@/components/workspace/chat/SharedResourceCard";

/* -------------------------------------------------------------------------- */
/* Minuteur — le cadran, dans ses trois états                                 */
/* -------------------------------------------------------------------------- */

export function TimerPreview() {
  return (
    <section className="sui-section" aria-label="Minuteur">
      <div className="sui-split">
        <div className="sui-panel" style={{ display: "grid", placeItems: "center", gap: 14, padding: 22 }}>
          <TimerDial
            elapsedSeconds={3125}
            status="RUNNING"
            progress={{ ratio: 3125 / 3000, over: true, mode: "estimate", label: "Temps dépassé" }}
            size={184}
            caption="Temps dépassé"
          />
          <p className="sui-panel__sub">En cours · 52 min 05 écoulées</p>
        </div>
        <div className="sui-panel" style={{ display: "grid", placeItems: "center", gap: 14, padding: 22 }}>
          <TimerDial
            elapsedSeconds={940}
            status="PAUSED"
            progress={{ ratio: 940 / 3000, over: false, mode: "estimate", label: "Reste 34 min" }}
            size={184}
            caption="Reste 34 min"
          />
          <p className="sui-panel__sub">En pause · 15 min 40 écoulées</p>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Mode concentration — l'écran, à l'arrêt puis en cours                       */
/* -------------------------------------------------------------------------- */

const DEMO_NOTIFICATIONS = [
  {
    id: "n1",
    type: "TASK_DUE_SOON",
    title: "Échéance demain — Intégration du catalogue",
    body: "La tâche doit être terminée avant la recette de jeudi.",
    createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    readAt: null,
  },
  {
    id: "n2",
    type: "QUOTE_ACCEPTED",
    title: "Devis DEV-2026-0007 accepté",
    body: "Marc Delaunay a accepté le devis. Le projet et la facture ont été créés.",
    createdAt: new Date(Date.now() - 1000 * 60 * 96).toISOString(),
    readAt: null,
  },
  {
    id: "n3",
    type: "INVOICE_OVERDUE",
    title: "Facture FAC-2026-0003 en retard",
    body: "Reste 4 200,00 DA à encaisser, échéance dépassée de 6 jours.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    readAt: null,
  },
  {
    id: "n4",
    type: "MESSAGE_RECEIVED",
    title: "Nouveau message de Sofia Benali",
    body: "« Le client a validé la maquette, on peut lancer l’intégration. »",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString(),
    readAt: new Date(Date.now() - 1000 * 60 * 60 * 49).toISOString(),
  },
];

export function NotificationsPreview() {
  return (
    <section className="sui-section" aria-label="Notifications">
      <div className="sui-notif__day">
        <h3 className="sui-notif__day-title">Aujourd’hui</h3>
        <ul className="sui-notif__list">
          {DEMO_NOTIFICATIONS.map((item) => {
            const meta = notificationMeta(item.type);
            const Icon = meta.icon;
            return (
              <li key={item.id} className={`sui-notif${item.readAt ? "" : " is-unread"}`}>
                <span className="sui-notif__icon" data-tone={meta.tone} aria-hidden="true">
                  <Icon size={17} strokeWidth={1.9} />
                </span>
                <div className="sui-notif__body">
                  <p className="sui-notif__title">
                    {item.title}
                    {!item.readAt ? <span className="sui-notif__dot" aria-label="Non lue" /> : null}
                  </p>
                  <p className="sui-notif__text">{item.body}</p>
                  <p className="sui-notif__meta">
                    <span className="sui-notif__tag">{meta.label}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={item.createdAt}>{formatRelativeTime(item.createdAt)}</time>
                  </p>
                </div>
                <div className="sui-notif__actions">
                  {!item.readAt ? (
                    <span className="sui-iconbtn" aria-hidden="true">
                      <Check size={16} strokeWidth={2} />
                    </span>
                  ) : null}
                  <span className="sui-iconbtn sui-iconbtn--ghost" aria-hidden="true">
                    <Trash2 size={16} strokeWidth={1.9} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="sui-notif-live" style={{ position: "static", width: "auto", marginTop: 18 }}>
        <div className="sui-notif-live__head">
          <span className="sui-notif-live__icon" data-tone="yellow" aria-hidden="true">
            <Target size={16} strokeWidth={1.9} />
          </span>
          <span className="sui-notif-live__label">Échéance</span>
          <span className="sui-notif-live__close" aria-hidden="true">
            <X size={15} strokeWidth={2} />
          </span>
        </div>
        <p className="sui-notif-live__title">Échéance demain — Intégration du catalogue</p>
        <p className="sui-notif-live__text">La tâche doit être terminée avant la recette de jeudi.</p>
        <p className="sui-notif-live__time">À l’instant</p>
      </div>

      <div className="sui-empty" style={{ marginTop: 18 }}>
        <span className="sui-empty__icon" aria-hidden="true">
          <Inbox size={22} strokeWidth={1.8} />
        </span>
        <p>Aucune notification pour l’instant.</p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Mode concentration — l'écran nu                                            */
/* -------------------------------------------------------------------------- */

export function FocusPreview() {
  return (
    <section className="sui-section" aria-label="Mode concentration">
      <div className="sui-focus" style={{ position: "static", animation: "none", borderRadius: 26, minHeight: 520 }}>
        <div className="sui-focus__inner">
          <header className="sui-focus__head">
            <span className="sui-focus__eyebrow">
              <Target size={14} strokeWidth={2.2} aria-hidden="true" />
              Mode concentration
            </span>
            <span className="sui-focus__close" aria-hidden="true">
              <X size={18} strokeWidth={2} />
            </span>
          </header>

          <div className="sui-focus__block">
            <h2 className="sui-focus__label">Durée du bloc</h2>
            <div className="sui-focus__presets">
              {FOCUS_PRESETS.map((preset) => (
                <span key={preset} className={`sui-focus__preset${preset === 50 ? " is-active" : ""}`}>
                  <strong>{preset}</strong>
                  <span>minutes</span>
                </span>
              ))}
            </div>
          </div>

          <div className="sui-focus__block">
            <h2 className="sui-focus__label">
              La tâche <span className="sui-focus__label-hint">facultative</span>
            </h2>
            <div className="sui-focus__chosen">
              <span className="sui-focus__chosen-copy">
                <strong>Intégration du catalogue</strong>
                <span>Boutique Vasseur</span>
              </span>
              <span className="sui-focus__chosen-clear">Retirer</span>
            </div>
          </div>

          <div className="sui-focus__block">
            <span className="sui-focus__toggle is-on">
              <span className="sui-focus__toggle-icon" aria-hidden="true">
                <BellOff size={16} strokeWidth={2} />
              </span>
              <span className="sui-focus__toggle-copy">
                <strong>Ne pas déranger</strong>
                <span>Les alertes entrantes restent silencieuses pendant la session.</span>
              </span>
            </span>
          </div>

          <div className="sui-focus__foot">
            <span className="sui-btn sui-btn--dark sui-focus__start">
              <Play size={17} strokeWidth={2.2} aria-hidden="true" />
              Démarrer {formatPlanned(50)}
            </span>
            <dl className="sui-focus__stats">
              <div>
                <dt>
                  <Flame size={13} strokeWidth={2.2} aria-hidden="true" />
                  Série
                </dt>
                <dd>4 j</dd>
              </div>
              <div>
                <dt>
                  <Clock3 size={13} strokeWidth={2.2} aria-hidden="true" />
                  Aujourd’hui
                </dt>
                <dd>1 h 45</dd>
              </div>
              <div>
                <dt>
                  <TrendingUp size={13} strokeWidth={2.2} aria-hidden="true" />
                  7 jours
                </dt>
                <dd>11 h 20</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {/* Le même écran, en cours : cadran, tâche, trois gestes. */}
      <div className="sui-focus" style={{ position: "static", animation: "none", borderRadius: 26, marginTop: 18, minHeight: 520 }}>
        <div className="sui-focus__inner">
          <header className="sui-focus__head">
            <span className="sui-focus__state is-running">
              <span className="sui-focus__pulse" aria-hidden="true" />
              Concentration
            </span>
            <span className="sui-focus__dnd">
              <BellOff size={13} strokeWidth={2.2} aria-hidden="true" />
              Ne pas déranger
            </span>
            <span className="sui-focus__close" aria-hidden="true">
              <X size={18} strokeWidth={2} />
            </span>
          </header>

          <div className="sui-focus__stage">
            <TimerDial
              elapsedSeconds={1405}
              status="RUNNING"
              progress={{ ratio: 1405 / 3000, over: false, mode: "estimate", label: "Reste 26 min 35" }}
              size={320}
              caption="Reste 26 min 35"
            />
          </div>

          <div className="sui-focus__task">
            <p className="sui-focus__task-title">Intégration du catalogue</p>
            <p className="sui-focus__task-meta">
              Boutique Vasseur · bloc de {formatPlanned(50)} · {formatFocus(1405)} écoulées
            </p>
          </div>

          <div className="sui-focus__controls">
            <span className="sui-focus__round" aria-hidden="true">
              <Pause size={22} strokeWidth={2} />
            </span>
            <span className="sui-btn sui-btn--dark sui-focus__finish">
              <Square size={15} strokeWidth={2.4} aria-hidden="true" />
              Terminer et enregistrer
            </span>
            <span className="sui-focus__ghost" aria-hidden="true">
              <Trash2 size={17} strokeWidth={1.9} />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}


/* -------------------------------------------------------------------------- */
/* Messagerie — recherche affinée, composeur et cartes de ressources          */
/* -------------------------------------------------------------------------- */

/*
 * LES CARTES SONT LES VRAIES. Contrairement au reste de l'aperçu (balisage
 * recopié), les trois états de la carte ci-dessous montent le VRAI composant
 * `SharedResourceCard` avec de fausses vues : si le composant casse, cette page
 * casse avec lui, en construction. Le picker et le composeur restent des
 * maquettes en classes `sui-*` — eux lisent une session et une API.
 */

const DEMO_VIEWS = {
  invoice: {
    available: true,
    title: "Facture 2026-041 · Agence Nord",
    subtitle: "Échéance 12 nov. 2026",
    statusKey: "SENT",
    link: "/factures/demo",
    amount: "4 800,00 EUR",
  },
  task: {
    available: true,
    title: "Reluire la page tarifs avant recette",
    subtitle: "Projet Vitrine · échéance vendredi",
    statusKey: "IN_PROGRESS",
    link: "/taches/demo",
    amount: null,
  },
  gone: { available: false, title: null, subtitle: null, statusKey: null, link: null, amount: null },
  network: { available: false, transient: true },
};

export function ChatResourcesPreview() {
  return (
    <div className="sui-split" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
      <div className="sui-panel" style={{ display: "grid", alignContent: "start", gap: 16, padding: 18 }}>
        <strong style={{ fontSize: "var(--fs-body)" }}>Dans le fil — trois états d&#39;une carte</strong>

        <div className="sui-chat__msg" style={{ flexDirection: "column", alignItems: "flex-start" }}>
          <div className="sui-chat__sender">Nadia · 09:41</div>
          <div className="sui-chat__bubble" style={{ maxWidth: "100%" }}>
            La relecture de la facture est faite — je la partage ici.
            <div className="sui-chat__cards">
              <SharedResourceCard
                resource={{ resourceType: "INVOICE", resourceId: "i-1" }}
                view={DEMO_VIEWS.invoice}
                onOpen={(event) => event.preventDefault()}
              />
            </div>
          </div>
        </div>

        <div className="sui-chat__msg sui-chat__msg--mine" style={{ flexDirection: "column", alignItems: "flex-end" }}>
          <div className="sui-chat__sender" style={{ textAlign: "right" }}>Vous · 09:44</div>
          <div className="sui-chat__bubble" style={{ maxWidth: "100%" }}>
            Et la tâche part ce soir.
            <div className="sui-chat__cards">
              <SharedResourceCard
                resource={{ resourceType: "TASK", resourceId: "t-1" }}
                view={DEMO_VIEWS.task}
                onOpen={(event) => event.preventDefault()}
              />
              {/* Relecture en vol : squelette, jamais un titre deviné. */}
              <SharedResourceCard resource={{ resourceType: "PROJECT", resourceId: "p-1" }} />
            </div>
          </div>
        </div>

        <div className="sui-chat__msg" style={{ flexDirection: "column", alignItems: "flex-start" }}>
          <div className="sui-chat__bubble" style={{ maxWidth: "100%" }}>
            <div className="sui-chat__cards sui-chat__cards--alone">
              {/* Hors périmètre / supprimée : un seul mot pour les deux cas. */}
              <SharedResourceCard resource={{ resourceType: "CLIENT", resourceId: "c-9" }} view={DEMO_VIEWS.gone} />
              {/* Échec reseau : la carte le dit et propose de relire. */}
              <SharedResourceCard resource={{ resourceType: "QUOTE", resourceId: "q-3" }} view={DEMO_VIEWS.network} onRetry={() => {}} />
            </div>
          </div>
        </div>
      </div>

      <div className="sui-panel" style={{ display: "grid", alignContent: "start", gap: 16, padding: 18 }}>
        <strong style={{ fontSize: "var(--fs-body)" }}>Composeur — l&#39;aperçu avant envoi</strong>

        <div className="sui-chat__composer-shell">
          <div className="sui-chat__staged" aria-label="Ressources jointes au message">
            <span className="sui-chat__ref-chip">
              <Check size={12} strokeWidth={2.6} aria-hidden="true" />
              <span className="sui-chat__ref-chip__type">Facture</span>
              <strong>Facture 2026-041 · Agence Nord</strong>
              <button type="button" className="sui-chat__ref-chip__remove" aria-label="Retirer la facture">
                <X size={12} strokeWidth={2.4} aria-hidden="true" />
              </button>
            </span>
            <span className="sui-chat__ref-chip">
              <Check size={12} strokeWidth={2.6} aria-hidden="true" />
              <span className="sui-chat__ref-chip__type">Tâche</span>
              <strong>Reluire la page tarifs avant recette</strong>
              <button type="button" className="sui-chat__ref-chip__remove" aria-label="Retirer la tâche">
                <X size={12} strokeWidth={2.4} aria-hidden="true" />
              </button>
            </span>
          </div>

          <div className="sui-chat__composer">
            <button type="button" className="sui-iconbtn sui-chat__attach is-active" aria-label="Joindre une ressource Comexa">
              <Paperclip size={18} strokeWidth={1.9} aria-hidden="true" />
            </button>
            <textarea className="sui-input" rows={1} readOnly defaultValue="Je vous joins la facture et la tâche du soir." style={{ width: "100%", resize: "none" }} />
            <button type="button" className="sui-iconbtn sui-chat__send" aria-label="Envoyer le message">
              <SendHorizontal size={19} strokeWidth={1.9} aria-hidden="true" />
            </button>
          </div>

          {/* Le picker, ouvert au-dessus du composeur (maquette statique — il
              lit une session et l'API, indisponibles ici). */}
          <div className="sui-res-picker" style={{ position: "relative", bottom: "auto", inset: "auto" }}>
            <div className="sui-res-picker__head">
              <span className="sui-res-picker__search-icon" aria-hidden="true">
                <Search size={15} strokeWidth={2} />
              </span>
              <input className="sui-res-picker__input" type="search" defaultValue="tarifs" placeholder="Projets, tâches, clients, factures…" aria-label="Rechercher une ressource Comexa" />
              <button type="button" className="sui-iconbtn sui-iconbtn--ghost sui-res-picker__close" aria-label="Fermer la recherche de ressources">
                <X size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <div className="sui-res-picker__tabs" role="group" aria-label="Filtrer par type">
              <button type="button" className="sui-pill sui-res-picker__tab" aria-pressed="true">Tous</button>
              <button type="button" className="sui-pill sui-res-picker__tab" aria-pressed="false">Projet</button>
              <button type="button" className="sui-pill sui-res-picker__tab" aria-pressed="false">Tâche</button>
              <button type="button" className="sui-pill sui-res-picker__tab" aria-pressed="false">Devis</button>
            </div>
            <div className="sui-res-picker__results">
              <section className="sui-res-picker__group" aria-label="Tâche">
                <h4 className="sui-res-picker__group-title">Tâche</h4>
                <ul className="sui-res-picker__list">
                  <li>
                    <button type="button" className="sui-res-picker__item is-selected" aria-pressed="true">
                      <span className="sui-res-picker__copy">
                        <strong>Reluire la page tarifs avant recette</strong>
                        <span>Projet Vitrine · en cours</span>
                      </span>
                      <span className="sui-res-picker__mark" aria-hidden="true">
                        <Check size={15} strokeWidth={2.4} />
                      </span>
                    </button>
                  </li>
                  <li>
                    <button type="button" className="sui-res-picker__item" aria-pressed="false">
                      <span className="sui-res-picker__copy">
                        <strong>Mettre à jour la grille tarifaire 2027</strong>
                        <span>Projet Tarifs · à faire</span>
                      </span>
                      <span className="sui-res-picker__mark" aria-hidden="true">
                        <Plus size={15} strokeWidth={2.2} />
                      </span>
                    </button>
                  </li>
                </ul>
              </section>
            </div>
            <footer className="sui-res-picker__foot">
              <span>1 référence prête</span>
              <button type="button" className="sui-btn sui-btn--sm">Terminer</button>
            </footer>
          </div>
        </div>
      </div>

      <div className="sui-panel" style={{ display: "grid", alignContent: "start", gap: 14, padding: 18 }}>
        <strong style={{ fontSize: "var(--fs-body)" }}>Recherche du fil — ses états</strong>

        <div className="sui-search sui-search--chat">
          <span className="sui-search__icon" aria-hidden="true">
            <Search size={16} strokeWidth={2.1} />
          </span>
          <input type="search" placeholder="Rechercher une conversation, un membre…" aria-label="Rechercher une conversation" />
          <kbd className="sui-search__kbd" aria-hidden="true">/</kbd>
        </div>

        <div className="sui-search sui-search--chat is-filled">
          <span className="sui-search__icon" aria-hidden="true">
            <Search size={16} strokeWidth={2.1} />
          </span>
          <input type="search" defaultValue="factor" aria-label="Rechercher une conversation" />
          <button type="button" className="sui-search__clear" aria-label="Effacer la recherche">
            <SearchX size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="sui-chat__row">
          <span className="sui-chat__avatar" aria-hidden="true">F</span>
          <div className="sui-chat__meta">
            <span className="sui-chat__top">
              <span className="sui-chat__title"><mark className="sui-chat__hit">Factor</mark>ie — refonte vitrine</span>
            </span>
            <span className="sui-chat__preview">Nadia : je pousse la <mark className="sui-chat__hit">factor</mark>isation ce soir</span>
          </div>
        </div>
      </div>
    </div>
  );
}
