/* Petits composants partages des espaces. Aucun n'impose de logique metier. */

export function Notice({ tone = "error", children }) {
  const styles =
    tone === "error"
      ? "border-[#E5484D] bg-[#FDECEC] text-[#8A1C1F]"
      : tone === "success"
        ? "border-[#2E9E6A] bg-[#E9F7F0] text-[#1B5E3F]"
        : "border-[#1683E5] bg-[#EAF4FD] text-[#0B2545]";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-[14px] ${styles}`}>
      {children}
    </div>
  );
}

export function Card({ title, action, children, id }) {
  return (
    <section id={id} className="rounded-xl border border-[#D9E2EE] bg-white p-5 shadow-sm sm:p-6">
      {title ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[18px] font-semibold text-[#0B2545]">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const BADGE_TONES = {
  neutral: "bg-[#EEF2F7] text-[#334155]",
  info: "bg-[#EAF4FD] text-[#0B5CAD]",
  success: "bg-[#E9F7F0] text-[#1B5E3F]",
  warning: "bg-[#FFF6DB] text-[#7A5600]",
  danger: "bg-[#FDECEC] text-[#8A1C1F]",
};

export function Badge({ tone = "neutral", children }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function ProgressBar({ value }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-[#E5ECF5]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safe}
      >
        <div className="h-full rounded-full bg-[#1683E5]" style={{ width: `${safe}%` }} />
      </div>
      <span className="w-12 text-right text-[13px] font-medium text-[#0B2545]">{safe} %</span>
    </div>
  );
}

export function Empty({ children }) {
  return <p className="rounded-lg border border-dashed border-[#C9D6E6] p-6 text-center text-[14px] text-[#4B5563]">{children}</p>;
}

export const inputClass =
  "h-11 w-full rounded-lg border border-[#C9D6E6] bg-white px-3 text-[15px] text-[#111827] outline-none focus:border-[#1683E5] focus:ring-2 focus:ring-[#1683E5]/20";

export const primaryButton =
  "inline-flex h-11 items-center justify-center rounded-lg bg-[#0B2545] px-5 text-[15px] font-medium text-white transition hover:bg-[#1683E5] disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButton =
  "inline-flex h-10 items-center justify-center rounded-lg border border-[#0B2545] px-4 text-[14px] font-medium text-[#0B2545] transition hover:bg-[#0B2545] hover:text-white disabled:cursor-not-allowed disabled:opacity-60";
