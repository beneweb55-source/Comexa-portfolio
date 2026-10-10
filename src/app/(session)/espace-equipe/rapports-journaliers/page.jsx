"use client";

import { useRef, useState } from "react";
import { formatDate, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useAction, useListing } from "@/lib/use-listing";
import RichEditor from "@/components/workspace/RichEditor";
import { Card, Empty, Field, Notice, inputClass, primaryButton, secondaryButton } from "@/components/workspace/ui";

const isoDay = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const shiftDays = (day, delta) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return isoDay(d);
};

/**
 * Récapitulatif journalier : un rapport par jour, rédigé dans l'éditeur riche, enregistré
 * en JSON. Mon historique à gauche ; la vue d'équipe (lecture seule) si mon rôle la permet.
 */
export default function RapportsJournaliersPage() {
  const { user } = useAuth();
  const [day, setDay] = useState(() => isoDay(new Date()));
  const canSeeTeam = can(user, "time:read:any");

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-6">
        <MyReport key={day} day={day} onDayChange={setDay} />
        {canSeeTeam ? <TeamReports day={day} onPick={setDay} /> : null}
      </div>
      <History day={day} onPick={setDay} />
    </div>
  );
}

function MyReport({ day, onDayChange }) {
  const { request } = useAuth();
  const mine = useListing(`/daily-reports/mine?from=${day}&to=${day}`);
  const action = useAction(mine.reload);
  const editorRef = useRef(null);
  const [summary, setSummary] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(null);
  const existing = (mine.items ?? [])[0] ?? null;
  const summaryValue = summary ?? existing?.summary ?? "";
  const ready = mine.items !== null;

  async function save(event) {
    event.preventDefault();
    const editor = editorRef.current;
    if (!editor) return;
    setSaveError(null);
    setSaved(null);
    try {
      await request(`/daily-reports/${day}`, {
        method: "PUT",
        body: { contentJson: editor.getJSON(), summary: summaryValue.trim() || undefined },
      });
      setSaved("Rapport enregistré.");
      await mine.reload();
    } catch (caught) {
      setSaveError(messageOf(caught));
    }
  }

  return (
    <Card
      title={`Mon rapport du ${formatDate(`${day}T12:00:00`)}`}
      action={
        <div className="flex gap-2">
          <button type="button" className={secondaryButton} onClick={() => onDayChange(shiftDays(day, -1))}>Jour précédent</button>
          <button type="button" className={secondaryButton} onClick={() => onDayChange(isoDay(new Date()))}>Aujourd’hui</button>
        </div>
      }
    >
      {mine.error ? <Notice>{mine.error}</Notice> : null}
      {saveError ? <Notice>{saveError}</Notice> : null}
      {saved ? <Notice tone="success">{saved}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {!ready && !mine.error ? <p className="cx-small">Chargement du rapport…</p> : null}

      {ready ? (
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field id="report-summary" label="Résumé (affiché dans les listes)" hint={`${summaryValue.length}/280`}>
            <input id="report-summary" className={inputClass} maxLength={280} value={summaryValue} onChange={(e) => setSummary(e.target.value)} placeholder="Ex. Maquette accueil validée, bug panier corrigé" />
          </Field>
          <RichEditor key={`${day}-${existing?.id ?? "new"}`} initialContent={existing?.contentJson} onReady={(editor) => { editorRef.current = editor; }} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={primaryButton}>{existing ? "Mettre à jour" : "Enregistrer le rapport"}</button>
            {existing ? (
              <button type="button" className={secondaryButton} onClick={() => action.run("delete", `/daily-reports/${day}`, { method: "DELETE" }, "Rapport supprimé.")}>
                Supprimer ce rapport
              </button>
            ) : null}
            {existing ? <span className="cx-small">Dernière mise à jour : {formatDate(existing.updatedAt)}</span> : null}
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function History({ day, onPick }) {
  const from = shiftDays(day, -30);
  const history = useListing(`/daily-reports/mine?from=${from}&to=${day}`);
  const items = history.items ?? [];
  return (
    <Card title="Mes 30 derniers jours">
      {history.error ? <Notice>{history.error}</Notice> : null}
      {history.items !== null && items.length === 0 ? <Empty>Aucun rapport sur cette période.</Empty> : null}
      <ul className="flex flex-col gap-2">
        {items.map((report) => (
          <li key={report.id}>
            <button
              type="button"
              onClick={() => onPick(report.reportDate)}
              aria-current={report.reportDate === day ? "true" : undefined}
              className={`w-full rounded-xl border p-3 text-left ${report.reportDate === day ? "border-[var(--comexa-ink)] bg-[var(--comexa-neutral-100)]" : "border-[var(--comexa-border-soft)] hover:bg-[var(--comexa-neutral-100)]"}`}
            >
              <span className="block text-[13px] text-[var(--comexa-ink-muted)]">{formatDate(`${report.reportDate}T12:00:00`)}</span>
              <span className="block text-[14px] font-medium text-[var(--comexa-ink)]">{report.summary || "Sans résumé"}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TeamReports({ day, onPick }) {
  const from = shiftDays(day, -6);
  const team = useListing(`/daily-reports?from=${from}&to=${day}`);
  const items = team.items ?? [];
  return (
    <Card title="Rapports de l’équipe (7 derniers jours)">
      {team.error ? <Notice>{team.error}</Notice> : null}
      {team.items !== null && items.length === 0 ? <Empty>Aucun rapport publié sur cette semaine.</Empty> : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((report) => (
          <li key={report.id} className="rounded-xl border border-[var(--comexa-border-soft)] p-4">
            <p className="text-[13px] text-[var(--comexa-ink-muted)]">
              {report.user ? `${report.user.firstName} ${report.user.lastName}` : "Membre"} · {formatDate(`${report.reportDate}T12:00:00`)}
            </p>
            <p className="mt-1 text-[14.5px] font-medium text-[var(--comexa-ink)]">{report.summary || "Sans résumé"}</p>
            <button type="button" className="mt-2 text-[13px] underline" onClick={() => onPick(report.reportDate)}>Ouvrir ce jour</button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
