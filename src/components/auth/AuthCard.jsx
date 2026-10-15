"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import logo from "../../../public/comexa-logo-horizontal-transparent.png";

export function AuthCard({ eyebrow = "Espace Comexa", title, subtitle, intro, children, footer }) {
  const description = subtitle ?? intro;

  return (
    <main className="relative flex min-h-screen flex-col justify-center overflow-hidden px-5 py-12">
      {/* Halo atmosphérique Comexa */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(920px 520px at 15% 10%, rgba(30, 134, 224, 0.14), transparent 60%), radial-gradient(840px 480px at 85% 90%, rgba(79, 176, 240, 0.12), transparent 60%), linear-gradient(180deg, #f4f8fd 0%, #ebf3fc 100%)",
        }}
      />

      <div className="mx-auto w-full max-w-[460px]">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link href="/" aria-label="Retour à l'accueil COMEXA" className="inline-flex items-center gap-3 text-[var(--comexa-ink)] no-underline">
            <Image
              src={logo}
              alt="COMEXA"
              width={136}
              height={32}
              className="h-auto w-[142px]"
              priority
            />
          </Link>
          <Link
            href="/"
            className="cx-btn cx-btn--secondary cx-btn--sm"
          >
            <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
            <span>Accueil</span>
          </Link>
        </div>

        <section
          aria-labelledby="auth-card-title"
          className="cx-card flex flex-col gap-5 !rounded-[26px] !p-7 sm:!p-8"
        >
          <div>
            <p className="cx-eyebrow">{eyebrow}</p>
            <h1 id="auth-card-title" className="cx-h2 mt-2 !text-[24px]">
              {title}
            </h1>
            {description ? <p className="cx-small mt-1.5">{description}</p> : null}
          </div>

          <div>{children}</div>

          {footer ? (
            <div className="border-t border-[var(--comexa-border-soft)] pt-4 text-[13.5px] text-[var(--comexa-ink-soft)]">
              {footer}
            </div>
          ) : null}
        </section>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[12px] text-[var(--comexa-ink-muted)]">
          <ShieldCheck size={14} className="text-[var(--comexa-accent)]" aria-hidden="true" />
          <span>Connexion sécurisée et chiffrée · Comexa</span>
        </p>
      </div>
    </main>
  );
}

export default AuthCard;
export { Field } from "@/components/workspace/ui";
