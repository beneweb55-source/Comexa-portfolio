"use client";

/*
 * Aperçu (démonstration) — assemble les composants publics du design system avec
 * des données factices, sans session ni API. Sert de banc d'essai visuel :
 * chaque élément du brief est présent une fois, du bandeau au dock.
 *
 * Les vraies pages n'utilisent pas ce fichier : elles consomment
 * `src/components/softui` et les données de l'API.
 */

import { useState } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  BookOpen,
  CalendarDays,
  CalendarClock,
  ChartNoAxesColumn,
  ChevronDown,
  Check,
  CreditCard,
  Eye,
  FilePen,
  FilePlus,
  FolderKanban,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  Mail,
  Megaphone,
  Pencil,
  Plus,
  Radio,
  ReceiptText,
  Settings2,
  Sparkles,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import AdminDeskPanel from "@/components/softui/AdminDeskPanel";
import Dock from "@/components/softui/Dock";
import { ItemCard, ItemGrid } from "@/components/softui/ItemCard";
import { KpiGrid } from "@/components/softui/KpiCard";
import Navbar from "@/components/softui/Navbar";
import PageHeader from "@/components/softui/PageHeader";
import SideRail from "@/components/softui/SideRail";
import { ActivityList, HealthList, Panel } from "@/components/softui/panels";
import { Button, FilterPills, SectionHead, StatusPill } from "@/components/softui/primitives";
import { SoftMotionProvider } from "@/components/softui/motion";

const NAV_ITEMS = [
  { href: "#", label: "Control Center", icon: LayoutDashboard },
  { href: "#users", label: "Utilisateurs", icon: Users },
  { href: "#courses", label: "Cours", icon: BookOpen },
  { href: "#events", label: "Événements", icon: CalendarDays },
  { href: "#billing", label: "Facturation", icon: CreditCard },
  { href: "#messages", label: "Messages", icon: Mail },
  { href: "#stats", label: "Statistiques", icon: ChartNoAxesColumn },
  { href: "#settings", label: "Réglages", icon: Settings2 },
];

const KPIS = [
  { id: "users", tone: "blue", value: "1 284", label: "Utilisateurs actifs", badge: "Cette semaine" },
  { id: "courses", tone: "green", value: "36", label: "Cours publiés", badge: "4 en revue", deco: true, decoIcon: Sparkles },
  { id: "revenue", tone: "yellow", value: "18,4 k", label: "Encaissements du mois", badge: "Taux 92 %" },
  { id: "waiting", tone: "ghost", value: "9", label: "À traiter : demandes ouvertes" },
];

const CARDS = [
  {
    id: "user",
    corner: "ET",
    cornerTone: "lilac",
    title: "Estelle Traoré",
    description: "estelle.traore@comexa.dz",
    meta: [
      { icon: Users, label: "Formatrice" },
      { icon: BookOpen, label: "4 cours" },
      { icon: CalendarDays, label: "Arrivée le 12 mars" },
    ],
    progress: { value: 71, ratio: "71 %" },
    status: "Actif",
    statusTone: "green",
    actions: [
      { icon: Pencil, label: "Modifier Estelle Traoré" },
      { icon: Lock, label: "Verrouiller le compte" },
      { icon: Trash2, label: "Supprimer Estelle Traoré", variant: "dark" },
    ],
  },
  {
    id: "course",
    cornerIcon: BookOpen,
    cornerTone: "green",
    title: "Bases de la comptabilité analytique",
    description: "Parcours de 12 leçons avec exercices corrigés et cas pratiques.",
    meta: [
      { icon: Users, label: "Yanis B." },
      { icon: BadgeCheck, label: "12 leçons" },
      { icon: Wallet, label: "184 élèves" },
    ],
    status: "Publié",
    statusIcon: BadgeCheck,
    statusTone: "green",
    actions: [
      { icon: Plus, label: "Ajouter une leçon" },
      { icon: Trash2, label: "Retirer le cours" },
      { icon: Check, label: "Publier le cours", variant: "dark" },
    ],
  },
  {
    id: "event",
    cornerIcon: CalendarClock,
    cornerTone: "yellow",
    title: "Atelier facturation électronique",
    description: "Session live animée par l’équipe produit, questions ouvertes.",
    meta: [
      { icon: CalendarDays, label: "24 octobre" },
      { icon: CalendarClock, label: "12 h 30 — 13 h 15" },
    ],
    status: "En direct",
    statusIcon: Radio,
    statusTone: "pink",
    actions: [
      { icon: Pencil, label: "Modifier l’atelier" },
      { icon: Trash2, label: "Supprimer l’atelier" },
      { icon: Eye, label: "Prévisualiser l’atelier", variant: "dark" },
    ],
  },
  {
    id: "quote",
    cornerIcon: ReceiptText,
    cornerTone: "blue",
    title: "DEVI-2026-0142",
    description: "Groupe Sahara Logistique",
    meta: [
      { icon: Users, label: "Nadia K." },
      { icon: CalendarDays, label: "Valable jusqu’au 30 novembre" },
    ],
    info: "248 000 DZD",
    status: "Brouillon",
    statusIcon: FilePen,
    statusTone: "plain",
    actions: [{ icon: ArrowUpRight, label: "Ouvrir le devis", variant: "dark" }],
  },
  {
    id: "ticket",
    cornerIcon: LifeBuoy,
    cornerTone: "yellow",
    title: "Ticket 118 — export bloqué",
    description: "Le client ne reçoit plus le fichier CSV mensuel par courriel.",
    meta: [
      { icon: Users, label: "Support niveau 2" },
      { icon: CalendarClock, label: "Ouvert il y a 3 h" },
    ],
    status: "Ouvert",
    statusIcon: LifeBuoy,
    statusTone: "yellow",
    actions: [
      { icon: Eye, label: "Voir le ticket" },
      { icon: Mail, label: "Répondre au client", variant: "dark" },
    ],
  },
  {
    id: "highlight",
    cornerIcon: Radio,
    cornerTone: "pink",
    title: "Démonstration : pilotage des marges",
    description: "La session qui rassemble le plus de participants aujourd’hui.",
    meta: [{ icon: Users, label: "529 inscrits" }, { icon: CalendarClock, label: "Dans 25 min" }],
    info: "529 participants en attente",
    highlight: true,
    status: "En direct",
    statusIcon: Radio,
    statusTone: "pink",
    statusVariant: "white",
    play: (
      <Button variant="dark" icon={Plus}>
        Rejoindre
      </Button>
    ),
  },
];

