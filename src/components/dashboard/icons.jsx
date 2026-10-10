/* Pictogrammes en trait (24×24), sans dépendance externe. */
const PATHS = {
  money: (<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>),
  check: (<polyline points="20 6 9 17 4 12" />),
  clock: (<><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></>),
  folder: (<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  bolt: (<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />),
  plus: (<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>),
  doc: (<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>),
  calendar: (<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>),
  chart: (<><path d="M3 3v18h18" /><polyline points="7 14 11 10 15 13 21 6" /></>),
  play: (<polygon points="6 4 20 12 6 20 6 4" />),
  stop: (<rect x="6" y="6" width="12" height="12" rx="2" />),
  kanban: (<><rect x="3" y="3" width="5" height="18" rx="1" /><rect x="10" y="3" width="5" height="12" rx="1" /><rect x="17" y="3" width="4" height="8" rx="1" /></>),
  users: (<><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3" /></>),
};

export default function Icon({ name, className = "h-5 w-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name] ?? null}
    </svg>
  );
}
