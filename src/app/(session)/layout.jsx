"use client";

import { AuthProvider } from "@/lib/session";

/**
 * Session pour les seules pages qui en ont besoin (connexion, inscription,
 * espaces). Les pages publiques du site ne demandent donc jamais de rafraichissement.
 * Le groupe `(session)` n'apparait pas dans les URL.
 */
export default function SessionLayout({ children }) {
  return <AuthProvider>{children}</AuthProvider>;
}
