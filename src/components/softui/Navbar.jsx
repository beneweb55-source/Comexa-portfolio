"use client";

/*
 * Navbar noire (64 px) de la coque.
 *
 * - à gauche : logo Comexa, puis le SÉLECTEUR D'ESPACE (espace actif toujours
 *   visible). L'ancien badge « admin », affiché à TOUS les membres quel que soit
 *   leur rôle, a disparu : le rôle réel est rappelé dans le sélecteur ;
 * - au centre : les onglets autorisés de l'espace. Seul l'onglet actif déplie sa
 *   pilule (`layoutId`). La rubrique courante est TOUJOURS représentée : si elle
 *   ne fait pas partie des onglets prioritaires, elle prend la dernière place,
 *   au lieu de laisser « Tableau de bord » faussement actif ;
 * - à droite : profil (UserMenu).
 *
 * `onActiveTabMove` reçoit `{ center, pillWidth }` de l'onglet actif : la coque
 * y aligne la languette noire qui descend dans le panneau clair, et lui donne
 * la largeur de la pilule (le corps de la languette s'y superpose exactement).
 */

import Image from "next/image";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { LayoutGroup, motion } from "framer-motion";
import logoLight from "../../../public/comexa-logo-horizontal-clair-transparent.png";
import UserMenu from "@/components/workspace/UserMenu";
import SpaceSwitcher from "./SpaceSwitcher";
import Tooltip from "./Tooltip";
import { layoutSpring } from "./motion";

export default function Navbar({ items, activeHref, space, user, homeHref = "/", badge, profile, onActiveTabMove }) {
  const active = items.find((item) => item.href === activeHref);
  const listRef = useRef(null);

  // Position et largeur de l'onglet actif (et après chaque redimensionnement) :
  // la languette suit l'onglet et épouse sa pilule, elle ne reste plus centrée
  // sur le panneau.
  useLayoutEffect(() => {
    if (!onActiveTabMove) return undefined;
    const list = listRef.current;
    if (!list) return undefined;

    function report() {
      const link = list.querySelector('[aria-current="page"]');
      if (!link) {
        onActiveTabMove(null);
        return;
      }
      const rect = link.getBoundingClientRect();
      onActiveTabMove({ center: rect.left + rect.width / 2, pillWidth: rect.width });
    }

    report();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(report) : null;
    observer?.observe(list);
    observer?.observe(document.documentElement);
    list.addEventListener("scroll", report, { passive: true });
    window.addEventListener("resize", report);
    // La pilule glisse (layoutId) : une seconde mesure après l'animation.
    const settle = window.setTimeout(report, 320);
    return () => {
      observer?.disconnect();
      list.removeEventListener("scroll", report);
      window.removeEventListener("resize", report);
      window.clearTimeout(settle);
    };
  }, [activeHref, items, onActiveTabMove]);

  return (
    <header className="sui-nav">
      <div className="sui-nav__brand">
        <Link href={homeHref} className="sui-nav__logo" aria-label="Comexa, accueil de l’espace">
          <Image src={logoLight} alt="" width={112} height={26} className="sui-nav__logo-img" priority />
        </Link>
        {space ? <SpaceSwitcher active={space} user={user} /> : badge ? <span className="sui-nav__role">{badge}</span> : null}
      </div>

      <nav className="sui-nav__center" aria-label="Rubriques de l’espace">
        <LayoutGroup id="sui-nav">
          <ul className="sui-nav__links" ref={listRef}>
            {items.map((item) => {
              const isActive = item.href === activeHref;
              return (
                <li key={item.href} className="sui-nav__item">
                  <Tooltip label={item.label} placement="bottom">
                    <Link
                      href={item.href}
                      className="sui-nav__link"
                      aria-current={isActive ? "page" : undefined}
                      aria-label={isActive ? undefined : item.label}
                      title={item.label}
                    >
                      {isActive ? (
                        <motion.span layoutId="sui-nav-pill" className="sui-nav__pill" transition={layoutSpring} aria-hidden="true" />
                      ) : null}
                      <span className="sui-nav__link-inner">
                        <item.icon size={19} strokeWidth={1.75} aria-hidden="true" />
                        {isActive ? <span className="sui-nav__label">{item.label}</span> : null}
                      </span>
                    </Link>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        </LayoutGroup>
      </nav>

      <div className="sui-nav__profile">
        <span className="sui-visually-hidden" aria-live="polite">
          {active ? `Section active : ${active.label}` : ""}
        </span>
        {profile ?? <UserMenu variant="softui" />}
      </div>
    </header>
  );
}
