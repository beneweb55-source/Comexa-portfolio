"use client";

/*
 * Panneau droit « Admin Desk » (~25 % de la largeur, défilement indépendant).
 *
 * Titre, sous-titre de compteurs, contrôle segmenté (3 onglets, onglet actif en
 * blanc sur piste grise, pilule animée par `layoutId`), puis cartes teintées
 * (bleu / lilas / jaune) : icône, type, date, trois lignes de texte et une pilule
 * blanche d'action avec ses mini-icônes (voir, éditer, supprimer).
 *
 * Sous 1024 px, le même composant est rendu dans un tiroir (`mode="drawer"`).
 */

import Link from "next/link";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useState } from "react";
import Tooltip from "./Tooltip";
import { layoutSoft } from "./motion";
import { IconButton } from "./primitives";

export default function AdminDeskPanel({
  title = "Admin Desk",
  subtitle,
  tabs = [],
  items = [],
  mode = "inline",
  onClose,
  emptyLabel = "Rien à traiter pour l’instant.",
}) {
  const [tab, setTab] = useState(tabs[0]?.id ?? "all");
  const visible = tab === "all" ? items : items.filter((item) => item.tab === tab);

  return (
    <aside
      className={`sui-desk${mode === "drawer" ? " sui-desk--drawer" : " sui-desk--inline"}`}
      aria-label={title}
    >
      <div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h2 className="sui-desk__title">{title}</h2>
            {subtitle ? <p className="sui-desk__sub">{subtitle}</p> : null}
          </div>
          {onClose ? <IconButton icon={X} label="Fermer le panneau" onClick={onClose} tone="ghost" /> : null}
        </div>

        {tabs.length ? (
          <div className="sui-seg" role="tablist" aria-label={`${title} — vues`}>
            {tabs.map((entry) => {
              const selected = entry.id === tab;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  id={`sui-desk-tab-${entry.id}`}
                  aria-controls={`sui-desk-panel-${entry.id}`}
                  className="sui-seg__tab"
                  onClick={() => setTab(entry.id)}
                >
                  {selected ? <motion.span layoutId={`sui-desk-seg-${title}`} className="sui-seg__pill" transition={layoutSoft} aria-hidden="true" /> : null}
                  <span style={{ position: "relative" }}>{entry.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div
        className="sui-desk__scroll"
        role="tabpanel"
        id={`sui-desk-panel-${tab}`}
        aria-labelledby={tabs.length ? `sui-desk-tab-${tab}` : undefined}
      >
        {visible.length === 0 ? <p className="sui-desk__sub">{emptyLabel}</p> : null}
        <ul className="sui-deskcards">
          {visible.map((item) => (
            <li key={item.id} className="sui-deskcard" style={{ "--tone-bg": `var(--${item.tone ?? "blue"})` }}>
              <div className="sui-deskcard__head">
                <span className="sui-deskcard__icon" aria-hidden="true">
                  <item.icon size={17} strokeWidth={1.75} />
                </span>
                <span className="sui-deskcard__type">{item.type}</span>
                <span className="sui-deskcard__date">{item.date}</span>
              </div>

              <div className="sui-deskcard__lines">
                {(item.lines ?? []).slice(0, 3).map((line, index) => (
                  <p key={`${item.id}-${index}`}>{line}</p>
                ))}
              </div>

              <div className="sui-deskcard__foot">
                {item.cta ? (
                  item.cta.href ? (
                    <Link href={item.cta.href} className="sui-deskcard__cta">
                      {item.cta.icon ? <item.cta.icon size={14} strokeWidth={1.75} aria-hidden="true" /> : null}
                      {item.cta.label}
                    </Link>
                  ) : (
                    <button type="button" className="sui-deskcard__cta" onClick={item.cta.onClick}>
                      {item.cta.icon ? <item.cta.icon size={14} strokeWidth={1.75} aria-hidden="true" /> : null}
                      {item.cta.label}
                    </button>
                  )
                ) : null}

                {item.actions?.length ? (
                  <span className="sui-deskcard__mini">
                    {item.actions.slice(0, 3).map((action) => (
                      <Tooltip key={action.label} label={action.label} placement="left">
                        {action.href ? (
                          <Link href={action.href} className="sui-iconbtn sui-iconbtn--sm" aria-label={action.label} title={action.label}>
                            <action.icon size={15} strokeWidth={1.75} aria-hidden="true" />
                          </Link>
                        ) : (
                          <button
                            type="button"
                            className="sui-iconbtn sui-iconbtn--sm"
                            aria-label={action.label}
                            title={action.label}
                            onClick={action.onClick}
                          >
                            <action.icon size={15} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                        )}
                      </Tooltip>
                    ))}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

