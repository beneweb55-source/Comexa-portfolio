
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import RouteHistory from "@/components/RouteHistory";


export const metadata = {
  title: "comexa",
  description: "Plus Loin Ensemble",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className="h-full bg-white antialiased"
    >
      <body
        suppressHydrationWarning
        className="min-h-full flex flex-col bg-white text-gray-900 max-w-8xl"
      >
        <RouteHistory />
        <Navbar />
        {children}
        <Footer />
      </body>
    </html>
  );
}
