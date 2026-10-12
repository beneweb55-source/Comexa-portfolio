/*
 * Fond « mesh gradient » clair : des orbes bleues lumineuses, floutées, posées
 * sur un fond transparent. Purement décoratif (aria-hidden), sans JavaScript.
 *
 * Son rôle est double : donner au thème « Liquid Glass » de l'espace équipe un
 * décor assez contrasté pour être VU à travers les surfaces vitrées (le flou a
 * alors quelque chose à refracter), et rester invisible ailleurs grâce à son
 * fond transparent.
 */
export default function MeshBackground({ className = "" }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`}>
      <span className="absolute -left-32 -top-40 h-[520px] w-[520px] rounded-full bg-[#4fb0f0]/45 blur-[110px]" />
      <span className="absolute right-[-120px] top-[8%] h-[460px] w-[460px] rounded-full bg-[#1e86e0]/30 blur-[110px]" />
      <span className="absolute bottom-[-180px] left-[22%] h-[520px] w-[620px] rounded-full bg-[#93c7f5]/50 blur-[130px]" />
      <span className="absolute bottom-[-60px] right-[18%] h-[320px] w-[320px] rounded-full bg-[#e2effd]/80 blur-[90px]" />
      {/* Voile de lisibilité : très léger, il garde le texte lisible sans éteindre les halos. */}
      <span className="absolute inset-0 bg-gradient-to-b from-transparent via-white/10 to-white/40" />
    </div>
  );
}
