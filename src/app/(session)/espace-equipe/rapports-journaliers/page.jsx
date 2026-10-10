"use client";

import { Fragment, useRef, useState } from "react";
import { formatDate, messageOf } from "@/lib/api";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import { useAction, useListing } from "@/lib/use-listing";
import RichEditor from "@/components/workspace/RichEditor";
import { Card, Empty, Field, Notice, inputClass, primaryButton, secondaryButton } from "@/components/workspace/ui";
import GlassCard, { GlowIcon } from "@/components/dashboard/GlassCard";
import MeshBackground from "@/components/dashboard/MeshBackground";
import Icon from "@/components/dashboard/icons";

const isoDay = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const shiftDays = (day, delta) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return isoDay(d);
};
const hm = (minutes) => `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;

/**
 * Rapport journalier : un rapport par jour, rédigé dans l'éditeur riche (Tiptap) et
 * enregistré en JSON. « Auto-remplir » injecte les tâches terminées du jour et le temps
 * saisi. Les rapports passés se lisent sous forme de cartes en verre.
 */
export default function RapportsJournaliersPage() {
  const { user } = useAuth();
  const [day, setDay] = useState(() => isoDay(new Date()));
  // Incrémenté à chaque enregistrement ou suppression : recharge l'historique et la vue d'équipe.
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const canSeeTeam = can(user, "time:read:any");

  return (
    <div className="relative isolate overflow-hidden rounded-[36px] bg-[#071a33] p-5 text-white md:p-8">
      <MeshBackground />
      <header className="mb-7">
        <p className="text-[12.5px] font-medium uppercase tracking-[0.18em] text-sky-300/80">Journal</p>
        <h2 className="mt-2 bg-gradient-to-b from-white to-white/70 bg-clip-text text-[30px] font-semibold tracking-tight text-transparent">Rapports journaliers</h2>
      </header>

      <div className="flex flex-col gap-6">
        <MyReport key={day} day={day} onDayChange={setDay} onSaved={bump} />
        <History key={`history-${version}`} day={day} onPick={setDay} />
        {canSeeTeam ? <TeamReports key={`team-${version}`} day={day} onPick={setDay} /> : null}
      </div>
    </div>
  );
}

function MyReport({ day, onDayChange, onSaved }) {
  const { user, request } = useAuth();
  const mine = useListing(`/daily-reports/mine?from=${day}&to=${day}`);
  const action = useAction(mine.reload);
  const editorRef = useRef(null);
  const [summary, setSummary] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [filling, setFilling] = useState(false);
  const [fillError, setFillError] = useState(null);
  const [fillInfo, setFillInfo] = useState(null);
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
      onSaved?.();
    } catch (caught) {
      setSaveError(messageOf(caught));
    }
  }

  /**
   * Pré-remplissage : tâches passées en « Terminée » ce jour-là et temps saisi par moi.
   * Deux lectures seulement, faites côté client avec mes propres droits ; rien n'est
   * enregistré tant que l'utilisateur n'a pas relu et cliqué sur « Enregistrer ».
   */
  async function autoFill() {
    const editor = editorRef.current;
    if (!editor) return;
    setFilling(true);
    setFillError(null);
    setFillInfo(null);
    try {
      const [tasksRes, timeRes] = await Promise.all([
        request("/me/tasks?perPage=100"),
        request(`/time-entries?perPage=100&from=${day}&to=${day}&userId=${encodeURIComponent(user.id)}`),
      ]);
      const doneToday = (tasksRes.data ?? []).filter(
        (task) => task.status === "DONE" && task.completedAt && isoDay(new Date(task.completedAt)) === day,
      );
      const entries = (timeRes.data ?? []).filter((entry) => String(entry.spentOn).slice(0, 10) === day);
      const totalMinutes = entries.reduce((sum, entry) => sum + (Number(entry.minutes) || 0), 0);
      const byProject = new Map();
      for (const entry of entries) {
        const name = entry.project?.name ?? "Sans projet";
        byProject.set(name, (byProject.get(name) ?? 0) + (Number(entry.minutes) || 0));
      }

      const nodes = [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: `Réalisé le ${formatDate(`${day}T12:00:00`)}` }] },
        { type: "paragraph", content: [{ type: "text", text: doneToday.length ? "Tâches terminées :" : "Aucune tâche terminée ce jour." }] },
      ];
      if (doneToday.length) {
        nodes.push({
          type: "bulletList",
          content: doneToday.map((task) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: task.project?.name ? `${task.title} (${task.project.name})` : task.title }] }],
          })),
        });
      }
      nodes.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Temps saisi" }] });
      if (totalMinutes > 0) {
        nodes.push({ type: "paragraph", content: [{ type: "text", text: `Total : ${hm(totalMinutes)}`, marks: [{ type: "bold" }] }] });
        nodes.push({
          type: "bulletList",
          content: [...byProject.entries()].map(([name, minutes]) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: `${name} : ${hm(minutes)}` }] }],
          })),
        });
      } else {
        nodes.push({ type: "paragraph", content: [{ type: "text", text: "Aucune saisie de temps ce jour." }] });
      }

      if (editor.isEmpty) editor.commands.setContent({ type: "doc", content: nodes });
      else editor.chain().focus().insertContent(nodes).run();

      if (!summaryValue.trim()) {
        const hours = (totalMinutes / 60).toFixed(1).replace(".", ",");
        setSummary(`${doneToday.length} tâche(s) terminée(s) · ${hours} h`);
      }
      setFillInfo(`Journée pré-remplie (${doneToday.length} tâche(s), ${hm(totalMinutes)}). Relisez puis enregistrez.`);
    } catch (caught) {
      setFillError(messageOf(caught));
    } finally {
      setFilling(false);
    }
  }

  return (
    <Card
      title={`Mon rapport du ${formatDate(`${day}T12:00:00`)}`}
      action={
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButton} onClick={() => onDayChange(shiftDays(day, -1))}>Jour précédent</button>
          <button type="button" className={secondaryButton} onClick={() => onDayChange(isoDay(new Date()))}>Aujourd’hui</button>
        </div>
      }
    >
      {mine.error ? <Notice>{mine.error}</Notice> : null}
      {saveError ? <Notice>{saveError}</Notice> : null}
      {saved ? <Notice tone="success">{saved}</Notice> : null}
      {fillError ? <Notice>{fillError}</Notice> : null}
      {fillInfo ? <Notice tone="success">{fillInfo}</Notice> : null}
      {action.error ? <Notice>{action.error}</Notice> : null}
      {!ready && !mine.error ? <p className="cx-small">Chargement du rapport…</p> : null}

      {ready ? (
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field id="report-summary" label="Résumé (affiché dans les listes)" hint={`${summaryValue.length}/280`}>
            <input id="report-summary" className={inputClass} maxLength={280} value={summaryValue} onChange={(e) => setSummary(e.target.value)} placeholder="Ex. Maquette accueil validée, bug panier corrigé" />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="cx-small">Le pré-remplissage ajoute les tâches terminées et le temps saisi de ce jour.</p>
            <button type="button" onClick={autoFill} disabled={filling} className={secondaryButton}>
              {filling ? "Lecture de la journée…" : "Auto-remplir ma journée"}
            </button>
          </div>
          <RichEditor key={`${day}-${existing?.id ?? "new"}`} initialContent={existing?.contentJson} onReady={(editor) => { editorRef.current = editor; }} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={primaryButton}>{existing ? "Mettre à jour" : "Enregistrer le rapport"}</button>
            {existing ? (
              <button type="button" className={secondaryButton} onClick={async () => { await action.run("delete", `/daily-reports/${day}`, { method: "DELETE" }, "Rapport supprimé."); onSaved?.(); }}>
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

/** Historique personnel : cartes en verre, contenu rendu (lecture seule). */
function History({ day, onPick }) {
  const from = shiftDays(day, -30);
  const history = useListing(`/daily-reports/mine?from=${from}&to=${day}`);
  const items = history.items ?? [];
  return (
    <section aria-label="Mes 30 derniers jours">
      <SectionTitle icon="calendar" tone="accent" title="Mes 30 derniers jours" />
      {history.error ? <Notice>{history.error}</Notice> : null}
      {history.items !== null && items.length === 0 ? <Empty>Aucun rapport sur cette période.</Empty> : null}
      <div className="grid gap-5 md:grid-cols-2">
        {items.map((report) => (
          <ReportCard key={report.id} report={report} active={report.reportDate === day} onOpen={() => onPick(report.reportDate)} />
        ))}
      </div>
    </section>
  );
}

function TeamReports({ day, onPick }) {
  const from = shiftDays(day, -6);
  const team = useListing(`/daily-reports?from=${from}&to=${day}`);
  const items = team.items ?? [];
  return (
    <section aria-label="Rapports de l’équipe">
      <SectionTitle icon="users" tone="mint" title="Rapports de l’équipe (7 derniers jours)" />
      {team.error ? <Notice>{team.error}</Notice> : null}
      {team.items !== null && items.length === 0 ? <Empty>Aucun rapport publié sur cette semaine.</Empty> : null}
      <div className="grid gap-5 md:grid-cols-2">
        {items.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            author={report.user ? `${report.user.firstName} ${report.user.lastName}` : "Membre"}
            onOpen={() => onPick(report.reportDate)}
          />
        ))}
      </div>
    </section>
  );
}

function SectionTitle({ icon, tone, title }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <GlowIcon tone={tone}><Icon name={icon} /></GlowIcon>
      <h3 className="text-[16px] font-semibold text-white">{title}</h3>
    </div>
  );
}

function ReportCard({ report, author, active, onOpen }) {
  return (
    <GlassCard className={`flex flex-col gap-4 p-6 ${active ? "ring-1 ring-sky-300/50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] uppercase tracking-[0.14em] text-sky-300/80">{formatDate(`${report.reportDate}T12:00:00`)}</p>
          {author ? <p className="mt-1 text-[13px] text-white/55">{author}</p> : null}
        </div>
        <button type="button" onClick={onOpen} className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-[12px] text-white/75 hover:bg-white/10 hover:text-white">
          {active ? "Ouvert" : "Ouvrir"}
        </button>
      </div>
      <h4 className="text-[16px] font-semibold leading-snug text-white">{report.summary || "Sans résumé"}</h4>
      <div className="relative max-h-64 overflow-hidden text-[14px] leading-relaxed text-white/75">
        <RichDoc doc={report.contentJson} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#0b2545]/90 to-transparent" aria-hidden="true" />
      </div>
    </GlassCard>
  );
}

