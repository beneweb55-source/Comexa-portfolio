"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/session";

/**
 * Cadre commun des espaces client et equipe : en-tete, navigation, sortie.
 * Les couleurs et polices reprennent celles du site public.
 */
export default function WorkspaceShell({ title, subtitle, items, children }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.replace("/connexion");
  }

  const name = user ? `${user.firstName} ${user.lastName}` : "";

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-[#F8F9FC]">
      <header className="border-b border-dotted border-[#1683E5] bg-white">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div>
            <p className="text-[13px] text-[#4B5563]">{name}</p>
            <h1 className="text-[22px] font-semibold text-[#0B2545]">{title}</h1>
            {subtitle ? <p className="text-[14px] text-[#4B5563]">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="h-10 rounded-lg border border-[#0B2545] px-5 text-[14px] font-medium text-[#0B2545] transition hover:bg-[#0B2545] hover:text-white"
          >
            Se déconnecter
          </button>
        </div>
        <nav aria-label="Navigation de l'espace" className="mx-auto max-w-[1200px] px-4 sm:px-8">
          <ul className="flex flex-wrap gap-1">
            {items.map((item) => {
              const active = pathname === item.href || (item.nested && pathname.startsWith(`${item.href}/`));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`inline-block border-b-2 px-3 py-3 text-[15px] font-medium transition ${
                      active
                        ? "border-[#1683E5] text-[#0B2545]"
                        : "border-transparent text-[#4B5563] hover:text-[#1E86E0]"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}
