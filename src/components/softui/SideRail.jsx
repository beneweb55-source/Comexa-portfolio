"use client";

/*
 * Rail gauche (56 px) : trois boutons ronds en haut (partager, menu, panneau de suivi),
 * la cloche avec son badge de compteur, puis les boutons + / − qui règlent la
 * densité du panneau principal. Masqué sous 1024 px (la navigation passe dans un
 * tiroir ouvert depuis la navbar).
 */

import { Bell, Menu as MenuIcon, Minus, PanelRight, Plus, Share2 } from "lucide-react";
import Link from "next/link";
import Tooltip from "./Tooltip";
import { IconButton } from "./primitives";

export default function SideRail({
  navigationButtonRef,
  onOpenNavigation,
  onToggleDesk,
  deskOpen = false,
  deskLabel = "panneau de suivi",
  onShare,
  unreadCount,
  onZoomIn,
  onZoomOut,
  zoom,
  canZoomIn,
  canZoomOut,
  notificationsHref,
  extra,
}) {
  return (
    <div className="sui-rail">
      <Tooltip label="Partager cet écran" placement="right">
        <button type="button" className="sui-rail__btn sui-rail__btn--ink" aria-label="Partager cet écran" onClick={onShare}>
          <Share2 size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip label="Toutes les rubriques" placement="right">
        <button ref={navigationButtonRef} type="button" className="sui-rail__btn" aria-label="Ouvrir toutes les rubriques" onClick={onOpenNavigation}>
          <MenuIcon size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </Tooltip>
      {onToggleDesk ? (
        <Tooltip label={deskOpen ? `Masquer « ${deskLabel} »` : `Afficher « ${deskLabel} »`} placement="right">
          <button
            type="button"
            className="sui-rail__btn sui-rail__btn--ink"
            aria-label={deskOpen ? `Masquer le panneau ${deskLabel}` : `Afficher le panneau ${deskLabel}`}
            aria-pressed={deskOpen}
            onClick={onToggleDesk}
          >
            <PanelRight size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}

      {extra}

      <div className="sui-rail__spacer" />

      {notificationsHref ? (
        <Tooltip label={unreadCount ? `Notifications — ${unreadCount} non lue${unreadCount > 1 ? "s" : ""}` : "Notifications"} placement="right">
          <Link href={notificationsHref} className="sui-rail__btn" aria-label={unreadCount ? `Notifications, ${unreadCount} non lues` : "Notifications"}>
            <Bell size={18} strokeWidth={1.75} aria-hidden="true" />
            {unreadCount ? (
              <span className="sui-rail__badge" aria-hidden="true">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Link>
        </Tooltip>
      ) : null}

      <div className="sui-rail__zoom">
        <IconButton
          icon={Plus}
          label="Agrandir le texte du panneau"
          tone="white"
          size="sm"
          tooltipPlacement="right"
          onClick={onZoomIn}
          disabled={!canZoomIn}
        />
        <IconButton
          icon={Minus}
          label="Réduire le texte du panneau"
          tone="white"
          size="sm"
          tooltipPlacement="right"
          onClick={onZoomOut}
          disabled={!canZoomOut}
        />
      </div>
      <span className="sui-visually-hidden" aria-live="polite">
        {zoom ? `Taille du texte : ${Math.round(zoom * 100)} %` : ""}
      </span>
    </div>
  );
}
