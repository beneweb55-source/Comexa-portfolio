
import "./globals.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import PublicChrome from "@/components/PublicChrome";
import RouteHistory from "@/components/RouteHistory";
import { AuthProvider } from "@/lib/session";


export const metadata = {
  metadataBase: new URL("https://comexa.dz"),
  title: {
    default: "Comexa — Le web qui avance avec votre entreprise",
    template: "%s · Comexa",
  },
  description:
    "Comexa conçoit et développe des sites vitrines, boutiques en ligne et applications web clairs, performants et faciles à faire évoluer. De l’idée à la mise en ligne, vous gardez le cap.",
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "Comexa",
    title: "Comexa — Le web qui avance avec votre entreprise",
    description:
      "Agence de développement web : sites vitrines, e-commerce, applications métier et maintenance. Un interlocuteur dédié, de la conception au suivi.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Comexa — Le web qui avance avec votre entreprise",
    description:
      "Sites vitrines, e-commerce et applications web conçus pour durer. Parlons de votre projet.",
  },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="fr"
      className="h-full bg-white antialiased"
    >
      <body
        suppressHydrationWarning
        className="flex min-h-full flex-col overflow-x-hidden bg-white text-gray-900"
      >
        <AuthProvider>
          <RouteHistory />
          <PublicChrome>{children}</PublicChrome>
        </AuthProvider>
      </body>
    </html>
  );
}
