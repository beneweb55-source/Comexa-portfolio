"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repositoryRoot = path.resolve(__dirname, "..");
const backendOrigin =
  process.env.BACKEND_URL ||
  process.env.COMEXA_BACKEND_ORIGIN ||
  "https://comexa-portfolio.onrender.com";
let parsedBackend;
try {
  parsedBackend = new URL(backendOrigin);
} catch {
  throw new Error("BACKEND_URL doit être une URL http(s) valide.");
}
if (!new Set(["http:", "https:"]).has(parsedBackend.protocol)) {
  throw new Error("BACKEND_URL doit utiliser http ou https.");
}

const npmCli = process.env.npm_execpath;
if (!npmCli)
  throw new Error("Lancez ce script via npm depuis le dossier desktop.");
const result = spawnSync(process.execPath, [npmCli, "run", "build"], {
  cwd: repositoryRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    COMEXA_DESKTOP_BUILD: "1",
    BACKEND_URL: parsedBackend.origin,
    NEXT_PUBLIC_SOCKET_URL:
      process.env.NEXT_PUBLIC_SOCKET_URL || parsedBackend.origin,
  },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const standalone = path.join(repositoryRoot, ".next", "standalone");
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  throw new Error("Next.js n'a pas produit le serveur standalone attendu.");
}
fs.mkdirSync(path.join(standalone, ".next", "static"), { recursive: true });
fs.cpSync(
  path.join(repositoryRoot, ".next", "static"),
  path.join(standalone, ".next", "static"),
  { recursive: true },
);
fs.cpSync(
  path.join(repositoryRoot, "public"),
  path.join(standalone, "public"),
  { recursive: true },
);
console.log(`Frontend desktop prêt. Relais API : ${parsedBackend.origin}`);
