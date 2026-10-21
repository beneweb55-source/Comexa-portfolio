"use client";

/*
 * Le hub des espaces — habillé comme le dashboard.
 *
 * POURQUOI CE FICHIER EXISTE. L'application desktop (Electron) et l'application
 * Android (WebView) s'ouvrent sur cet écran : c'est la façade des deux. Le
 * hub portait une maquette claire « à plat » — halo, cartes blanches, titre
 * centré — alors que le reste de l'application a une identité très affirmée :
 * « soft UI pastel dans une coque noire » (coque noire bord à bord, navbar
 * noire, languette sous l'onglet actif, rail gauche, panneau clair, dock
 * flottant). Les deux applications perdaient donc leur identité dès le
 * premier écran, avant même d'ouvrir un espace.
 *
 * CE QUE FAIT CETTE COMPOSANTE. Elle habille le hub avec EXACTEMENT les mêmes
 * pièces que la coque du dashboard (`src/components/softui/Shell.jsx`) :
 *   - la vue `.sui-viewport` et la coque noire `.sui-shell` ;
 *   - la navbar noire : logo clair, onglet « Espaces » (l'onglet actif, donc
 *     porteur de la languette) et un onglet par espace ouvert, puis le menu du
 *     compte ;
 *   - la languette noire sous l'onglet actif — la signature du design ;
 *   - le rail gauche (partage, toutes les rubriques, densité du texte) ;
 *   - le panneau clair : en-tête de page, indicateurs, cartes d'espace ;
 *   - le dock flottant, et, sur téléphone, la barre d'application et la barre
 *     d'onglets.
 *
 * ELLE N'INVENTE AUCUNE DONNÉE. Les espaces, leurs libellés, leurs teintes et
 * leurs rubriques viennent de l'API (`GET /me/spaces`) et de `lib/spaces.js`,
 * comme avant : la page ne fait que présenter ce que le compte a le droit
 * d'ouvrir.
 */

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, LayoutGrid, LogOut, UserRound, X } from "lucide-react";
import { motion } from "framer-motion";
import Dock from "./Dock";
import ItemCard, { ItemGrid } from "./ItemCard";
import Navbar from "./Navbar";
import Notch from "./Notch";
import PageHeader from "./PageHeader";
import SideRail from "./SideRail";
import { KpiGrid } from "./KpiCard";
import { Button, SectionHead } from "./primitives";
import { SoftMotionProvider } from "./motion";
import { roleLabelOf } from "./SpaceSwitcher";
import UserMenu from "@/components/workspace/UserMenu";
import { Empty, SkeletonList } from "@/components/workspace/ui";
import logoLight from "../../../public/comexa-logo-horizontal-clair-transparent.png";

/** Chemin du hub : sert au retour après connexion et à l'onglet actif. */
const HUB_PATH = "/espaces";

/** Densité du panneau, mémorisée localement (boutons + / − du rail). */
const ZOOM_STEPS = [0.9, 1, 1.1, 1.2];
const ZOOM_KEY = "comexa:panel-zoom";

/** Rubriques inscrites sur une carte avant le « +N ». */
const CHIPS_SHOWN = 4;

function readZoom() {
  if (typeof window === "undefined") return 1;
  try {
    const value = Number(window.localStorage.getItem(ZOOM_KEY));
    return ZOOM_STEPS.includes(value) ? value : 1;
  } catch {
    return 1;
  }
}

/** Largeur réellement disponible (le rail et le panneau changent de forme). */
function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/* -------------------------------------------------------------------------- */
/* Tiroir « Espaces de travail » — le pendant du tiroir de rubriques du shell  */
/* -------------------------------------------------------------------------- */

