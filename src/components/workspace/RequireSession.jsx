"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/session";
import { allowedPath, homeFor } from "@/lib/access";

/**
 * Garde d'un espace : sans session, retour à la connexion avec retour après
 * connexion ; sans la permission de cette route, retour à une destination
 * autorisée pour le rôle. Le backend reste la protection des données.
 */
export default function RequireSession({ children }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const allowed = status === "authenticated" && allowedPath(user, pathname);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace(`/connexion?next=${encodeURIComponent(pathname)}`);
    } else if (status === "authenticated" && !allowed) {
      router.replace(homeFor(user));
    }
  }, [status, user, allowed, pathname, router]);

  if (!allowed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-[15px] text-[var(--comexa-ink-soft)]" role="status" aria-live="polite">
        Chargement de votre espace…
      </div>
    );
  }

  return children;
}
