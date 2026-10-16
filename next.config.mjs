/** @type {import('next').NextConfig} */

// Le navigateur ne parle jamais directement au backend : toutes les requetes
// `/api/*` sont relayees par Next vers l'API Nest. Ainsi le cookie de session
// (chemin `/api/auth`) reste sur le meme site, sans CORS ni localhost cote client.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";

const nextConfig = {
  reactCompiler: true,
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
    ];
  },
};

export default nextConfig;
