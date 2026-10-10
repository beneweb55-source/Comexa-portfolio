/*
 * Fond « mesh gradient » : un plan très sombre et des orbes floutées aux couleurs
 * primaires de Comexa. Purement décoratif (aria-hidden), sans JavaScript.
 */
export default function MeshBackground({ className = "" }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-[#071a33] ${className}`}>
      <span className="absolute -left-32 -top-40 h-[520px] w-[520px] rounded-full bg-[#1e86e0]/40 blur-[120px]" />
      <span className="absolute right-[-120px] top-[10%] h-[460px] w-[460px] rounded-full bg-[#4fb0f0]/25 blur-[120px]" />
      <span className="absolute bottom-[-180px] left-[25%] h-[520px] w-[620px] rounded-full bg-[#0f4e8a]/60 blur-[140px]" />
      <span className="absolute bottom-[-60px] right-[20%] h-[300px] w-[300px] rounded-full bg-[#93c7f5]/10 blur-[90px]" />
      {/* Voile de lisibilité : garde le centre plus sombre que les bords. */}
      <span className="absolute inset-0 bg-gradient-to-b from-transparent via-[#071a33]/30 to-[#071a33]/80" />
    </div>
  );
}
