"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import logo from "../../public/comexa-logo-horizontal-transparent.png";
import UserMenu from "@/components/workspace/UserMenu";
import { useAuth } from "@/lib/session";

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

function AccountActions({ status, inDrawer = false }) {
  if (status === "authenticated") {
    return <UserMenu variant="public" compact={false} />;
  }
  if (status === "loading") {
    return <span className="cx-pub-account-loading" role="status" aria-label="Vérification de la session" />;
  }

  return (
    <div className={inDrawer ? "cx-pub-account-links cx-pub-account-links--drawer" : "cx-pub-account-links"}>
      {accountLinks.map((link) => (
        <Link key={link.href} href={link.href} className={inDrawer ? "cx-pub-drawer__link" : "cx-pub-nav__link"}>
          {link.label}
        </Link>
      ))}
    </div>
  );
}

/** Navigation publique avec l'état de session réel (sans profil fictif). */
export default function Navbar() {
  const pathname = usePathname() ?? "/";
  return <NavbarContent key={pathname} pathname={pathname} />;
}

function NavbarContent({ pathname }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { status } = useAuth();
  const burgerRef = useRef(null);
  const drawerRef = useRef(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!isMenuOpen) {
      if (wasOpen.current) burgerRef.current?.focus();
      wasOpen.current = false;
      return undefined;
    }

    wasOpen.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const drawerLinks = () => [...(drawerRef.current?.querySelectorAll("a[href], button:not(:disabled)") ?? [])];
    // Le bouton « Fermer le menu » reste visible au-dessus du voile : il fait
    // partie de la boucle de tabulation, avec les liens du panneau.
    const focusable = () => [burgerRef.current, ...drawerLinks()].filter(Boolean);
    drawerLinks()[0]?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const focusOutsideMenu = !nodes.includes(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || focusOutsideMenu)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || focusOutsideMenu)) {
        event.preventDefault();
        first.focus();
      }
    }

    // Passage à la mise en page bureau (rotation, fenêtre agrandie) : le bouton
    // du menu disparaît, le tiroir ne doit pas rester ouvert ni bloquer le défilement.
    const desktop = window.matchMedia("(min-width: 1000px)");
    function handleDesktop(event) {
      if (event.matches) setIsMenuOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    desktop.addEventListener("change", handleDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      desktop.removeEventListener("change", handleDesktop);
    };
  }, [isMenuOpen]);


  return (
    <header className="cx-pub-nav">
      <div className="cx-pub-nav__bar">
        <Link href="/" aria-label="Comexa, accueil" onClick={() => setIsMenuOpen(false)} style={{ display: "flex", alignItems: "center", minHeight: 44 }}>
          <Image src={logo} alt="Comexa" width={130} height={30} className="h-auto w-[min(130px,38vw)]" priority />
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
          <div className="cx-pub-nav__desktop-account">
            <AccountActions status={status} />
          </div>
          <Link href="/contact" className="cx-btn cx-btn--primary cx-btn--sm cx-pub-nav__cta">
            Parlons de votre projet
          </Link>
          <button
            ref={burgerRef}
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
        <div
          id="mobile-navigation"
          ref={drawerRef}
          className="cx-pub-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation principale"
          onClick={(event) => event.target === event.currentTarget && setIsMenuOpen(false)}
        >
          <div className="cx-pub-drawer__panel">
            <nav aria-label="Navigation mobile" className="cx-pub-drawer__nav">
              {navigationLinks.map((link) => (
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
            <div className="cx-pub-drawer__account">
              <AccountActions status={status} inDrawer />
            </div>
            <Link href="/contact" className="cx-btn cx-btn--accent cx-btn--lg cx-btn--block" onClick={() => setIsMenuOpen(false)}>
              Parlons de votre projet
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
