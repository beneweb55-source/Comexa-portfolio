"use client";

/*
 * Hub des espaces de travail — `/espaces`.
 *
 * L'ÉCRAN D'ENTRÉE DE L'APPLICATION DESKTOP. La fenêtre Electron s'ouvre ici :
 * l'utilisateur choisit son espace au lieu d'être jeté dans un seul. Sur le site,
 * le même écran est rejoint depuis le sélecteur d'espace (« Tous les espaces »).
 *
 * RIEN N'EST INVENTÉ ICI. La liste des espaces vient de `GET /me/spaces` via
 * `useSpaces()`, donc de l'API qui applique la politique serveur — avec le miroir
 * local de `lib/spaces.js` en repli tant que la réponse n'est pas arrivée.
 * Libellés, descriptions, teintes et icônes viennent de `SPACES` et de
 * `SPACE_ICON` ; les rubriques inscrites sur chaque carte sont exactement celles
 * que `visibleNavigation()` autorise avec les droits EFFECTIFS de l'espace. Pas
 * de nouvelle route métier, pas d'API ajoutée, pas de donnée simulée : cet écran
 * ne fait que présenter ce que le compte a déjà le droit d'ouvrir.
 *
 * VISITEUR NON CONNECTÉ : renvoyé vers `/connexion?next=/espaces`. C'est le
 * parcours de connexion existant, qui sait déjà revenir sur la page demandée
 * (`safeNext`), donc aucune authentification n'est réécrite ici.
 *
 * COMPTE CLIENT : `canEnterSpace` exige un rôle non-CLIENT, donc aucun des trois
 * espaces d'équipe ne lui est ouvert. Plutôt que trois cartes qui le
 * rejetteraient, il retrouve celle de son espace client — la destination que
 * `homeFor()` lui donne déjà partout ailleurs.
 */

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { ArrowUpRight, Compass, LogOut, ShoppingCart } from "lucide-react";
import logo from "../../../../public/comexa-logo-horizontal-transparent.png";
import { hasTeamAccess } from "@/lib/access";
import { SPACE_IDS, SPACES } from "@/lib/spaces";
import { visibleNavigation } from "@/lib/space-navigation";
import { useAuth } from "@/lib/session";
import { useSpaces } from "@/lib/spaces-context";
import { SPACE_ICON, roleLabelOf } from "@/components/softui/SpaceSwitcher";
import { motion, SoftMotionProvider, cardHover, staggerItem, staggerParent } from "@/components/softui/motion";
import { initialsOf, nameOf } from "@/components/workspace/UserMenu";
import { Empty, SkeletonList } from "@/components/workspace/ui";

/** Chemin de ce hub : sert au retour après connexion. */
const HUB_PATH = "/espaces";

/** Rubriques inscrites sur une carte avant le « +N ». */
const CHIPS_SHOWN = 4;

/* Un client n'a pas d'espace dans `SPACES` (qui ne couvre que les trois espaces
   d'équipe) : sa carte reprend ce que son espace affiche réellement. */
const CLIENT_ENTRY = {
  id: "client",
  label: "Espace client",
  description: "Vos devis, vos factures, l’avancement de vos projets et vos échanges avec l’équipe.",
  tone: "blue",
  href: "/espace-client",
  icon: ShoppingCart,
  unread: 0,
  sections: [],
};

