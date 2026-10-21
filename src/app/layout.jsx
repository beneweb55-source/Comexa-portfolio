
import "./globals.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import PublicChrome from "@/components/PublicChrome";
import RouteHistory from "@/components/RouteHistory";
import SafeAreaSync from "@/components/SafeAreaSync";
import { AuthProvider } from "@/lib/session";
import { GuideProvider } from "@/lib/guide/guide-context";
import { SpacesProvider } from "@/lib/spaces-context";


export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b2545",
  interactiveWidget: "resizes-content",
};

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
      style={{ colorScheme: "light" }}
    >
      <body
        suppressHydrationWarning
        className="flex min-h-full flex-col overflow-x-hidden bg-white text-gray-900"
      >
        <SafeAreaSync />
        <AuthProvider>
          <SpacesProvider>
            <GuideProvider>
              <RouteHistory />
              <PublicChrome>{children}</PublicChrome>
            </GuideProvider>
          </SpacesProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
