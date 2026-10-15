"use client";

/*
 * Navbar noire (64 px) de la coque.
 *
 * - à gauche : logo Comexa (identité conservée) + badge de rôle ;
 * - au centre : 6 à 8 icônes de navigation. Seul l'onglet actif déplie sa pilule
 *   (fond gris foncé, icône + libellé) et cette pilule glisse d'un onglet à l'autre
 *   grâce à `layoutId` ;
 * - à droite : avatar à initiales sur pastille, nom, courriel, chevron (UserMenu) ;
 * - < 1024 px : la barre passe en bas de l'écran et n'affiche que des icônes,
 *   le libellé restant sur l'onglet actif (accessibilité conservée).
 */

import Image from "next/image";
import Link from "next/link";
import { LayoutGroup, motion } from "framer-motion";
import logoLight from "../../../public/comexa-logo-horizontal-clair-transparent.png";
import UserMenu from "@/components/workspace/UserMenu";
import Tooltip from "./Tooltip";
import { layoutSpring } from "./motion";

export default function Navbar({ items, activeHref, roleLabel, homeHref = "/", profile }) {
  const active = items.find((item) => item.href === activeHref);

  return (
    <header className="sui-nav">
      <div className="sui-nav__brand">
        <Link href={homeHref} className="sui-nav__logo" aria-label="Comexa, accueil de l’espace">
          <Image src={logoLight} alt="" width={112} height={26} className="sui-nav__logo-img" priority />
        </Link>
        <span className="sui-nav__logo-dot" aria-hidden="true" />
        {roleLabel ? <span className="sui-nav__role">{roleLabel}</span> : null}
      </div>

      <nav className="sui-nav__center" aria-label={`Navigation ${roleLabel ?? "principale"}`}>
        <LayoutGroup id="sui-nav">
          <ul className="sui-nav__links">
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
