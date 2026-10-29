import { NextResponse } from "next/server";
import { isSafeAgentWebhookUrl } from "../../../lib/admin-diagnostics.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Proxy vers le webhook n8n de l'Assistant IA Comexa.
 *
 * La route tourne côté serveur Next.js pour :
 *  1. garder `N8N_AGENT_WEBHOOK_URL` secret (jamais exposé au navigateur) ;
 *  2. transmettre au workflow n8n le JWT de session Comexa du membre connecté,
 *     afin que l'agent agisse avec SES droits (via l'API Comexa) et non avec un
 *     jeton `cxi_` générique.
 *
 * ATTENTION : ce mode « session JWT » est un contrat historique encore actif.
 * Il reste trop large : qui possede le JWT peut agir avec tous les droits du
 * membre jusqu'a son expiration. La correction definitive exige un jeton de
 * delegation court et limite cote backend + une migration du workflow n8n
 * externe. En attendant, on refuse au minimum tout transport non chiffre :
 * envoyer ce secret vers un webhook HTTP externe serait une fuite certaine.
 *
 * Un JWT de session commence par `eyJ` (en-tête JSON base64url) ; un jeton
 * d'intégration commence par `cxi_`. On refuse formellement ce dernier pour ne
 * jamais qu'un secret d'intégration fuite vers n8n via un appel mal formé.
 */

const N8N_TIMEOUT_MS = 60_000;
const SESSION_COOKIE = "access_token";

function extractBearer(request) {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }
  // Repli cookie (utile en SSR / navigation initiale)
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (match) return decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
  return null;
}

export async function POST(request) {
  const webhookUrl = process.env.N8N_AGENT_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      { success: false, error: { code: "AGENT_NOT_CONFIGURED", message: "Le webhook N8N_AGENT_WEBHOOK_URL n'est pas configuré sur cet environnement (variable Vercel manquante)." } },
      { status: 503 },
    );
  }

  if (!isSafeAgentWebhookUrl(webhookUrl)) {
    return NextResponse.json(
      { success: false, error: { code: "AGENT_WEBHOOK_INSECURE", message: "Le webhook de l'assistant doit utiliser HTTPS. Aucun jeton n'a été transmis." } },
      { status: 503 },
    );
  }

  const jwt = extractBearer(request);
  if (!jwt) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHENTICATED", message: "Session requise." } },
      { status: 401 },
    );
  }

  // Refus formel d'un jeton cxi_ : ce proxy ne sert que les sessions humaines.
  if (jwt.startsWith("cxi_")) {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Les jetons d'intégration cxi_ ne sont pas autorisés sur cette route." } },
      { status: 403 },
    );
  }

  // Un JWT de session Comexa est un JWS compact : il commence par eyJ. On ne
  // transmet pas une valeur arbitraire fournie dans un en-tete au webhook.
  if (!/^eyJ[A-Za-z0-9_-]+\./.test(jwt)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_SESSION_TOKEN", message: "Jeton de session invalide." } },
      { status: 401 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_JSON", message: "Corps JSON attendu." } },
      { status: 400 },
    );
  }

  const chatInput = typeof body?.chatInput === "string" ? body.chatInput : "";
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "default";

  if (!chatInput.trim()) {
    return NextResponse.json(
      { success: false, error: { code: "EMPTY_INPUT", message: "Le message est vide." } },
      { status: 400 },
    );
  }

  const payload = {
    chatInput,
    sessionId,
    metadata: { jwt },
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    const text = await resp.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { reply: text };
    }

    if (!resp.ok) {
      return NextResponse.json(
        { success: false, error: { code: `AGENT_HTTP_${resp.status}`, message: data?.message ?? "Le service Assistant IA a répondu par une erreur." } },
        { status: resp.status },
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err?.name === "AbortError") {
      return NextResponse.json(
        { success: false, error: { code: "AGENT_TIMEOUT", message: "L'assistant n'a pas répondu dans le délai imparti." } },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { success: false, error: { code: "AGENT_UNREACHABLE", message: "Le webhook de l'assistant est injoignable." } },
      { status: 502 },
    );
  }
}
