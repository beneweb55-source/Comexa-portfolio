"use client";

/*
 * VUE D'ENSEMBLE — tableau de bord de Comexa Space (l'organisation).
 *
 * Seulement des données d'administration, lues dans Comexa Space : membres et
 * invitations, contenus du site public, jetons d'intégration, journal d'audit.
 * Aucun chiffre commercial ni de production (ils vivent dans l'espace équipe),
 * et chaque bloc n'apparaît que si le droit correspondant est détenu.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CircleAlert,
  Globe,
  History,
  KeyRound,
  Settings2,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { can, canAny } from "@/lib/access";
import { auditActionLabel } from "@/lib/audit-labels";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { Alert, Button, KpiGrid, Panel, toneBackground } from "@/components/softui";
import { relativeFr } from "@/components/softui/time";
import { Empty } from "@/components/workspace/ui";

const CONTENT_TYPES = [
  { key: "services", label: "Services", path: "/content/services", permission: "service:read:any", flag: "isActive" },
  { key: "packages", label: "Packs", path: "/content/packages", permission: "package:read:any", flag: "isActive" },
  { key: "testimonials", label: "Témoignages", path: "/content/testimonials", permission: "testimonial:read:any", flag: "isPublished" },
  { key: "partners", label: "Partenaires", path: "/content/partners", permission: "partner:read:any", flag: "isActive" },
  { key: "faqs", label: "Questions fréquentes", path: "/content/faqs", permission: "faq:read:any", flag: "isPublished" },
];


function plural(count, one, many) {
  return `${count} ${count > 1 ? many : one}`;
}

export default function ComexaOverview() {
  const { user } = useAuth();
  const [now] = useState(() => Date.now());
  const weekAgo = new Date(now - 7 * 24 * 3600 * 1000).toISOString();

  const canUsers = can(user, "user:read:any");
  const canAudit = can(user, "audit:read:any");
  const canTokens = canAny(user, ["integration:read:any", "integration:manage:any"]);
  const canSettings = can(user, "setting:read:any");
  const canRoles = can(user, "role:read:any");

  const activeMembers = useListing(canUsers ? "/users?status=ACTIVE&page=1&perPage=1" : null);
  const invited = useListing(canUsers ? "/users?status=INVITED&page=1&perPage=1" : null);
  const tokens = useListing(canTokens ? "/integrations/tokens?page=1&perPage=100" : null);
  const audit = useListing(canAudit ? "/audit-logs?page=1&perPage=6" : null);
  const auditWeek = useListing(canAudit ? `/audit-logs?page=1&perPage=1&from=${encodeURIComponent(weekAgo)}` : null);

  const content = CONTENT_TYPES.filter((type) => can(user, type.permission));
  const services = useListing(content.some((type) => type.key === "services") ? "/content/services?page=1&perPage=100" : null);
  const packages = useListing(content.some((type) => type.key === "packages") ? "/content/packages?page=1&perPage=100" : null);
  const testimonials = useListing(content.some((type) => type.key === "testimonials") ? "/content/testimonials?page=1&perPage=100" : null);
  const partners = useListing(content.some((type) => type.key === "partners") ? "/content/partners?page=1&perPage=100" : null);
  const faqs = useListing(content.some((type) => type.key === "faqs") ? "/content/faqs?page=1&perPage=100" : null);
  const lists = { services, packages, testimonials, partners, faqs };

  const tokenStats = useMemo(() => {
    const items = tokens.items ?? [];
    const soon = now + 30 * 24 * 3600 * 1000;
    const active = items.filter((token) => token.active);
    const expiring = active.filter((token) => token.expiresAt && new Date(token.expiresAt).getTime() < soon);
    return { active: active.length, expiring: expiring.length };
  }, [now, tokens.items]);

  const pendingTestimonials = (testimonials.items ?? []).filter((item) => !item.isPublished).length;
  const total = (listing) => (Number.isFinite(Number(listing.meta?.total)) ? Number(listing.meta.total) : null);

  const kpis = [
    canUsers
      ? {
          id: "members",
          tone: "blue",
          badge: total(invited) ? `${plural(total(invited), "invitation", "invitations")} en attente` : "Aucune invitation en attente",
          value: total(activeMembers) ?? "…",
          label: "Comptes actifs",
          href: "/espace-comexa/membres",
        }
      : null,
    content.length
      ? {
          id: "content",
          tone: "pink",
          badge: pendingTestimonials ? `${plural(pendingTestimonials, "témoignage", "témoignages")} à modérer` : "Modération à jour",
          value: content.reduce((sum, type) => sum + (lists[type.key].items ?? []).filter((item) => item[type.flag]).length, 0),
          label: "Contenus visibles sur le site",
          href: "/espace-comexa/contenu",
        }
      : null,
    canTokens
      ? {
          id: "tokens",
          tone: "green",
          badge: tokenStats.expiring ? `${plural(tokenStats.expiring, "jeton expire", "jetons expirent")} sous 30 jours` : "Aucune expiration proche",
          value: tokens.items === null ? "…" : tokenStats.active,
          label: tokenStats.active > 1 ? "Jetons d’intégration actifs" : "Jeton d’intégration actif",
          href: "/espace-comexa/integrations",
        }
      : null,
    canAudit
      ? {
          id: "audit",
          tone: "lilac",
          badge: "7 derniers jours",
          value: total(auditWeek) ?? "…",
          label: "Actions enregistrées au journal",
          href: "/espace-comexa/journal",
        }
      : null,
  ].filter(Boolean);

  const errors = [...new Set([activeMembers.error, tokens.error, audit.error, ...content.map((type) => lists[type.key].error)].filter(Boolean))];

  const shortcuts = [
    canUsers ? { href: "/espace-comexa/membres", label: "Membres et droits", icon: UserPlus, tone: "blue" } : null,
    canRoles ? { href: "/espace-comexa/roles", label: "Rôles et permissions", icon: ShieldCheck, tone: "lilac" } : null,
    content.length ? { href: "/espace-comexa/contenu", label: "Contenu du site", icon: Globe, tone: "pink" } : null,
    canTokens ? { href: "/espace-comexa/integrations", label: "API & Intégrations", icon: KeyRound, tone: "green" } : null,
    canAudit ? { href: "/espace-comexa/journal", label: "Journal d’audit", icon: History, tone: "yellow" } : null,
    canSettings ? { href: "/espace-comexa/parametres", label: "Paramètres", icon: Settings2, tone: "blue" } : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      {errors.length ? (
        <div className="flex flex-col gap-2">
          {errors.map((error) => (
            <Alert key={error} icon={CircleAlert}>{error}</Alert>
          ))}
        </div>
      ) : null}

      {kpis.length ? (
        <KpiGrid
          label="L’organisation en chiffres"
          items={kpis.map((kpi) => ({
            ...kpi,
            value: (
              <Link href={kpi.href} className="sui-kpi__link">
                {String(kpi.value)}
              </Link>
            ),
          }))}
        />
      ) : null}

      <div className="sui-split">
        {content.length ? (
          <Panel title="Site public" action={<Button href="/espace-comexa/contenu" icon={Globe}>Gérer le contenu</Button>}>
            <ul className="sui-bars">
              {content.map((type) => {
                const items = lists[type.key].items ?? [];
                const visible = items.filter((item) => item[type.flag]).length;
                const ratio = items.length ? Math.round((visible / items.length) * 100) : 0;
                return (
                  <li key={type.key}>
                    <span className="sui-bars__label">{type.label}</span>
                    <span className="sui-bars__track" aria-hidden="true">
                      <span className="sui-bars__fill" style={{ width: `${ratio}%`, "--tone-bg": toneBackground("pink") }} />
                    </span>
                    <span className="sui-bars__value">
                      {lists[type.key].items === null ? "…" : `${visible} / ${items.length}`}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="sui-card__desc">Éléments visibles sur le site public, sur le total enregistré.</p>
          </Panel>
        ) : null}

        {canAudit ? (
          <Panel title="Dernières actions" action={<Button href="/espace-comexa/journal" icon={History}>Journal complet</Button>}>
            {audit.items === null && !audit.error ? <p className="sui-card__desc">Chargement du journal…</p> : null}
            {audit.items !== null && audit.items.length === 0 ? <Empty icon={History}>Aucune action enregistrée.</Empty> : null}
            {audit.items?.length ? (
              <ul className="sui-lines">
                {audit.items.map((entry) => (
                  <li key={entry.id}>
                    <Link href="/espace-comexa/journal">
                      <span className="sui-lines__icon" style={{ "--tone-bg": toneBackground("lilac") }} aria-hidden="true">
                        <History size={16} strokeWidth={1.75} />
                      </span>
                      <span className="sui-lines__copy">
                        <strong>{auditActionLabel(entry.action)}</strong>
                        <span>{entry.actorEmail ?? "Système"} · {entry.entityType}</span>
                      </span>
                      <span className="sui-lines__end">{relativeFr(entry.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
        ) : null}
      </div>

      {shortcuts.length ? (
        <Panel title="Administration" action={<span className="sui-section__count">{shortcuts.length}</span>}>
          <ul className="sui-shortcuts">
            {shortcuts.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="sui-shortcut">
                  <span className="sui-shortcut__icon" style={{ "--tone-bg": toneBackground(item.tone) }} aria-hidden="true">
                    <item.icon size={18} strokeWidth={1.75} />
                  </span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <Empty icon={Users}>Aucune rubrique d’administration n’est ouverte à votre rôle.</Empty>
      )}
    </div>
  );
}
