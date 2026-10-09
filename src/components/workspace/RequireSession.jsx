"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/session";
import { allowedPath } from "@/lib/access";

/**
 * Garde d'un espace : sans session, retour a la connexion (avec retour apres
 * connexion) ; avec une session sans les droits requis, retour a l'espace client.
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
      router.replace("/espace-client");
    }
  }, [status, allowed, pathname, router]);

  if (!allowed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-[15px] text-[#4B5563]" role="status">
        Chargement de votre espace…
      </div>
    );
  }

  return children;
}
