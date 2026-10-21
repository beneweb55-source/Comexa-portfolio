"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import logoLight from "../../../public/comexa-logo-horizontal-clair-transparent.png";

/**
 * Carte de connexion — dans la coque du dashboard.
 *
 * L'application desktop et l'application Android tombent sur `/connexion`
 * quand le compte n'est pas encore connecté : c'est donc le PREMIER écran de
 * ces deux applications. Il porte la même coque noire que le dashboard (barre
 * noire, marque claire, panneau clair) : l'application ne commence plus par une
 * page de site public avant de basculer dans le produit.
 *
 * Le formulaire, lui, n'a pas bougé : les champs utilisent déjà les primitives
 * du design system (`sui-field`), et les cartes gardent les libellés et les
 * erreurs de chaque page.
 */
export function AuthCard({ eyebrow = "Espace Comexa", title, subtitle, intro, children, footer }) {
  const description = subtitle ?? intro;

  return (
    <main className="cx-auth">
      <div className="sui-shell cx-auth__shell">
        {/* Barre noire : même marque, même hauteur et même noir que la coque
            du dashboard (64 px). */}
        <header className="sui-nav">
          <div className="sui-nav__brand">
            <Link href="/" className="sui-nav__logo" aria-label="Retour à l'accueil COMEXA">
              <Image src={logoLight} alt="COMEXA" width={112} height={26} className="sui-nav__logo-img" priority />
            </Link>
            <span className="sui-nav__role">espace de travail</span>
          </div>
          <div className="sui-nav__profile">
            <Link href="/" className="cx-btn cx-btn--secondary cx-btn--sm">
              <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
              <span>Accueil</span>
            </Link>
          </div>
        </header>

        {/* Sur téléphone, la navbar descend en bas : la barre d'application la
            remplace, avec la même marque claire. */}
        <header className="sui-appbar">
          <Link href="/" className="sui-appbar__logo" aria-label="Retour à l'accueil COMEXA">
            <Image src={logoLight} alt="COMEXA" width={96} height={22} priority />
          </Link>
          <div className="sui-appbar__tools">
            <Link href="/" className="sui-appbar__icon" aria-label="Retour à l'accueil COMEXA">
              <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>
        </header>

        <div className="sui-shell__body">
          <div className="sui-main">
            <div className="cx-auth__panel">
              <div className="cx-auth__inner">
                <section aria-labelledby="auth-card-title" className="cx-card flex flex-col gap-5 !rounded-[26px] !p-7 sm:!p-8">
                  <div>
                    <p className="cx-eyebrow">{eyebrow}</p>
                    <h1 id="auth-card-title" className="cx-h2 mt-2 !text-[24px]">
                      {title}
                    </h1>
                    {description ? <p className="cx-small mt-1.5">{description}</p> : null}
                  </div>

                  <div>{children}</div>

                  {footer ? (
                    <div className="border-t border-[var(--comexa-border-soft)] pt-4 text-[13.5px] text-[var(--comexa-ink-soft)]">{footer}</div>
                  ) : null}
                </section>

                <p className="cx-auth__note mt-5 flex items-center justify-center gap-1.5 text-center text-[12px]">
                  <ShieldCheck size={14} className="text-[var(--comexa-accent)]" aria-hidden="true" />
                  <span>Connexion sécurisée et chiffrée · Comexa</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default AuthCard;
export { Field } from "@/components/workspace/ui";
