import Link from "next/link";
import Image from "next/image";
import logo from "../../../public/comexa-logo-horizontal-transparent.png";

/** Forme décorative de la charte : purement visuelle, masquée aux technologies d'assistance. */
function Shape({ className }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={`cx-shape ${className}`} width="28" height="28">
      <path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

/** Cadre commun des pages d'authentification publiques (connexion, inscription, vérification). */
export default function AuthCard({ title, intro, children, footer }) {
  return (
    <main className="cx-app relative flex flex-1 items-start justify-center overflow-hidden bg-[var(--comexa-surface-alt)] px-4 py-12 sm:py-20">
      <Shape className="left-[8%] top-[12%]" />
      <Shape className="bottom-[10%] right-[9%] text-[var(--comexa-accent)]" />
      <div className="relative w-full max-w-[480px]">
        <div className="mb-8 flex justify-center">
          <Link href="/" aria-label="Retour à l'accueil COMEXA">
            <Image src={logo} alt="COMEXA" width={130} height={30} className="h-auto w-[150px]" />
          </Link>
        </div>
        <div className="cx-card cx-card--raised !p-8 sm:!p-10">
          <h1 className="!text-[34px] sm:!text-[40px]">{title}</h1>
          {intro ? <p className="cx-lead mt-3">{intro}</p> : null}
          <div className="mt-8">{children}</div>
        </div>
        {footer ? <div className="cx-small mt-6 text-center">{footer}</div> : null}
        <p className="cx-caption mt-5 text-center">
          <Link href="/" className="text-[var(--comexa-accent-text)] underline-offset-4 hover:underline">
            ← Retour au site COMEXA
          </Link>
        </p>
      </div>
    </main>
  );
}

export { Field } from "@/components/workspace/ui";