const DESK_ITEMS = [
  {
    id: "webinar",
    tab: "events",
    tone: "blue",
    icon: Radio,
    type: "Webinaire",
    date: "12 h 30",
    lines: ["Facturation électronique en pratique", "Salle ouverte 10 minutes avant le direct.", "41 inscrits · 2 intervenants"],
    cta: { label: "Démarrer à 12 h 30", icon: Radio },
    actions: [
      { label: "Voir le webinaire", icon: Eye },
      { label: "Modifier le webinaire", icon: Pencil },
      { label: "Supprimer le webinaire", icon: Trash2 },
    ],
  },
  {
    id: "lesson",
    tab: "approvals",
    tone: "lilac",
    icon: BookOpen,
    type: "Leçon",
    date: "Aujourd’hui",
    lines: ["Module 4 — analyse des écarts", "Relecture demandée par l’auteur.", "En attente depuis 6 heures"],
    cta: { label: "Relire la leçon", icon: BadgeCheck },
    actions: [
      { label: "Voir la leçon", icon: Eye },
      { label: "Modifier la leçon", icon: Pencil },
      { label: "Supprimer la leçon", icon: Trash2 },
    ],
  },
  {
    id: "task",
    tab: "audit",
    tone: "yellow",
    icon: FolderKanban,
    type: "Tâche",
    date: "Demain",
    lines: ["Préparer les notes de réunion trimestrielle", "Assignée à Nadia K.", "Priorité haute"],
    cta: { label: "Ouvrir la tâche", icon: TrendingUp },
    actions: [
      { label: "Voir la tâche", icon: Eye },
      { label: "Modifier la tâche", icon: Pencil },
      { label: "Supprimer la tâche", icon: Trash2 },
    ],
  },
];

const ACTIVITY = [
  { id: 1, icon: BadgeCheck, tone: "green", sentence: "Cours « Bases de la comptabilité » publié", time: "il y a 12 min" },
  { id: 2, icon: UserPlus, tone: "blue", sentence: "Nouvel utilisateur inscrit depuis Alger", time: "il y a 48 min" },
  { id: 3, icon: Wallet, tone: "yellow", sentence: "Paiement de 32 000 DZD reçu", time: "il y a 2 h" },
  { id: 4, icon: LifeBuoy, tone: "pink", sentence: "Ticket 118 escaladé au support niveau 2", time: "il y a 3 h" },
];

const HEALTH = [
  { id: "on-track", label: "Dans les temps", hint: "5 / 7 projets", value: 71, ratio: "5 / 7" },
  { id: "at-risk", label: "À risque", hint: "3 / 6 jalons", value: 50, ratio: "3 / 6" },
  { id: "delayed", label: "En retard", hint: "3 / 4 échéances", value: 75, ratio: "3 / 4" },
];

