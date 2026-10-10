"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/session";
import MeshBackground from "@/components/dashboard/MeshBackground";
import logo from "../../../public/comexa-logo-horizontal-transparent.png";
import logoClair from "../../../public/comexa-logo-horizontal-clair-transparent.png";

/**
 * Cadre commun des espaces client et équipe : en-tête collant, navigation, sortie.
 * Le logo est celui du projet, sans modification. L'état actif est signalé par la
 * couleur et le fond, jamais par un soulignement décoratif (charte, section 11).
 *
 * Sur le tableau de bord, le cadre entier passe en « plaque de verre sombre » :
 * fond mesh, barre supérieure en verre dépoli, textes clairs. Les autres pages
 * gardent le thème clair, dont dépendent leurs formulaires et tableaux.
 */
const DARK_ROUTES = ["/espace-equipe/tableau-de-bord"];

export default function WorkspaceShell({ space, title, subtitle, items, children }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const dark = DARK_ROUTES.includes(pathname);

  async function handleLogout() {
    await logout();
    router.replace("/connexion");
  }

  const name = user ? `${user.firstName} ${user.lastName}` : "";

  return (
    <div
      className={
        dark
          ? "cx-app relative isolate flex min-h-screen flex-1 flex-col overflow-hidden bg-[#071a33] text-white/80"
          : "cx-app flex min-h-screen flex-1 flex-col bg-[var(--comexa-neutral-100)]"
      }
    >
      {dark ? <MeshBackground className="fixed" /> : null}

      <header
        className={
          dark
            ? "sticky top-0 z-30 border-b border-white/10 bg-black/20 backdrop-blur-md"
            : "cx-header"
        }
      >
        <div className="cx-container flex items-center justify-between gap-6 py-4">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/" aria-label="Accueil COMEXA" className="shrink-0">
              <Image src={dark ? logoClair : logo} alt="COMEXA" width={130} height={30} className="h-auto w-[120px]" priority />
            </Link>
            <span aria-hidden="true" className={`hidden h-6 w-px sm:block ${dark ? "bg-white/15" : "bg-[var(--comexa-border-soft)]"}`} />
            <div className="hidden min-w-0 sm:block">
              <p className={`cx-caption truncate ${dark ? "!text-white/70" : ""}`}>{name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className={`cx-btn cx-btn--outline cx-btn--sm ${dark ? "!border-white/20 !bg-transparent !text-white hover:!bg-white/10" : ""}`}
          >
            Se déconnecter
          </button>
        </div>
        <nav aria-label="Navigation de l'espace" className="cx-container overflow-x-auto pb-3">
          <ul className="flex w-max gap-1">
            {items.map((item) => {
              const active = pathname === item.href || (item.nested && pathname.startsWith(`${item.href}/`));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`cx-nav-link ${dark ? (active ? "!bg-white/12 !text-white" : "!text-white/65 hover:!text-white") : ""}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main className="cx-container relative w-full flex-1 py-10 sm:py-12">
        <div className="mb-10 max-w-[760px]">
          <p className={`cx-eyebrow mb-3 ${dark ? "!text-sky-300/80" : ""}`}>{space}</p>
          <h1 className={dark ? "!text-white" : ""}>{title}</h1>
          {subtitle ? <p className={`cx-lead mt-3 ${dark ? "!text-white/60" : ""}`}>{subtitle}</p> : null}
        </div>
        {children}
      </main>
    </div>
  );
}
