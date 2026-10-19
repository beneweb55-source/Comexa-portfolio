"use client";

/*
 * Sélecteur d'espace de travail — Espace personnel, Espace équipe, Comexa Space.
 *
 * Placé dans la navigation globale (à droite du logo), il montre en permanence
 * l'espace actif et propose UNIQUEMENT les espaces que l'API ouvre au compte
 * (`GET /me/spaces`). Changer d'espace conduit à la même rubrique dans l'espace
 * cible quand elle existe (calendrier -> calendrier), sinon à son accueil.
 *
 * Accessibilité : bouton `aria-haspopup="menu"`, menu au clavier (flèches,
 * Début/Fin, Entrée, Échap), focus rendu au déclencheur à la fermeture, élément
 * actif signalé par `aria-current`. Les compteurs restent par espace : jamais
 * additionnés.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Building2, Check, ChevronDown, LayoutGrid, UserRound, UsersRound } from "lucide-react";
import { SPACES, equivalentPath } from "@/lib/spaces";
import { sectionHrefs } from "@/lib/space-navigation";
import { useSpaces } from "@/lib/spaces-context";

/** Icône de chaque espace. Exportée : le hub `/espaces` affiche les mêmes. */
export const SPACE_ICON = { personal: UserRound, team: UsersRound, comexa: Building2 };

const ROLE_LABEL = {
  ADMIN: "Administrateur",
  COMMUNICATION_MANAGER: "Gérant communication",
  PROJECT_MANAGER: "Chef de projet",
  DEVELOPER: "Développeur",
  SOCIAL_MEDIA_MANAGER: "Gestion réseaux sociaux",
  SALES: "Commercial",
  CLIENT: "Client",
};

export function roleLabelOf(user) {
  const roles = (user?.roles ?? []).map((role) => (typeof role === "string" ? role : role?.code)).filter(Boolean);
  return roles.map((role) => ROLE_LABEL[role] ?? role).join(" · ");
}

