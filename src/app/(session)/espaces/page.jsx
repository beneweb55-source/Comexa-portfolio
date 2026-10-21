"use client";

/*
 * Hub des espaces de travail — `/espaces`.
 *
 * L'ÉCRAN D'ENTRÉE DE L'APPLICATION DESKTOP ET ANDROID. La fenêtre Electron et
 * la WebView Android s'ouvrent ici : l'utilisateur choisit son espace au lieu
 * d'être jeté dans un seul. Sur le site, le même écran est rejoint depuis le
 * sélecteur d'espace (« Tous les espaces »).
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
 * L'HABILLAGE EST CELUI DU DASHBOARD. La présentation vit dans
 * `components/softui/HubScreen.jsx` : la même coque noire, la même navbar, la
 * même languette, le même rail, les mêmes cartes pastel et le même dock que
 * l'espace de travail. Les deux applications mobiles et desktop ouvrent donc sur
 * le même produit visuel que le dashboard — sans duplicer la maquette ici.
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

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { Compass, ShoppingCart } from "lucide-react";
import { hasTeamAccess, homeFor } from "@/lib/access";
import { SPACE_IDS, SPACES, spaceForPath } from "@/lib/spaces";
import { visibleNavigation } from "@/lib/space-navigation";
import { useAuth } from "@/lib/session";
import { useSpaces } from "@/lib/spaces-context";
import { SPACE_ICON } from "@/components/softui/SpaceSwitcher";
import HubScreen from "@/components/softui/HubScreen";

/** Chemin de ce hub : sert au retour après connexion. */
const HUB_PATH = "/espaces";

/* Un client n'a pas d'espace dans `SPACES` (qui ne couvre que les trois espaces
   d'équipe) : sa carte reprend ce que son espace affiche réellement. */
const CLIENT_ENTRY = {
  id: "client",
  label: "Espace client",
  shortLabel: "Client",
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
          shortLabel: meta.shortLabel,
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

  /* La page « Mon compte » suit l'espace d'accueil du compte : le personnel pour
     un membre de l'équipe, l'espace client pour un client. */
  const accountHref = useMemo(() => {
    if (!account) return "/espace-client/compte";
    if (!team) return "/espace-client/compte";
    const home = homeFor(account);
    const space = spaceForPath(home);
    return space && SPACES[space] ? `${SPACES[space].prefix}/compte` : "/espace-client/compte";
  }, [account, team]);

  /* L'espace d'accueil du compte est celui que la connexion aurait ouvert :
     c'est lui qui reçoit la carte mise en avant du hub. */
  const highlightId = useMemo(() => {
    if (!account) return null;
    return spaceForPath(homeFor(account));
  }, [account]);

  async function signOut() {
    await logout();
    router.replace("/connexion");
    router.refresh();
  }

  if (status === "anonymous") return null;

  return (
    <HubScreen
      account={account}
      entries={entries}
      loading={waiting}
      accountHref={accountHref}
      highlightId={highlightId}
      onSignOut={signOut}
    />
  );
}
