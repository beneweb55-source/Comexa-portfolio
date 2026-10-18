"use client";

import Link from "next/link";
import { ArrowUpRight, Scale } from "lucide-react";
import { Card, Notice } from "@/components/workspace/ui";

/**
 * RÉPARTITIONS — LE RENVOI VERS L'ESPACE ÉQUIPE.
 *
 * CE PANNEAU ÉTAIT, JUSQU'ICI, LE SEUL ÉDITEUR DE RÈGLES DE RÉPARTITION. Il
 * a été déplacé dans l'espace équipe, et cet écran le dit.
 *
 * POURQUOI, ET POURQUOI MAINTENANT :
 *
 *  - une règle de répartition N'EST PAS un paramètre d'organisation : c'est
 *    une règle d'équipe, avec des exceptions par projet, des versions datées
 *    et des soldes derrière. Elle vit avec les gens qu'elle concerne ;
 *
 *  - l'espace Comexa restreint volontairement les droits : on y administer
 *    l'organisation, pas les balances des membres. Un éditeur de règles
 *    Would y afficher un écran vide, faute de permission ;
 *
 *  - deux éditeurs de règles finissent par diverger. Il n'y en a qu'un.
 *
 * L'ANCIEN ÉCRAN, lui, n'a pas disparu : il lit les mêmes règles, mais il ne
 * les modifie plus. Le renvoi est un bouton, pas une redirection automatique :
 * l'utilisateur choisit.
 */
export default function DistributionPanel() {
  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Répartition des gains"
        subtitle="Les règles, les exceptions de projet, les calculs et les soldes des membres."
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span
              className="sui-empty__icon"
              style={{ background: "var(--blue)" }}
              aria-hidden="true"
            >
              <Scale size={18} strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold text-[var(--ink)]">
                Le module financier se règle dans l’espace équipe
              </p>
              <p className="mt-1 text-[13px] text-[var(--muted)]">
                Répartition des gains et soldes des membres : règles versionnées, exceptions par projet, calcul
                au centime et relevé des soldes. C’est là que tout se passe désormais.
              </p>
            </div>
          </div>

          <div>
            <Link
              href="/espace-equipe/repartition"
              className="sui-btn sui-btn--dark"
              style={{ textDecoration: "none" }}
            >
              Ouvrir « Répartition & soldes »
              <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" />
            </Link>
          </div>

          <Notice tone="info">
            Cette rubrique de l’espace Comexa ne montre plus les règles : l’espace Comexa n’ouvre pas les soldes
            des membres, et une règle affichée à côté d’un écran vide tromperait tout le monde.
          </Notice>
        </div>
      </Card>
    </div>
  );
}
