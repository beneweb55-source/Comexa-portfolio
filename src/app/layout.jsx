
import "./globals.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import PublicChrome from "@/components/PublicChrome";
import RouteHistory from "@/components/RouteHistory";


export const metadata = {
  title: "comexa",
  description: "Plus Loin Ensemble",
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
        <RouteHistory />
        <PublicChrome>{children}</PublicChrome>
      </body>
    </html>
  );
}
