"use client";

import Image from "next/image";
import Link from "next/link";
import logo from "../../public/comexa-logo-horizontal-clair-transparent.png";
import { SITE_CONTACT, SITE_LEGAL, SITE_SOCIALS, availableLinks } from "@/lib/site";

/*
 * Logo : variante claire, utilisée sur fond navy. Elle reste une proposition à
 * valider par le propriétaire de la marque (voir le rapport de refonte).
 *
 * Chaque lien mène à une page réelle. Réseaux sociaux et pages légales viennent de
 * `src/lib/site.js` et n'apparaissent qu'une fois leur adresse renseignée.
 */
const EXPLORE_LINKS = [
  { href: "/#agence", label: "L’agence" },
  { href: "/services", label: "Services" },
  { href: "/realisations", label: "Réalisations" },
  { href: "/partenaires", label: "Partenaires" },
  { href: "/contact", label: "Contact" },
];

const EXPERTISES = ["Sites vitrines", "E-commerce", "Applications web", "Maintenance"];

export default function Footer() {
  const socials = availableLinks(SITE_SOCIALS);
  const legal = availableLinks(SITE_LEGAL);

  return (
    <footer className="cx-pub-footer">
      <div className="cx-pub-container">
        <div className="cx-pub-footer__grid">
          <div>
            <Link href="/" aria-label="Comexa, accueil" style={{ display: "inline-flex", minHeight: 44, alignItems: "center" }}>
              <Image src={logo} alt="Comexa" width={200} height={46} className="h-auto w-[min(200px,100%)]" />
            </Link>
            <p className="cx-pub-footer__tagline">Naviguer le digital ensemble.</p>
            <p className="cx-pub-footer__text">Agence spécialisée exclusivement en conception et développement web.</p>
          </div>

          <nav aria-label="Explorer">
            <h3>Explorer</h3>
            <ul>
              {EXPLORE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Expertises">
            <h3>Expertises</h3>
            <ul>
              {EXPERTISES.map((label) => (
                <li key={label}>
                  <Link href="/services">{label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h3>Nous joindre</h3>
            <ul>
              <li>
                <a href={`mailto:${SITE_CONTACT.email}`}>{SITE_CONTACT.email}</a>
              </li>
              {socials.map((social) => (
                <li key={social.label}>
                  <a href={social.href} target="_blank" rel="noopener noreferrer">
                    {social.label}
                  </a>
                </li>
              ))}
            </ul>
            <p className="cx-pub-footer__text">{SITE_CONTACT.hours}</p>
            <Link href="/contact" className="cx-pub-footer__cta">
              Parlons de votre projet <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        <div className="cx-pub-footer__base">
          {/* L'année peut changer entre la génération statique et l'affichage. */}
          <p suppressHydrationWarning>© {new Date().getFullYear()} Comexa. Tous droits réservés.</p>
          {legal.length ? (
            <ul className="cx-pub-footer__legal">
              {legal.map((link) => (
                <li key={link.label}>
                  <a href={link.href}>{link.label}</a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