/** Liste des espaces (popover desktop ou bloc du tiroir mobile). */
function SpaceOptions({ active, spaces, unreadBySpace, onPick, itemRefs, variant = "menu" }) {
  return spaces.map((space, index) => {
    const meta = SPACES[space.id];
    const Icon = SPACE_ICON[space.id];
    const isActive = space.id === active;
    const unread = Number(unreadBySpace?.[space.id] ?? 0);
    return (
      <button
        key={space.id}
        ref={itemRefs ? (node) => { itemRefs.current[index] = node; } : undefined}
        type="button"
        role={variant === "menu" ? "menuitemradio" : undefined}
        aria-checked={variant === "menu" ? isActive : undefined}
        aria-current={isActive ? "true" : undefined}
        className={`sui-space-option${isActive ? " sui-space-option--active" : ""}`}
        onClick={() => onPick(space.id)}
      >
        <span className="sui-space-option__icon" style={{ "--tone-bg": `var(--${meta.tone})` }} aria-hidden="true">
          <Icon size={18} strokeWidth={1.75} />
        </span>
        <span className="sui-space-option__copy">
          <span className="sui-space-option__label">{meta.label}</span>
          <span className="sui-space-option__desc">{meta.description}</span>
        </span>
        {unread > 0 ? (
          <span className="sui-space-option__badge" aria-label={`${unread} notification${unread > 1 ? "s" : ""} non lue${unread > 1 ? "s" : ""}`}>
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
        {isActive ? <Check size={17} strokeWidth={2} className="sui-space-option__check" aria-hidden="true" /> : null}
      </button>
    );
  });
}

function useSpaceNavigation() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { spaces, permissionsFor } = useSpaces();
  const go = useCallback(
    (target) => {
      const hrefs = sectionHrefs(target, permissionsFor(target) ?? []);
      router.push(equivalentPath(pathname, target, hrefs));
    },
    [pathname, permissionsFor, router],
  );
  return { spaces, go };
}

/** Sélecteur de la navbar (desktop et tablette). */
export default function SpaceSwitcher({ active, user }) {
  const { spaces, go } = useSpaceNavigation();
  const { unreadBySpace } = useSpaces();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);
  const meta = SPACES[active];
  const Icon = SPACE_ICON[active] ?? UsersRound;
  const otherUnread = spaces.filter((space) => space.id !== active).reduce((sum, space) => sum + Number(unreadBySpace?.[space.id] ?? 0), 0);

  useEffect(() => {
    if (!open) return undefined;
    const activeIndex = Math.max(0, spaces.findIndex((space) => space.id === active));
    itemRefs.current[activeIndex]?.focus();

    function onPointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      const items = itemRefs.current.filter(Boolean);
      const index = items.indexOf(document.activeElement);
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        items[items.length - 1]?.focus();
      } else if (event.key === "Tab") {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, open, spaces]);

  if (!meta) return null;

  // Un seul espace ouvert : pas de menu, juste l'indication de l'espace actif.
  if (spaces.length <= 1) {
    return (
      <span className="sui-space-trigger sui-space-trigger--static" title={meta.description}>
        <span className="sui-space-trigger__icon" style={{ "--tone-bg": `var(--${meta.tone})` }} aria-hidden="true">
          <Icon size={15} strokeWidth={1.9} />
        </span>
        <span className="sui-space-trigger__label">{meta.label}</span>
      </span>
    );
  }

  return (
    <div className="sui-space" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="sui-space-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Espace actif : ${meta.label}. Changer d’espace`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sui-space-trigger__icon" style={{ "--tone-bg": `var(--${meta.tone})` }} aria-hidden="true">
          <Icon size={15} strokeWidth={1.9} />
        </span>
        <span className="sui-space-trigger__label">{meta.label}</span>
        {otherUnread > 0 ? <span className="sui-space-trigger__dot" aria-hidden="true" /> : null}
        <ChevronDown size={16} strokeWidth={1.9} className="sui-space-trigger__chevron" aria-hidden="true" />
      </button>

      {open ? (
        <div className="sui-space-menu" id={menuId} role="menu" aria-label="Choisir un espace de travail">
          <p className="sui-space-menu__head">
            Espaces de travail
            {roleLabelOf(user) ? <span>{roleLabelOf(user)}</span> : null}
          </p>
          <SpaceOptions
            active={active}
            spaces={spaces}
            unreadBySpace={unreadBySpace}
            itemRefs={itemRefs}
            onPick={(id) => {
              setOpen(false);
              if (id !== active) go(id);
            }}
          />
          {/* Le hub : la même liste, en pleine page. C'est l'écran d'accueil de
              l'application desktop, où aucun espace n'est encore actif. */}
          <Link href="/espaces" className="sui-space-menu__hub" onClick={() => setOpen(false)}>
            <LayoutGrid size={16} strokeWidth={1.9} aria-hidden="true" />
            Tous les espaces
          </Link>
          <p className="sui-space-menu__foot">
            Chaque espace n’affiche que ses propres données ; vos droits y sont vérifiés par le serveur.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Variante du tiroir de navigation (mobile) : liste toujours visible. */
export function SpaceSwitcherList({ active, onNavigate }) {
  const { spaces, go } = useSpaceNavigation();
  const { unreadBySpace } = useSpaces();
  if (spaces.length <= 1) return null;
  return (
    <div className="sui-space-list" role="group" aria-label="Espaces de travail">
      <SpaceOptions
        variant="list"
        active={active}
        spaces={spaces}
        unreadBySpace={unreadBySpace}
        onPick={(id) => {
          onNavigate?.();
          if (id !== active) go(id);
        }}
      />
      <Link href="/espaces" className="sui-space-menu__hub" onClick={() => onNavigate?.()}>
        <LayoutGrid size={16} strokeWidth={1.9} aria-hidden="true" />
        Tous les espaces
      </Link>
    </div>
  );
}

/** Lien simple vers l'accueil d'un espace (utilisé par les états vides). */
export function SpaceLink({ space, children, className }) {
  const meta = SPACES[space];
  if (!meta) return null;
  return (
    <Link href={meta.home} className={className}>
      {children ?? meta.label}
    </Link>
  );
}
