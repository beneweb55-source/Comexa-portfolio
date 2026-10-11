"use client";

import { use, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useListing } from "@/lib/use-listing";
import { Badge, Card, Empty, Notice, Pagination } from "@/components/workspace/ui";
import { PROJECT_STATUS } from "@/lib/labels";

const CLIENT_STATUS = { ACTIVE: "Actif", INACTIVE: "Inactif", ARCHIVED: "Archivé" };

export default function ClientEquipeDetailPage({ params }) {
  const { id } = use(params);
  const { user } = useAuth();
  const [contactPage, setContactPage] = useState(1);
  const [projectPage, setProjectPage] = useState(1);
  const client = useListing(`/clients/${encodeURIComponent(id)}`);
  const canReadContacts = can(user, "contact:read:any") || can(user, "client:read:own");
  const canReadProjects = can(user, "project:read:any") || can(user, "project:read:assigned") || can(user, "project:read:own");
  const contacts = useListing(canReadContacts ? `/clients/${encodeURIComponent(id)}/contacts?page=${contactPage}&perPage=100` : null);
  const projects = useListing(canReadProjects ? `/projects?clientId=${encodeURIComponent(id)}&page=${projectPage}&perPage=100` : null);

  if (client.items === null) {
    return (
      <div className="flex flex-col gap-5">
        <Link href="/espace-equipe/clients" className="text-sm font-medium text-[var(--comexa-accent-strong)] hover:underline">← Retour aux clients</Link>
        {client.error ? <Notice>{client.error}</Notice> : <p className="cx-small" role="status">Chargement de la fiche client…</p>}
      </div>
    );
  }

  const data = client.items;
  const address = [data.addressLine1, data.addressLine2, [data.postalCode, data.city].filter(Boolean).join(" "), data.region, data.country]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/espace-equipe/clients" className="text-sm font-medium text-[var(--comexa-accent-strong)] hover:underline">← Retour aux clients</Link>
          <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--comexa-ink-muted)]">{data.reference}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--comexa-ink)]">{data.companyName}</h2>
          <p className="mt-1 text-sm text-[var(--comexa-ink-soft)]">{[data.sector, data.city, data.country].filter(Boolean).join(" · ") || "Fiche client"}</p>
        </div>
        <Badge tone={data.status === "ACTIVE" ? "success" : "neutral"}>{CLIENT_STATUS[data.status] ?? data.status}</Badge>
      </div>

      {client.error ? <Notice>{client.error}</Notice> : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <Card title="Informations de l’entreprise">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Detail label="Raison sociale" value={data.legalName} />
            <Detail label="Secteur" value={data.sector} />
            <Detail label="Site web" value={data.website} />
            <Detail label="Effectif" value={data.employeeRange} />
            <Detail label="Adresse" value={address} />
            <Detail label="Immatriculation" value={data.registrationNumber} />
            <Detail label="N° TVA" value={data.vatNumber} />
            <Detail label="Créé le" value={formatDate(data.createdAt)} />
            <Detail label="Mis à jour le" value={formatDate(data.updatedAt)} />
          </dl>
        </Card>

        {data.notes ? (
          <Card title="Notes internes">
            <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--comexa-ink-soft)]">{data.notes}</p>
          </Card>
        ) : null}

        {canReadContacts ? (
          <Card title="Interlocuteurs">
            {contacts.error ? <Notice>{contacts.error}</Notice> : null}
            {contacts.items === null && !contacts.error ? <p className="cx-small" role="status">Chargement des interlocuteurs…</p> : null}
            {contacts.items !== null && contacts.items.length === 0 ? <Empty>Aucun interlocuteur enregistré.</Empty> : null}
            <ul className="flex flex-col gap-3">
              {(contacts.items ?? []).map((contact) => (
                <li key={contact.id} className="rounded-xl border border-[var(--comexa-border-soft)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-[var(--comexa-ink)]">{contact.firstName} {contact.lastName}</h3>
                    {contact.isPrimary ? <Badge tone="info">Contact principal</Badge> : null}
                  </div>
                  {contact.jobTitle ? <p className="mt-1 text-sm text-[var(--comexa-ink-soft)]">{contact.jobTitle}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--comexa-ink-muted)]">
                    {contact.email ? <a href={`mailto:${contact.email}`} className="hover:underline">{contact.email}</a> : null}
                    {contact.phone ? <a href={`tel:${contact.phone}`} className="hover:underline">{contact.phone}</a> : null}
                  </div>
                  {contact.notes ? <p className="mt-2 whitespace-pre-line text-sm text-[var(--comexa-ink-soft)]">{contact.notes}</p> : null}
                </li>
              ))}
            </ul>
            <Pagination meta={contacts.meta} onPageChange={setContactPage} loading={contacts.loading} />
          </Card>
        ) : null}

        {canReadProjects ? (
          <Card title="Projets associés">
            {projects.error ? <Notice>{projects.error}</Notice> : null}
            {projects.items === null && !projects.error ? <p className="cx-small" role="status">Chargement des projets…</p> : null}
            {projects.items !== null && projects.items.length === 0 ? <Empty>Aucun projet visible pour ce client.</Empty> : null}
            <ul className="flex flex-col gap-3">
              {(projects.items ?? []).map((project) => (
                <li key={project.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--comexa-border-soft)] p-4">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--comexa-ink-muted)]">{project.reference}</p>
                    <Link href={`/espace-equipe/projets/${project.id}`} className="font-semibold text-[var(--comexa-ink)] hover:text-[var(--comexa-accent-strong)] hover:underline">{project.name}</Link>
                    <p className="mt-1 text-[13px] text-[var(--comexa-ink-muted)]">Échéance : {formatDate(project.dueDate)}</p>
                  </div>
                  <Badge tone="info">{PROJECT_STATUS[project.status] ?? project.status}</Badge>
                </li>
              ))}
            </ul>
            <Pagination meta={projects.meta} onPageChange={setProjectPage} loading={projects.loading} />
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--comexa-ink-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-sm text-[var(--comexa-ink)]">{value || "—"}</dd>
    </div>
  );
}
