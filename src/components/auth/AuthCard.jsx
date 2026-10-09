import Link from "next/link";

/** Cadre commun des pages d'authentification publiques (connexion, inscription, verification). */
export default function AuthCard({ title, intro, children, footer }) {
  return (
    <main className="flex flex-1 items-start justify-center bg-[#F8F9FC] px-4 py-12 sm:py-16">
      <div className="w-full max-w-[460px]">
        <div className="rounded-2xl border border-[#D9E2EE] bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-[26px] font-semibold text-[#0B2545]">{title}</h1>
          {intro ? <p className="mt-2 text-[15px] leading-relaxed text-[#4B5563]">{intro}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
        {footer ? <div className="mt-6 text-center text-[14px] text-[#4B5563]">{footer}</div> : null}
        <p className="mt-4 text-center text-[13px] text-[#6B7280]">
          <Link href="/" className="hover:text-[#1E86E0]">
            ← Retour au site Comexa
          </Link>
        </p>
      </div>
    </main>
  );
}

export function Field({ id, label, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[14px] font-medium text-[#111827]">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[12.5px] text-[#6B7280]">{hint}</p> : null}
    </div>
  );
}