function HubDrawer({ entries, accountHref, onClose, onSignOut }) {
  const titleId = useId();
  const closeBtnRef = useRef(null);

  useEffect(() => {
    closeBtnRef.current?.focus({ preventScroll: true });
    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="sui-scrim" role="presentation" onClick={onClose} />
      <div className="sui-drawer sui-drawer--nav" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sui-drawer__head">
          <div>
            <h2 className="sui-drawer__title" id={titleId}>
              Espaces de travail
            </h2>
            <p className="sui-desk__sub">Les seuls espaces ouverts à votre compte.</p>
          </div>
          <button ref={closeBtnRef} type="button" className="sui-iconbtn" aria-label="Fermer les espaces" onClick={onClose}>
            <X size={19} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="sui-drawer__body">
          <div className="sui-drawer__group">
            <span className="sui-drawer__group-label">Vos espaces</span>
            <div className="sui-drawer__grid">
              {entries.map((entry) => (
                <Link key={entry.id} href={entry.href} className="sui-drawer__link" onClick={onClose}>
                  <entry.icon size={18} strokeWidth={1.75} aria-hidden="true" />
                  <span>{entry.label}</span>
                  {entry.unread > 0 ? <span className="sui-drawer__badge">{entry.unread > 99 ? "99+" : entry.unread}</span> : null}
                </Link>
              ))}
            </div>
          </div>

          <div className="sui-drawer__group">
            <span className="sui-drawer__group-label">Comexa</span>
            <div className="sui-drawer__grid">
              <Link href={accountHref} className="sui-drawer__link" onClick={onClose}>
                <UserRound size={18} strokeWidth={1.75} aria-hidden="true" />
                <span>Mon compte</span>
              </Link>
              <button
                type="button"
                className="sui-drawer__link"
                onClick={() => {
                  onClose();
                  onSignOut();
                }}
              >
                <LogOut size={18} strokeWidth={1.75} aria-hidden="true" />
                <span>Se déconnecter</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Barre d'application (téléphone)                                            */
/* -------------------------------------------------------------------------- */

function HubAppBar({ onOpenMenu }) {
  return (
    <header className="sui-appbar">
      <Link href={HUB_PATH} className="sui-appbar__logo" aria-label="Comexa — espaces de travail">
        <Image src={logoLight} alt="" width={96} height={22} priority />
      </Link>
      <button type="button" className="sui-appbar__space" onClick={onOpenMenu} aria-haspopup="dialog">
        <span>Espaces</span>
        <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      <div className="sui-appbar__tools">
        <button type="button" className="sui-appbar__icon" aria-label="Toutes les rubriques" onClick={onOpenMenu}>
          <LayoutGrid size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Le hub                                                                      */
/* -------------------------------------------------------------------------- */

export default function HubScreen({
  account,
  entries = [],
  loading = false,
  accountHref = "/espace-client/compte",
  onSignOut,
  /* Espace mis en avant (la carte « lilas soutenu » du dashboard) : celui où
     le compte atterrit en se connectant. À défaut, le premier de la liste. */
  highlightId = null,
}) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [notch, setNotch] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(() => ZOOM_STEPS.indexOf(readZoom()));

  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;

  const setZoom = useCallback((index) => {
    const clamped = Math.max(0, Math.min(ZOOM_STEPS.length - 1, index));
    setZoomIndex(clamped);
    try {
      window.localStorage.setItem(ZOOM_KEY, String(ZOOM_STEPS[clamped]));
    } catch {
      // stockage indisponible : la densité ne sera pas retenue
    }
  }, []);

  const shareScreen = useCallback(async () => {
    if (typeof navigator === "undefined") return;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Comexa — espaces de travail", url: window.location.href });
        return;
      }
      await navigator.clipboard?.writeText(window.location.href);
    } catch {
      // partage refusé ou presse-papiers indisponible : on ne fait rien
    }
  }, []);

  /* Onglets de la navbar : le hub (actif) puis un onglet par espace ouvert.
     Le hub est l'onglet actif, donc le seul porteur de la languette noire. */
  const navItems = useMemo(
    () => [
      { href: HUB_PATH, label: "Espaces", icon: LayoutGrid },
      ...entries.map((entry) => ({ href: entry.href, label: entry.shortLabel ?? entry.label, icon: entry.icon })),
    ],
    [entries],
  );

  const unreadTotal = useMemo(() => entries.reduce((sum, entry) => sum + Number(entry.unread ?? 0), 0), [entries]);
  const sectionsTotal = useMemo(() => entries.reduce((sum, entry) => sum + entry.sections.length, 0), [entries]);
  const role = account ? roleLabelOf(account) : "";

  /* Une seule carte mise en avant par vue : l'espace d'accueil du compte. */
  const featuredId = highlightId ?? entries[0]?.id ?? null;

  const kpis = useMemo(
    () => [
      {
        id: "spaces",
        tone: "blue",
        value: String(entries.length),
        label: "Espaces ouverts",
        badge: "Pour votre compte",
      },
      {
        id: "sections",
        tone: "lilac",
        value: String(sectionsTotal),
        label: "Rubriques accessibles",
        badge: "Accès direct",
      },
      {
        id: "notifications",
        tone: "yellow",
        value: String(unreadTotal),
        label: "Notifications non lues",
        badge: unreadTotal > 0 ? "À traiter" : "À jour",
      },
    ],
    [entries.length, sectionsTotal, unreadTotal],
  );

  const dockItems = useMemo(
    () => [
      ...entries.map((entry) => ({
        label: `Ouvrir ${entry.label}`,
        href: entry.href,
        icon: entry.icon,
        tone: entry.tone,
      })),
      { label: "Espaces de travail", icon: LayoutGrid, tone: "ink", onClick: () => setDrawerOpen(true) },
    ],
    [entries],
  );

  return (
    <SoftMotionProvider>
      <div className="sui-viewport" data-space="hub">
        <a className="sui-skip" href="#sui-main">
          Passer à la zone de travail
        </a>

        <div className="sui-shell">
          <Navbar
            items={navItems}
            activeHref={HUB_PATH}
            badge="tous les espaces"
            homeHref={HUB_PATH}
            profile={<UserMenu variant="softui" />}
            onActiveTabMove={isMobile ? undefined : setNotch}
            onOpenMenu={() => setDrawerOpen(true)}
          />

          <HubAppBar onOpenMenu={() => setDrawerOpen(true)} />

          {/* Languette alignée sur l'onglet actif (masquée sans onglet actif). */}
          {!isMobile && notch ? <Notch center={notch.center} pillWidth={notch.pillWidth} /> : null}

          <div className="sui-shell__body">
            <SideRail
              onShare={shareScreen}
              onOpenNavigation={() => setDrawerOpen(true)}
              navigationLabel="Espaces de travail"
              onZoomIn={() => setZoom(zoomIndex + 1)}
              onZoomOut={() => setZoom(zoomIndex - 1)}
              canZoomIn={zoomIndex < ZOOM_STEPS.length - 1}
              canZoomOut={zoomIndex > 0}
              zoom={zoom}
            />

            <main className="sui-main" id="sui-main" aria-label="Espaces de travail">
              <div className="sui-main__scroll" style={{ "--zoom": zoom }}>
                <motion.div
                  className="sui-canvas-inner"
                  initial="hidden"
                  animate="visible"
                  variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
                >
                  <PageHeader
                    title="Espaces de travail"
                    subtitle="Chaque espace n'affiche que ses propres données, et le serveur y vérifie vos droits à chaque requête."
                    icon={LayoutGrid}
                    iconTone="blue"
                    breadcrumb="Comexa"
                    primaryAction={
                      entries.length > 1
                        ? { label: "Ouvrir un espace", icon: ArrowUpRight, onClick: () => setDrawerOpen(true) }
                        : undefined
                    }
                  />

                  {/* Sur téléphone, l'action principale passe en pleine largeur
                      sous le titre (la coque la masque dans l'en-tête). */}
                  {entries.length > 1 ? (
                    <div className="sui-mobile-primary">
                      <Button variant="dark" icon={ArrowUpRight} onClick={() => setDrawerOpen(true)}>
                        Ouvrir un espace
                      </Button>
                    </div>
                  ) : null}

                  {loading ? (
                    <section className="sui-section" aria-label="Chargement des espaces">
                      <SkeletonList rows={3} />
                    </section>
                  ) : entries.length ? (
                    <>
                      <section className="sui-section sui-hub__kpis" aria-label="Indicateurs">
                        <KpiGrid items={kpis} label="Indicateurs des espaces" />
                      </section>

                      <section className="sui-section">
                        <SectionHead icon={LayoutGrid} title="Vos espaces" count={entries.length}>
                          <span className="sui-panel__sub">
                            Les espaces ouverts à votre compte — et rien d’autre.
                          </span>
                        </SectionHead>
                        <ItemGrid label="Vos espaces de travail">
                          {entries.map((entry) => {
                            const shown = entry.sections.slice(0, CHIPS_SHOWN);
                            const hidden = entry.sections.length - shown.length;
                            return (
                              <ItemCard
                                key={entry.id}
                                title={entry.label}
                                titleHref={entry.href}
                                description={entry.description}
                                cornerIcon={entry.icon}
                                cornerTone={entry.tone}
                                highlight={entry.id === featuredId}
                                meta={[...shown.map((label) => ({ label })), ...(hidden > 0 ? [{ label: `+${hidden}` }] : [])]}
                                status={entry.unread > 0 ? `${entry.unread} non lue${entry.unread > 1 ? "s" : ""}` : "Aucun nouveau"}
                                statusTone={entry.unread > 0 ? "pink" : "green"}
                                actions={[{ icon: ArrowUpRight, label: `Ouvrir ${entry.label}`, href: entry.href }]}
                              />
                            );
                          })}
                        </ItemGrid>
                      </section>

                      {role ? (
                        <section className="sui-section">
                          <div className="sui-hub__note">
                            <UserRound size={16} strokeWidth={1.75} aria-hidden="true" />
                            <span>
                              Vos droits sont recalculés par le serveur à chaque espace ouvert — {role}. Cette page ne
                              fait que les présenter.
                            </span>
                          </div>
                        </section>
                      ) : null}
                    </>
                  ) : (
                    <Empty
                      icon={LayoutGrid}
                      action={
                        <Button href="/connexion" variant="dark">
                          Se connecter
                        </Button>
                      }
                    >
                      Aucun espace de travail n’est ouvert pour ce compte. Si vous pensez que c’est une erreur, un
                      administrateur doit vous attribuer un rôle dans Comexa Space.
                    </Empty>
                  )}
                </motion.div>
              </div>
            </main>
          </div>

          <Dock items={dockItems} label="Actions rapides — Espaces de travail" />

          {/* Onglets du téléphone : le hub, les espaces, puis le compte. */}
          <nav className="sui-mobile-tabbar" aria-label="Navigation principale">
            <Link href={HUB_PATH} className="sui-mobile-tab sui-mobile-tab--active" aria-current="page">
              <LayoutGrid size={20} strokeWidth={1.75} aria-hidden="true" />
              <span>Espaces</span>
            </Link>
            {entries.slice(0, 3).map((entry) => (
              <Link key={entry.id} href={entry.href} className="sui-mobile-tab">
                <entry.icon size={20} strokeWidth={1.75} aria-hidden="true" />
                <span>{entry.shortLabel ?? entry.label}</span>
              </Link>
            ))}
            <Link href={accountHref} className="sui-mobile-tab">
              <UserRound size={20} strokeWidth={1.75} aria-hidden="true" />
              <span>Compte</span>
            </Link>
          </nav>

          {drawerOpen ? (
            <HubDrawer
              entries={entries}
              accountHref={accountHref}
              onClose={() => setDrawerOpen(false)}
              onSignOut={onSignOut}
            />
          ) : null}
        </div>
      </div>
    </SoftMotionProvider>
  );
}
