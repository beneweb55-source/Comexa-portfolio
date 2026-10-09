/** @type {import('next').NextConfig} */

// Le navigateur ne parle jamais directement au backend : toutes les requetes
// `/api/*` sont relayees par Next vers l'API Nest. Ainsi le cookie de session
// (chemin `/api/auth`) reste sur le meme site, sans CORS ni localhost cote client.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";

const nextConfig = {
  reactCompiler: true,
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