export default function ApercuClient() {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  return (
    <SoftMotionProvider>
      <div className="sui-viewport">
        <p className="sui-head__sub" style={{ maxWidth: 900, margin: "0 auto 14px", textAlign: "center" }}>
          Aperçu du design system — données de démonstration, page disponible en développement uniquement.
        </p>

        <div className="sui-shell" style={{ height: "calc(100dvh - 76px)" }}>
          <Navbar items={NAV_ITEMS} activeHref="#" roleLabel="admin" homeHref="/" profile={<MockProfile />} />

          <div className="sui-shell__body">
            <SideRail
              onOpenNavigation={() => {}}
              onToggleDesk={() => {}}
              deskOpen
              onShare={() => {}}
              unreadCount={3}
              notificationsHref="/espace-equipe/notifications"
              onZoomIn={() => {}}
              onZoomOut={() => {}}
              zoom={1}
              canZoomIn
              canZoomOut
            />

            <main className="sui-main" id="sui-main">
              <span className="sui-notch" aria-hidden="true">
                <span className="sui-notch__fillet sui-notch__fillet--left" />
                <span className="sui-notch__fillet sui-notch__fillet--right" />
              </span>

              <div className="sui-main__scroll">
                <PageHeader
                  title="Control Center"
                  subtitle="Pilotage de la plateforme : utilisateurs, contenus, événements et facturation."
                  icon={LayoutDashboard}
                  breadcrumb="Espace équipe · Tableau de bord"
                  query={query}
                  onQueryChange={setQuery}
                />

                <KpiGrid items={KPIS} />

                <section className="sui-section" aria-label="Filtres">
                  <FilterPills
                    value={filter}
                    onChange={setFilter}
                    items={[
                      { id: "all", label: "Tout", count: 128 },
                      { id: "users", label: "Utilisateurs", count: 42 },
                      { id: "courses", label: "Cours", count: 36 },
                      { id: "events", label: "Événements", count: 9 },
                    ]}
                    actions={
                      <>
                        <Button icon={ChartNoAxesColumn}>Exporter le CSV</Button>
                        <Button variant="dark" icon={UserPlus}>
                          Ajouter un utilisateur
                        </Button>
                      </>
                    }
                  />
                </section>

                <section className="sui-section">
                  <SectionHead icon={Sparkles} title="File de validation" count={CARDS.length}>
                    <StatusPill tone="green" icon={BadgeCheck} label="9 éléments traités aujourd’hui" />
                  </SectionHead>
                  <ItemGrid label="File de validation">
                    {CARDS.map((card) => (
                      <ItemCard key={card.id} {...card} />
                    ))}
                  </ItemGrid>
                </section>

                <section className="sui-section">
                  <div className="sui-split">
                    <Panel title="Activité récente">
                      <ActivityList items={ACTIVITY} />
                    </Panel>
                    <Panel title="Santé de l’espace">
                      <HealthList items={HEALTH} />
                      <Button href="#" style={{ marginTop: 14, width: "100%" }}>
                        Ouvrir l’analytique
                      </Button>
                    </Panel>
                  </div>
                </section>
              </div>
            </main>

            <AdminDeskPanel
              subtitle="6 éléments en attente · 3 événements en direct"
              tabs={[
                { id: "events", label: "Événements" },
                { id: "approvals", label: "Validations" },
                { id: "audit", label: "Journal" },
              ]}
              items={DESK_ITEMS}
            />
          </div>

          <Dock
            items={[
              { label: "Nouvel utilisateur", href: "#", icon: UserPlus, tone: "blue" },
              { label: "Nouveau cours", href: "#", icon: BookOpen, tone: "lilac" },
              { label: "Nouvel événement", href: "#", icon: CalendarDays, tone: "yellow" },
              { label: "Annonce", href: "#", icon: Megaphone, tone: "pink" },
              { label: "Exporter les données", href: "#", icon: FilePlus, tone: "green" },
              { label: "Plus d’actions", icon: Plus, tone: "ink", onClick: () => {} },
            ]}
          />
        </div>
      </div>
    </SoftMotionProvider>
  );
}

/** Profil de démonstration : même habillage que `UserMenu` en variant « softui ». */
function MockProfile() {
  return (
    <span className="sui-profile">
      <span className="sui-profile__trigger" role="img" aria-label="Compte de Estelle Traoré (démonstration)">
        <span className="sui-profile__avatar" aria-hidden="true">ET</span>
        <span className="sui-profile__id">
          <span className="sui-profile__name">Estelle Traoré</span>
          <span className="sui-profile__mail">estelle.traore@comexa.dz</span>
        </span>
        <ChevronDown size={16} strokeWidth={1.75} className="sui-profile__chevron" aria-hidden="true" />
      </span>
    </span>
  );
}
