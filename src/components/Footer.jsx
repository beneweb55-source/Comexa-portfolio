"use client";

import Image from "next/image";
import Link from "next/link";
import logo from "../../public/comexa-logo-horizontal-clair-transparent.png";

/*
 * Logo : variante claire, utilisée sur fond navy. Elle reste une proposition à
 * valider par le propriétaire de la marque (voir le rapport de refonte).
 */
export default function Footer() {
  return (
    <footer className="cx-pub-footer">
      <div className="cx-pub-container">
        <div className="cx-pub-footer__grid">
          <div>
            <Link href="/" aria-label="Comexa, accueil" style={{ display: "inline-flex", minHeight: 44, alignItems: "center" }}>
              <Image src={logo} alt="Comexa" width={200} height={46} className="h-auto w-[min(200px,100%)]" />
            </Link>
            <p style={{ marginTop: "var(--comexa-space-4)", fontSize: 20, lineHeight: 1.3, color: "#ffffff", fontWeight: 500, maxWidth: "20ch" }}>
              Naviguer le digital ensemble.
            </p>
            <p style={{ marginTop: "var(--comexa-space-3)", fontSize: 14, lineHeight: 1.6, color: "rgb(255 255 255 / 0.72)", maxWidth: "36ch" }}>
              Agence spécialisée exclusivement en conception et développement web.
            </p>
          </div>

          <nav aria-label="Explorer">
            <h3>Explorer</h3>
            <ul>
              <li><Link href="/#agence">L’agence</Link></li>
              <li><Link href="/#services">Services</Link></li>
              <li><Link href="/realisations">Réalisations</Link></li>
              <li><Link href="/#contact">Contact</Link></li>
            </ul>
          </nav>

          <nav aria-label="Expertises">
            <h3>Expertises</h3>
            <ul>
              <li><Link href="/services">Sites vitrines</Link></li>
              <li><Link href="/services">E-commerce</Link></li>
              <li><Link href="/services">Applications web</Link></li>
              <li><Link href="/services">Maintenance</Link></li>
            </ul>
          </nav>

          <nav aria-label="Nous suivre">
            <h3>Nous suivre</h3>
            <ul>
              <li><a href="#" aria-disabled="true">LinkedIn</a></li>
              <li><a href="#" aria-disabled="true">Instagram</a></li>
              <li><a href="mailto:bonjour@comexa.dz">bonjour@comexa.dz</a></li>
            </ul>
          </nav>
        </div>

        <div className="cx-pub-footer__base">
          <p>© 2026 Comexa. Tous droits réservés.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--comexa-space-6)" }}>
            <a href="#">Mentions légales</a>
            <a href="#">Politique de confidentialité</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
