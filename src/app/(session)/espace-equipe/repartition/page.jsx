"use client";

import { useState } from "react";
import { Scale } from "lucide-react";
import { can } from "@/lib/access";
import { useAuth } from "@/lib/session";
import RulesView from "@/components/workspace/repartition/rules-view";
import CalcView from "@/components/workspace/repartition/calc-view";
import BalancesView from "@/components/workspace/repartition/balances-view";

/**
 * « RÉPARTITION & SOLDES » — la page du module financier de l'équipe.
 *
 * TROIS LECTURES, UN MÊME SUJET : qui reçoit quoi, sur quelle base, et ce
 * qui reste dû.
 *
 *  - « Règles » : le paramétrage — la règle par défaut et les exceptions de
 *    projet, versionnées ;
 *  - « Calculs » : le calcul — la base, les parts, la trace de l'arrondi, et
 *    l'application aux soldes ;
 *  - « Soldes » : le relevé — ce qui a été gagné, versé, avancé, et ce qui
 *    reste dû, par membre.
 *
 * L'ONGLET « RÈGLES » ET L'ONGLET « CALCULS » SONT RÉSERVÉS À L'ENCADREMENT
 * (droits `distribution:read:any`), et l'ONGLET « SOLDES » reste ouvert à
 * chaque membre pour SON relevé. Un membre sans droit de lecture voit donc
 * une page qui parle de SES chiffres — jamais des ceux des autres.
 */
const TABS = [
  { id: "regles", label: "Règles", needs: "distribution:read:any" },
  { id: "calculs", label: "Calculs", needs: "distribution:read:any" },
  { id: "soldes", label: "Soldes", needs: "balance:read:own" },
];

export default function RepartitionPage() {
  const { user } = useAuth();

  const allowed = TABS.filter((tab) => {
    if (tab.needs === "distribution:read:any") {
      return can(user, "distribution:read:any") || can(user, "distribution:manage:any");
    }
    if (tab.needs === "balance:read:own") {
      return can(user, "balance:read:own") || can(user, "balance:read:any");
    }
    return true;
  });

  const [tab, setTab] = useState(null);
  const active = tab && allowed.some((entry) => entry.id === tab) ? tab : allowed[0]?.id ?? "";

  if (allowed.length === 0) {
    return (
      <div className="sui-panel p-6">
        <p className="text-[15px] font-semibold text-[var(--ink)]">Répartition & soldes</p>
        <p className="mt-1 text-[13.5px] text-[var(--muted)]">
          Cette page est réservée aux membres de l’équipe.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Pas de titre ici : la coque affiche deja le titre de la rubrique et
          sa description. Un second bandeau afficherait deux fois la meme
          chose, et l'utilisateur ne saurait pas lequel lire. */}

      <div className="sui-seg" role="tablist" aria-label="Sections de la répartition et des soldes">
        {allowed.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`repartition-tab-${entry.id}`}
            aria-selected={active === entry.id}
            aria-controls={`repartition-panel-${entry.id}`}
            className="sui-seg__tab"
            onClick={() => setTab(entry.id)}
          >
            {active === entry.id ? <span className="sui-seg__pill" aria-hidden="true" /> : null}
            <span style={{ position: "relative" }}>{entry.label}</span>
          </button>
        ))}
      </div>

      <p className="sui-form__note">
        <Scale size={15} strokeWidth={2} aria-hidden="true" />
        Les règles sont versionnées : un changement crée une nouvelle version datée, et les répartitions déjà
        validées ne sont jamais recalculées en silence. Les calculs sont faits sur le serveur, au centime, et tracés.
      </p>

      <div role="tabpanel" id={`repartition-panel-${active}`} aria-labelledby={`repartition-tab-${active}`}>
        {active === "regles" ? <RulesView /> : null}
        {active === "calculs" ? <CalcView /> : null}
        {active === "soldes" ? <BalancesView /> : null}
      </div>
    </div>
  );
}
