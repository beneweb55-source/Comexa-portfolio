"use client";

/*
 * Layout commun aux trois espaces de travail (personnel, équipe, Comexa Space).
 *
 * Ordre des responsabilités :
 *  1. `RequireSession` vérifie la session, l'accès à l'espace et à la rubrique
 *     avec les droits COMPLETS du compte (il calcule lui-même les droits
 *     effectifs de l'espace) ;
 *  2. `SpaceScopedAuth` republie la session réduite aux droits de l'espace :
 *     les pages et la coque n'affichent que ce que l'API acceptera, et chaque
 *     requête annonce l'espace au serveur (`X-Comexa-Space`) ;
 *  3. la coque reçoit les rubriques autorisées de l'espace ; le minuteur et la
 *     console Comexa vivent dans le dock (une seule barre flottante).
 */

import { useEffect, useMemo } from "react";
import RequireSession from "@/components/workspace/RequireSession";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";
import ApiContractBanner from "@/components/ApiContractBanner";
import AiAgentDrawer from "@/components/workspace/AiAgentDrawer";
import TimerPill from "@/components/workspace/TimerPill";
import FocusDockButton from "@/components/focus/FocusDockButton";
import FocusOverlay from "@/components/focus/FocusOverlay";
import { FocusProvider } from "@/components/focus/FocusProvider";
import { SpaceScopedAuth, useAuth } from "@/lib/session";
import { useSpaces } from "@/lib/spaces-context";
import { effectivePermissions, rememberSpace } from "@/lib/spaces";
import { visibleNavigation } from "@/lib/space-navigation";
import { TimerProvider } from "@/lib/timer";
import { canUseTimer } from "@/lib/timer-access";

export default function SpaceLayout({ space, children, withTimer = true, withConsole = true }) {
  const { user } = useAuth();
  const { permissionsFor } = useSpaces();
  const serverPermissions = permissionsFor(space);
  const basePermissions = user?.permissions;

  // Droits de l'espace : ceux de l'API dès qu'elle a répondu, le miroir local avant.
  const permissions = useMemo(() => {
    if (serverPermissions) return serverPermissions;
    return effectivePermissions(space, basePermissions ?? []);
  }, [basePermissions, serverPermissions, space]);

  const groups = useMemo(() => visibleNavigation(space, permissions), [permissions, space]);

  /* Minuteur dans le dock seulement s'il est utilisable avec les droits de
     l'espace : sinon le dock gardait un séparateur suivi d'un segment vide
     (comptes commerciaux, Comexa Space). */
  const timerAllowed = useMemo(
    () => withTimer && canUseTimer(user ? { ...user, permissions: [...permissions] } : null),
    [permissions, user, withTimer],
  );

  useEffect(() => {
    if (user?.id) rememberSpace(user.id, space);
  }, [space, user?.id]);

  const shell = (
    <WorkspaceShell
      space={space}
      groups={groups}
      dockEnd={
        timerAllowed ? (
          <>
            <TimerPill variant="dock" />
            <FocusDockButton />
          </>
        ) : null
      }
      consoleAvailable={withConsole}
    >
      <ApiContractBanner />
      {children}
    </WorkspaceShell>
  );

  return (
    <RequireSession>
      <SpaceScopedAuth space={space} permissions={permissions}>
        {withTimer ? (
          <TimerProvider>
            <FocusProvider>
              {shell}
              <FocusOverlay />
            </FocusProvider>
            {withConsole ? <AiAgentDrawer showLauncher={false} /> : null}
          </TimerProvider>
        ) : (
          <>
            {shell}
            {withConsole ? <AiAgentDrawer showLauncher={false} /> : null}
          </>
        )}
      </SpaceScopedAuth>
    </RequireSession>
  );
}
