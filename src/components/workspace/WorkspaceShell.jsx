"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/session";
import logo from "../../../public/comexa-logo-horizontal-transparent.png";

/**
 * Cadre commun des espaces client et équipe : en-tête collant, navigation, sortie.
 * Le logo est celui du projet, sans modification. L'état actif est signalé par la
 * couleur et le fond, jamais par un soulignement décoratif (charte, section 11).
 */
export default function WorkspaceShell({ space, title, subtitle, items, children }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.replace("/connexion");
  }

  const name = user ? `${user.firstName} ${user.lastName}` : "";

  return (
    <div className="cx-app flex min-h-screen flex-1 flex-col bg-[var(--comexa-neutral-100)]">
      <header className="cx-header">
        <div className="cx-container flex items-center justify-between gap-6 py-4">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/" aria-label="Accueil COMEXA" className="shrink-0">
              <Image src={logo} alt="COMEXA" width={130} height={30} className="h-auto w-[120px]" priority />
            </Link>
            <span aria-hidden="true" className="hidden h-6 w-px bg-[var(--comexa-border-soft)] sm:block" />
            <div className="hidden min-w-0 sm:block">
              <p className="cx-caption truncate">{name}</p>
            </div>
          </div>
          <button type="button" onClick={handleLogout} className="cx-btn cx-btn--outline cx-btn--sm">
            Se déconnecter
          </button>
        </div>
        <nav aria-label="Navigation de l'espace" className="cx-container overflow-x-auto pb-3">
          <ul className="flex w-max gap-1">
            {items.map((item) => {
              const active = pathname === item.href || (item.nested && pathname.startsWith(`${item.href}/`));
              return (
                <li key={item.href}>
                  <Link href={item.href} aria-current={active ? "page" : undefined} className="cx-nav-link">
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main className="cx-container w-full flex-1 py-10 sm:py-12">
        <div className="mb-10 max-w-[760px]">
          <p className="cx-eyebrow mb-3">{space}</p>
          <h1>{title}</h1>
          {subtitle ? <p className="cx-lead mt-3">{subtitle}</p> : null}
        </div>
        {children}
      </main>
    </div>
  );
}