export default function EspacesHubPage() {
  const router = useRouter();
  const { status, user, baseUser, logout } = useAuth();
  const { ready, spaces, permissionsFor, unreadBySpace } = useSpaces();

  /* Hors d'un espace, `user` n'est pas réduit : les deux se valent ici, mais
     `baseUser` reste la valeur sûre si ce hub est un jour rendu dans un espace. */
  const account = baseUser ?? user;
  const team = Boolean(account) && hasTeamAccess(account);

  useEffect(() => {
    if (status === "anonymous") router.replace(`/connexion?next=${encodeURIComponent(HUB_PATH)}`);
  }, [status, router]);

  /* Cartes : les espaces que l'API ouvre à ce compte, dans l'ordre du sélecteur.
     Un compte client retombe sur son espace. */
  const entries = useMemo(() => {
    if (!account) return [];
    if (!team) return [CLIENT_ENTRY];

    return spaces
      .filter((space) => SPACE_IDS.includes(space.id))
      .map((space) => {
        const meta = SPACES[space.id];
        const groups = visibleNavigation(space.id, permissionsFor(space.id));
        return {
          id: space.id,
          label: meta.label,
          description: meta.description,
          tone: meta.tone,
          href: meta.home,
          icon: SPACE_ICON[space.id] ?? Compass,
          unread: Number(unreadBySpace?.[space.id] ?? 0),
          sections: groups.flatMap((group) => group.items.map((item) => item.label)),
        };
      });
  }, [account, team, spaces, permissionsFor, unreadBySpace]);

  /* `ready` vient de `GET /me/spaces` : avant cela, la liste ne reflète pas les
     droits réels et afficher des cartes serait mentir sur ce qui est ouvert. */
  const waiting = status === "loading" || (status === "authenticated" && team && !ready);

  async function signOut() {
    await logout();
    router.replace("/connexion");
    router.refresh();
  }

  if (status === "anonymous") return null;

  return (
    <SoftMotionProvider>
      <main className="sui-hub">
        <div className="sui-hub__halo" aria-hidden="true" />

        <header className="sui-hub__head">
          <Image src={logo} alt="Comexa" width={168} height={39} priority className="sui-hub__logo" />

          {account ? (
            <div className="sui-hub__who">
              <span className="sui-hub__avatar" aria-hidden="true">{initialsOf(account)}</span>
              <span className="sui-hub__identity">
                <span className="sui-hub__name">{nameOf(account)}</span>
                {roleLabelOf(account) ? <span className="sui-hub__role">{roleLabelOf(account)}</span> : null}
              </span>
              <button type="button" className="sui-btn" onClick={signOut}>
                <LogOut size={17} strokeWidth={1.75} aria-hidden="true" />
                Se déconnecter
              </button>
            </div>
          ) : null}
        </header>

        <section className="sui-hub__intro">
          <p className="sui-hub__eyebrow">Espaces de travail</p>
          <h1 className="sui-hub__title">Où voulez-vous travailler ?</h1>
          <p className="sui-hub__lede">
            Chaque espace n’affiche que ses propres données et le serveur y vérifie vos droits à
            chaque requête. Seuls les espaces ouverts à votre compte apparaissent ici.
          </p>
        </section>

        {waiting ? (
          <div className="sui-hub__loading">
            <SkeletonList rows={3} />
          </div>
        ) : entries.length ? (
          <motion.ul
            className="sui-hub__grid"
            role="list"
            variants={staggerParent}
            initial="hidden"
            animate="visible"
          >
            {entries.map((entry) => {
              const Icon = entry.icon;
              const hidden = entry.sections.length - CHIPS_SHOWN;
              return (
                <motion.li key={entry.id} variants={staggerItem} whileHover={cardHover} className="sui-hub__cell">
                  <Link href={entry.href} className="sui-hubcard">
                    <span className="sui-hubcard__top">
                      <span className="sui-hubcard__icon" style={{ "--tone-bg": `var(--${entry.tone})` }} aria-hidden="true">
                        <Icon size={22} strokeWidth={1.75} />
                      </span>
                      {entry.unread > 0 ? (
                        <span className="sui-hubcard__badge">
                          {entry.unread > 99 ? "99+" : entry.unread}
                          <span className="sui-visually-hidden">
                            {" "}
                            notification{entry.unread > 1 ? "s" : ""} non lue{entry.unread > 1 ? "s" : ""}
                          </span>
                        </span>
                      ) : null}
                      <ArrowUpRight className="sui-hubcard__arrow" size={18} strokeWidth={1.9} aria-hidden="true" />
                    </span>

                    <span className="sui-hubcard__label">{entry.label}</span>
                    <span className="sui-hubcard__desc">{entry.description}</span>

                    {entry.sections.length ? (
                      <span className="sui-hubcard__chips">
                        {entry.sections.slice(0, CHIPS_SHOWN).map((label) => (
                          <span key={label} className="sui-hubcard__chip">{label}</span>
                        ))}
                        {hidden > 0 ? (
                          <span className="sui-hubcard__chip sui-hubcard__chip--more">+{hidden}</span>
                        ) : null}
                      </span>
                    ) : null}

                    <span className="sui-hubcard__cta">
                      Ouvrir l’espace
                      <ArrowUpRight size={15} strokeWidth={2.1} aria-hidden="true" />
                    </span>
                  </Link>
                </motion.li>
              );
            })}
          </motion.ul>
        ) : (
          <Empty
            icon={Compass}
            action={
              <Link href="/connexion" className="sui-btn sui-btn--dark">
                Se connecter
              </Link>
            }
          >
            Aucun espace de travail n’est ouvert pour ce compte. Si vous pensez que c’est une erreur,
            un administrateur doit vous attribuer un rôle dans Comexa Space.
          </Empty>
        )}

        <p className="sui-hub__foot">
          Vos droits sont recalculés par le serveur à chaque espace ouvert — cette page ne fait que
          les présenter.
        </p>
      </main>
    </SoftMotionProvider>
  );
}
