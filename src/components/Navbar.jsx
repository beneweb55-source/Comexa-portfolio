"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import logo from "../../public/comexa-logo-horizontal-transparent.png";

const navigationLinks = [
  { href: "/", label: "L’agence" },
  { href: "/services", label: "Services" },
  { href: "/realisations", label: "Réalisations" },
  { href: "/partenaires", label: "Partenaires" },
];

const accountLinks = [
  { href: "/connexion", label: "Connexion" },
  { href: "/inscription", label: "Créer un compte" },
];

function isCurrent(pathname, href) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Navigation publique : barre flottante translucide au-dessus du contenu,
 * tiroir mobile avec voile flouté. Le flou n'est utilisé que sur ces éléments
 * flottants, jamais sur les cartes.
 */
export default function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const pathname = usePathname() ?? "/";

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isMenuOpen]);

  return (
    <header className="cx-pub-nav">
      <div className="cx-pub-nav__bar">
        <Link href="/" aria-label="Comexa, accueil" onClick={() => setIsMenuOpen(false)} style={{ display: "flex", alignItems: "center", minHeight: 44 }}>
          <Image src={logo} alt="Comexa" width={130} height={30} className="h-auto w-[min(130px,45vw)]" priority />
        </Link>

        <nav aria-label="Navigation principale" className="cx-pub-nav__links" style={{ marginInlineStart: "auto" }}>
          {navigationLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="cx-pub-nav__link"
              aria-current={isCurrent(pathname, link.href) ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="cx-pub-nav__actions">
          <div className="cx-pub-nav__links" style={{ marginInlineEnd: "var(--comexa-space-2)" }}>
            {accountLinks.map((link) => (
              <Link key={link.href} href={link.href} className="cx-pub-nav__link">
                {link.label}
              </Link>
            ))}
          </div>
          <Link href="/contact" className="cx-btn cx-btn--primary cx-btn--sm cx-pub-nav__cta">
            Parlons de votre projet
          </Link>
          <button
            type="button"
            className="cx-pub-nav__burger"
            aria-label={isMenuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <span className="cx-pub-nav__burger-bars" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
      </div>

      {isMenuOpen ? (
        <div id="mobile-navigation" className="cx-pub-drawer" onClick={(event) => event.target === event.currentTarget && setIsMenuOpen(false)}>
          <div className="cx-pub-drawer__panel">
            <nav aria-label="Navigation mobile" style={{ display: "flex", flexDirection: "column", gap: "var(--comexa-space-1)" }}>
              {[...navigationLinks, ...accountLinks].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="cx-pub-drawer__link"
                  aria-current={isCurrent(pathname, link.href) ? "page" : undefined}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <Link href="/contact" className="cx-btn cx-btn--accent cx-btn--lg cx-btn--block" onClick={() => setIsMenuOpen(false)} style={{ marginTop: "var(--comexa-space-3)" }}>
              Parlons de votre projet
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
