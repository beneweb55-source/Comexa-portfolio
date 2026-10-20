/** @type {import('next').NextConfig} */

// Le navigateur ne parle jamais directement au backend : toutes les requetes
// `/api/*` sont relayees par Next vers l'API Nest. Ainsi le cookie de session
// (chemin `/api/auth`) reste sur le meme site, sans CORS ni localhost cote client.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";

const nextConfig = {
  reactCompiler: true,
  devIndicators: false,
  // Preview Arena : le navigateur charge l'app depuis https://3000-<id>.e2b.app.
  // Sans cette autorisation, Next bloque /_next/hmr et le JavaScript ne s'hydrate
  // pas : le bouton du menu ne répond plus. Ne concerne que le mode développement.
  // `127.0.0.1` : en développement, on passe indifféremment par localhost ou 127.0.0.1 ;
  // Next bloque sinon le JavaScript (HMR) pour cette origine. Sans effet en production.
  allowedDevOrigins: ["**.e2b.app", "127.0.0.1", "localhost"],
  // Les rubriques d'administration de l'organisation vivent dans Comexa Space.
  // Les anciens liens (favoris, notifications déjà envoyées, documentation)
  // continuent de fonctionner : redirection temporaire vers la nouvelle adresse.
  async redirects() {
    const moved = ["contenu", "membres", "roles", "integrations", "journal", "parametres"];
    return moved.flatMap((section) => [
      { source: `/espace-equipe/${section}`, destination: `/espace-comexa/${section}`, permanent: false },
      { source: `/espace-equipe/${section}/:path*`, destination: `/espace-comexa/${section}/:path*`, permanent: false },
    ]);
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
      // SOCKET.IO — la poignee de main temps reel passe par le meme proxy que
      // l'API. Le navigateur se connecte a la racine du site (donc meme
      // origine, donc aucune question de CORS), et Next relaie `/socket.io`
      // vers le backend. Sans cette regle, la connexion socket echoue et la
      // messagerie ne rafraichit plus en temps reel.
      //
      // DEUX REGLES, ET LA PREMIERE EST INDISPENSABLE. La poignee de main
      // engine.io demande `/socket.io/` (BARRE FINALE). Next normalise ce
      // chemin en `/socket.io` — avec une redirection 308 — AVANT d'appliquer
      // les rewrites. Or `/socket.io/:path*` ne reconnait QUE la forme avec
      // un segment apres `/socket.io` : la forme nue renvoyait 404, et toute
      // la chaine temps reel s'effondrait sur un 404.
      //
      // La regle nue se termine par une BARRE FINALE, elle aussi : le serveur
      // socket.io du backend ne sert que `/socket.io/`, et `/socket.io` y
      // repond 404. Le slash de destination n'est donc pas un detail — c'est
      // lui qui fait que la poignee de main aboutit.
      {
        source: "/socket.io",
        destination: `${BACKEND_URL}/socket.io/`,
      },
      {
        source: "/socket.io/:path*",
        destination: `${BACKEND_URL}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
