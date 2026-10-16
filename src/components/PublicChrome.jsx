"use client";

import { usePathname } from "next/navigation";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";

/**
 * Chrome du site public (navigation, pied de page) pour les pages publiques
 * uniquement. Les espaces privés et les pages d'authentification gardent leur
 * propre en-tête : le chrome public n'y apparaît plus en double.
 */
const SESSION_PREFIXES = [
  "/espace-client",
  "/espace-equipe",
  "/espace-personnel",
  "/espace-comexa",
  "/connexion",
  "/inscription",
  "/verify-email",
  "/mot-de-passe-oublie",
  "/reset-password",
];

export default function PublicChrome({ children }) {
  const pathname = usePathname() ?? "/";
  const isSession = SESSION_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (isSession) {
    return children;
  }

  return (
    <div className="cx-pub flex min-h-full flex-1 flex-col">
      <Navbar />
      {children}
      <Footer />
    </div>
  );
}
