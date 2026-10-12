"use client";

import { useState } from "react";
import { creatorAvatarUrlOf, creatorInitialsOf, creatorNameOf } from "@/lib/tasks";

/**
 * Photo de profil d'un compte, avec repli sur les initiales.
 *
 * L'API ne rend qu'une clé de stockage (`avatarKey`) : tant qu'il n'y a pas
 * d'adresse affichable, on montre les initiales, dans le même élément que la
 * photo — une tâche dont le créateur n'a pas d'image reste donc alignée. Une
 * adresse qui ne répond pas retombe également sur les initiales : jamais
 * d'image cassée à l'écran.
 */
export function UserAvatar({ profile, size = 28, className = "" }) {
  const url = creatorAvatarUrlOf(profile);
  // On retient l'ADRESSE qui a échoué, et non un simple booléen : changer de
  // profil ou de photo réessaie donc l'image, sans effet ni remise à zéro.
  const [failedUrl, setFailedUrl] = useState(null);

  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size / 2.6)) };

  if (url && url !== failedUrl) {
    return (
      // Image hébergée par l'API ou hors du site : balise <img> simple, sans
      // optimisation Next (domaine non déclaré).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
        className={`cx-avatar ${className}`}
        style={style}
      />
    );
  }

  return (
    <span aria-hidden="true" title={creatorNameOf(profile)} className={`cx-avatar ${className}`} style={style}>
      {creatorInitialsOf(profile)}
    </span>
  );
}

export default UserAvatar;