/* ---------- Rendu lecture seule du JSON Tiptap, sans HTML brut ---------- */

const SAFE_PROTOCOLS = /^(https?:|mailto:)/i;

function RichDoc({ doc }) {
  const content = doc && Array.isArray(doc.content) ? doc.content : [];
  if (!content.length) return <p className="text-white/45">Rapport vide.</p>;
  return <>{content.map((node, index) => <Block key={index} node={node} />)}</>;
}

function Block({ node }) {
  const children = (node.content ?? []).map((child, index) => <Block key={index} node={child} />);
  switch (node.type) {
    case "paragraph":
      return <p className="mb-2 last:mb-0">{renderInline(node.content)}</p>;
    case "heading": {
      const level = node.attrs?.level === 2 ? "text-[15px] font-semibold text-white mt-3 mb-1" : "text-[14px] font-semibold text-sky-200 mt-3 mb-1";
      return <p className={level}>{renderInline(node.content)}</p>;
    }
    case "bulletList":
      return <ul className="mb-2 list-disc space-y-1 pl-5 marker:text-sky-300/70">{children}</ul>;
    case "orderedList":
      return <ol className="mb-2 list-decimal space-y-1 pl-5 marker:text-sky-300/70">{children}</ol>;
    case "listItem":
      return <li>{children}</li>;
    case "blockquote":
      return <blockquote className="mb-2 border-l-2 border-sky-300/50 pl-3 italic text-white/65">{children}</blockquote>;
    case "codeBlock":
      return <pre className="mb-2 overflow-x-auto rounded-xl bg-black/30 p-3 text-[12.5px] text-white/85"><code>{renderInline(node.content)}</code></pre>;
    case "horizontalRule":
      return <hr className="my-3 border-white/10" />;
    default:
      return children.length ? <>{children}</> : null;
  }
}

function renderInline(nodes = []) {
  return nodes.map((node, index) => {
    if (node.type === "hardBreak") return <br key={index} />;
    if (node.type !== "text") return null;
    let out = node.text ?? "";
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") out = <strong key={`b${index}`} className="font-semibold text-white">{out}</strong>;
      else if (mark.type === "italic") out = <em key={`i${index}`}>{out}</em>;
      else if (mark.type === "underline") out = <span key={`u${index}`} className="underline underline-offset-2">{out}</span>;
      else if (mark.type === "strike") out = <s key={`s${index}`}>{out}</s>;
      else if (mark.type === "code") out = <code key={`c${index}`} className="rounded bg-white/10 px-1 text-[12.5px]">{out}</code>;
      else if (mark.type === "link") {
        const href = String(mark.attrs?.href ?? "");
        // Seuls les liens web et courriel sont rendus cliquables ; le reste reste du texte.
        out = SAFE_PROTOCOLS.test(href)
          ? <a key={`l${index}`} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-sky-300 underline underline-offset-2 hover:text-sky-200">{out}</a>
          : <Fragment key={`l${index}`}>{out}</Fragment>;
      }
    }
    return <Fragment key={index}>{out}</Fragment>;
  });
}
