"use client";

import { Suspense, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, LogIn, WifiOff } from "lucide-react";
import { AuthCard } from "@/components/auth/AuthCard";
import { ApiError, messageOf } from "@/lib/api";
import { homeFor } from "@/lib/access";
import { useAuth } from "@/lib/session";

function safeNext(candidate, fallback) {
  if (!candidate || typeof candidate !== "string") return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  return candidate;
}

function subscribeToDesktopOffline() {
  return () => {};
}

function getDesktopOfflineSnapshot() {
  return typeof window !== "undefined" && Boolean(window.comexaDesktop?.offline);
}

function getServerDesktopOfflineSnapshot() {
  return false;
}

function Form() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, loginOffline, resendVerification } = useAuth();
  const desktopOfflineAvailable = useSyncExternalStore(
    subscribeToDesktopOffline,
    getDesktopOfflineSnapshot,
    getServerDesktopOfflineSnapshot,
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resent, setResent] = useState(false);

  async function submitLogin(offlineOnly = false) {
    setBusy(true);
    setError(null);
    setNeedsVerification(false);
    setResent(false);

    try {
      const authenticate = offlineOnly ? loginOffline : login;
      const user = await authenticate(email.trim(), password);
      const destination = safeNext(searchParams.get("next"), homeFor(user));
      router.replace(destination);
    } catch (caught) {
      setError(messageOf(caught));
      if (caught instanceof ApiError && caught.code === "AUTH_EMAIL_NOT_VERIFIED") {
        setNeedsVerification(true);
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    return submitLogin();
  }

  async function onResend() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await resendVerification(email.trim());
      setResent(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Connexion"
      subtitle="Accédez à votre espace client ou à l’espace de votre équipe."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Nouveau client ?</span>
          <Link href="/inscription" className="font-semibold text-[var(--comexa-accent-strong)] hover:underline">
            Créer un compte client →
          </Link>
        </div>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error ? (
          <div role="alert" className="cx-alert cx-alert--error flex-col items-start">
            <span>{error}</span>
            {needsVerification ? (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={onResend}
                  disabled={busy}
                  className="font-semibold underline"
                >
                  Renvoyer le lien de confirmation
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {resent ? (
          <p role="status" className="cx-alert cx-alert--success">
            Si un compte correspond à cette adresse, un nouveau lien vient d’être envoyé.
          </p>
        ) : null}

        <div className="cx-field">
          <label htmlFor="login-email" className="cx-label">
            Adresse e-mail
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            placeholder="vous@entreprise.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="cx-input"
          />
        </div>

        <div className="cx-field">
          <div className="flex items-center justify-between">
            <label htmlFor="login-password" className="cx-label">
              Mot de passe
            </label>
            <Link
              href="/mot-de-passe-oublie"
              className="text-[12.5px] font-medium text-[var(--comexa-accent-strong)] hover:underline"
            >
              Mot de passe oublié ?
            </Link>
          </div>
          <div className="relative flex items-center">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="cx-input !pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2.5 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--comexa-ink-muted)] hover:bg-[var(--comexa-neutral-100)] hover:text-[var(--comexa-ink)]"
              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={busy || !email.trim() || !password}
          className="cx-btn cx-btn--primary mt-1 w-full"
        >
          <LogIn size={16} aria-hidden="true" />
          <span>{busy ? "Connexion…" : "Se connecter"}</span>
        </button>

        {desktopOfflineAvailable ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => submitLogin(true)}
              disabled={busy || !email.trim() || !password}
              className="cx-btn cx-btn--secondary w-full"
            >
              <WifiOff size={16} aria-hidden="true" />
              <span>{busy ? "Connexion…" : "Se connecter sans Internet"}</span>
            </button>
            <p className="text-center text-xs leading-relaxed text-[var(--comexa-ink-muted)]">
              Disponible après une première connexion en ligne sur cet appareil. Utilisez le même e-mail et mot de passe.
            </p>
          </div>
        ) : null}
      </form>
    </AuthCard>
  );
}

export default function ConnexionPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-sm text-[var(--comexa-ink-muted)]">Chargement…</div>}>
      <Form />
    </Suspense>
  );
}
