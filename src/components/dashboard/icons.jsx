"use client";

/*
 * Pictogrammes de la charte, désormais pris dans `lucide-react`.
 *
 * Le composant garde la signature historique (`<Icon name="users" />`) pour que les
 * pages existantes continuent de fonctionner sans modification ; chaque nom est
 * simplement résolu vers l'icône lucide correspondante. Aucun emoji n'est utilisé
 * dans l'interface : tout symbole passe par ici ou par `lucide-react` directement.
 *
 * Règle de style (brief) : taille 16–20 px, trait 1.75, couleur héritée
 * (`currentColor`) — ne jamais forcer une couleur dans une icône.
 */

import {
  Archive,
  BadgeCheck,
  Banknote,
  Bell,
  BellRing,
  Briefcase,
  CalendarClock,
  CalendarDays,
  ChartNoAxesColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeftRight,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Clock,
  Contact,
  Download,
  Eye,
  FilePen,
  FilePlus,
  FileText,
  Folder,
  FolderKanban,
  History,
  Hourglass,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  LifeBuoy,
  ListChecks,
  Loader,
  Lock,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  ReceiptText,
  Search,
  Send,
  Settings2,
  Share2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Square,
  SquareKanban,
  SquareTerminal,
  Target,
  Trash2,
  TrendingUp,
  TriangleAlert,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";

const MAP = {
  /* Navigation et structure */
  home: LayoutDashboard,
  dashboard: LayoutDashboard,
  users: Users,
  user: UserRound,
  "user-plus": UserPlus,
  clients: Users,
  contact: Contact,
  contacts: Contact,
  briefcase: Briefcase,
  target: Target,
  quote: FileText,
  devis: FileText,
  invoice: ReceiptText,
  facture: ReceiptText,
  cart: ShoppingCart,
  commande: ShoppingCart,
  inbox: Inbox,
  folder: Folder,
  project: FolderKanban,
  kanban: SquareKanban,
  calendar: CalendarDays,
  "calendar-clock": CalendarClock,
  clock: Clock,
  doc: ClipboardList,
  message: MessageSquare,
  mail: Mail,
  chart: ChartNoAxesColumn,
  analytics: ChartNoAxesColumn,
  layout: LayoutTemplate,
  "layout-grid": LayoutGrid,
  shield: ShieldCheck,
  history: History,
  settings: Settings2,
  money: Banknote,
  wallet: Wallet,
  "trending-up": TrendingUp,
  "list-checks": ListChecks,
  archive: Archive,
  download: Download,
  eye: Eye,
  pencil: Pencil,
  trash: Trash2,
  check: Check,
  "check-circle": CircleCheck,
  close: X,
  plus: Plus,
  minus: Minus,
  minus_picto: Minus,
  menu: Menu,
  "more-horizontal": MoreHorizontal,
  share: Share2,
  search: Search,
  send: Send,
  terminal: SquareTerminal,
  sparkles: Sparkles,
  radio: Radio,
  "badge-check": BadgeCheck,
  "hourglass": Hourglass,
  "triangle-alert": TriangleAlert,
  "circle-alert": CircleAlert,
  "life-buoy": LifeBuoy,
  "file-pen": FilePen,
  "file-plus": FilePlus,
  megaphone: Megaphone,
  lock: Lock,
  loader: Loader,
  play: Play,
  pause: Pause,
  stop: Square,
  bolt: Zap,
  bell: Bell,
  "bell-ring": BellRing,
  logout: LogOut,
  expand: ChevronsLeftRight,
  collapse: ChevronsLeftRight,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
};

export const ICON_NAMES = Object.keys(MAP);

/**
 * Icône de la charte. `name` accepte un identifiant de la table ci-dessus ; un nom
 * inconnu ne rend rien plutôt que de casser la page.
 */
export default function Icon({ name, className = "h-5 w-5", size = 20, strokeWidth = 1.75, ...rest }) {
  const Picto = MAP[name];
  if (!Picto) return null;
  return <Picto className={className} size={size} strokeWidth={strokeWidth} aria-hidden="true" {...rest} />;
}

/** Accès direct à une icône lucide par son nom de table (composants `softui`). */
export function iconFor(name) {
  return MAP[name] ?? null;
}
