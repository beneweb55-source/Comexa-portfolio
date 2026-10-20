/**
 * RESSOURCES PARTAGEES DANS UN MESSAGE — regles PURES.
 *
 * Ce fichier decide deux choses, et seulement deux choses, parce que ce sont
 * les deux qui peuvent devenir une faille silencieuse :
 *
 *  1. LA FORME D'UNE REFERENCE. Un partage stocke un COUPLE
 *     (`resourceType`, `resourceId`) — jamais une URL, jamais un texte copie.
 *     Le titre et le statut s'effacent, changent, se renomment : l'identifiant
 *     interne, lui, reste. Tout ce qui normalise ces couples vit ici, hors
 *     base et hors HTTP, donc verifiable en trois lignes de test.
 *
 *  2. CE QU'UNE CARTE A LE DROIT DE DIRE. Une carte est construite par un
 *     WHITELIST EXPLICITE de champs par type de ressource, jamais par un
 *     etalement de la ligne lue (`{ ...row }`). C'est la difference entre « la
 *     facture expose son objet entier, avec notes, conditions et raison
 *     sociale du client » et « la carte expose une reference, un statut et une
 *     echeance ». Ajouter une colonne aux modeles ne peut donc plus fuiter dans
 *     le chat par distraction : ici, ce qui n'est pas cite n'existe pas.
 *
 * LE TITRE STOCKE A PARTAGE EST UN SNAPSHOT D'AUDIT, PAS UN DROIT. Il reste en
 * base pour la tracerabilite, mais la lecture d'un message ne le renvoie
 * JAMAIS : une carte affiche ce que LE LECTEUR courant a le droit de voir,
 * resolu en direct (voir `SharedResourcesService`). Un participant sans acces
 * au projet partage voit « ressource hors de votre perimetre », jamais le titre
 * que l'emetteur, lui, avait le droit de lire.
 */

/**
 * Les sept types partageables. Liste LITTERALE, volontairement : ce fichier
 * doit rester une FEUILLE du graphe — ni Prisma, ni Nest, ni le client genere.
 * Les valeurs sont celles de l'enum Prisma `SharedResourceType` ; elles ne
 * doivent pas diverger de lui.
 */
export const SHAREABLE_RESOURCE_TYPES = [
  'PROJECT',
  'TASK',
  'CLIENT',
  'QUOTE',
  'INVOICE',
  'PAYMENT',
  'DOCUMENT',
] as const;

export type SharedResourceTypeName = (typeof SHAREABLE_RESOURCE_TYPES)[number];

/** Un couple valide : type connu + identifiant non vide. */
export interface SharedResourceRef {
  readonly resourceType: SharedResourceTypeName;
  readonly resourceId: string;
}

/** Ce que le client envoie : rien n'est encore valide a ce stade. */
export interface SharedResourceRefInput {
  readonly resourceType?: unknown;
  readonly resourceId?: unknown;
}

/**
 * Une carte, telle que l'API l'expose.
 *
 * `available: false` est la REPONSE POLIE a « soit ca n'existe plus, soit vous
 * n'y avez pas acces » : la distinction entre les deux serait une fuite
 * d'existence. Le lecteur ne merite de savoir que ce qu'il peut ouvrir.
 */
export interface ResourceCardView {
  readonly resourceType: SharedResourceTypeName;
  readonly resourceId: string;
  readonly available: boolean;
  /** Titre lisible : nom, reference, sujet — selon ce que la ressource porte. */
  readonly title: string | null;
  /** Ligne d'appoint : projet, echeance, montant — jamais une note privee. */
  readonly subtitle: string | null;
  /** Cle de statut brute (enum), localisee et coloree par le frontend. */
  readonly statusKey: string | null;
  /** Lien COURT facon notification, resolu cote client par l'espace courant. */
  readonly link: string | null;
  /** Formatage monetaire deja decide cote serveur : la carte ne calcule rien. */
  readonly amount: string | null;
}

export const MAX_SHARED_RESOURCES_PER_MESSAGE = 10;
export const MAX_SHARED_RESOURCES_PER_RESOLVE = 50;

/** Cle de cache cote client comme cote serveur : `TYPE:id`. */
export function sharedResourceKey(
  ref: Pick<SharedResourceRef, 'resourceType' | 'resourceId'>,
): string {
  return `${ref.resourceType}:${ref.resourceId}`;
}

/**
 * Normalise les references recues : trim, tri des doublons, refus des types
 * inconnus.
 *
 * `rejected` compte TOUT ce qui n'a pas survecu a la normalisation (type
 * inconnu, identifiant vide). L'appelant decide : `send` transforme un
 * `rejected > 0` en erreur 422 explicite, parce qu'un partage qui a
 * silencieusement perdu une ressource fait croire au client qu'elle est partie.
 */
export function normalizeSharedResourceRefs(
  refs: readonly SharedResourceRefInput[] | null | undefined,
): { readonly refs: SharedResourceRef[]; readonly rejected: number } {
  if (!Array.isArray(refs)) {
    return { refs: [], rejected: 0 };
  }

  const out: SharedResourceRef[] = [];
  const seen = new Set<string>();
  let rejected = 0;

  for (const raw of refs) {
    const type = raw?.resourceType;
    const id = typeof raw?.resourceId === 'string' ? raw.resourceId.trim() : '';
    const known =
      typeof type === 'string' && (SHAREABLE_RESOURCE_TYPES as readonly string[]).includes(type);

    if (!known || id.length === 0) {
      rejected += 1;
      continue;
    }

    const key = `${type}:${id}`;
    if (seen.has(key)) {
      // Un doublon n'est pas une erreur : c'est la meme intention dite deux
      // fois. On la compte une fois.
      continue;
    }
    seen.add(key);
    out.push({ resourceType: type as SharedResourceTypeName, resourceId: id });
  }

  return { refs: out, rejected };
}

/** Un lien COURT par type, dans la grammaire deja utilisee par les notifications. */
export function sharedResourceLink(type: SharedResourceTypeName, resourceId: string): string {
  switch (type) {
    case 'PROJECT':
      return `/projets/${resourceId}`;
    case 'TASK':
      return `/taches/${resourceId}`;
    case 'CLIENT':
      return `/clients/${resourceId}`;
    case 'QUOTE':
      return `/devis/${resourceId}`;
    case 'INVOICE':
      return `/factures/${resourceId}`;
    case 'PAYMENT':
      return `/paiements/${resourceId}`;
    case 'DOCUMENT':
      // Aucun document n'a de page propre : le lien mene au projet qui
      // l'heberge, et le frontend complete par `?document=`.
      return `/documents/${resourceId}`;
  }
}

function amountText(value: unknown, currency: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const unit = typeof currency === 'string' && currency.length <= 8 ? currency : 'DZD';
  return `${numeric.toFixed(2)} ${unit}`;
}

/** Les lignes que chaque chargeur renvoie : le champ brut reste local a la carte. */
export interface ProjectRow {
  id: string;
  name: string;
  reference?: string | null;
  status: string;
  health?: string | null;
  progressPercent?: number | null;
  dueDate?: Date | string | null;
  client?: { companyName?: string | null } | null;
}

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority?: string | null;
  dueDate?: Date | string | null;
  isPersonal?: boolean;
  project?: { name?: string | null } | null;
}

export interface ClientRow {
  id: string;
  companyName: string;
  status: string;
  sector?: string | null;
}

export interface BillingRow {
  id: string;
  reference: string;
  status: string;
  total?: unknown;
  amount?: unknown;
  currency?: string | null;
  dueDate?: Date | string | null;
  validUntil?: Date | string | null;
  paidAt?: Date | string | null;
  subject?: string | null;
  client?: { companyName?: string | null } | null;
  /**
   * Champs métier QUI N'ONT AUCUN DROIT D'APPARAITRE sur la carte.
   *
   * Ils sont déclarés ici pour que la fuite soit vérifiable par le
   * compilateur : la spec les passe deliberately (notes d'une facture, motif de
   * refus d'un devis) et vérifie qu'ils n'apparaissent ni dans le titre, ni
   * dans le sous-titre, ni dans le JSON de la carte. Les déclarer ici permet
   * au test d'exister ; les omettre rendrait ce test impossible à écrire.
   */
  notes?: string | null;
  terms?: string | null;
  rejectionReason?: string | null;
}

export interface DocumentRow {
  id: string;
  name: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  category?: string | null;
  visibility?: string | null;
  projectId?: string | null;
  updatedAt?: Date | string | null;
}

function dateText(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Cartes — une par type. Chacune ne cite QUE ce qu'elle a le droit de dire.  */
/* -------------------------------------------------------------------------- */

export function cardFromProject(
  row: ProjectRow,
): Omit<ResourceCardView, 'resourceType' | 'resourceId' | 'available'> {
  return {
    title: row.name,
    subtitle: row.client?.companyName ?? null,
    statusKey: row.status,
    link: sharedResourceLink('PROJECT', row.id),
    amount: null,
  };
}

export function cardFromTask(
  row: TaskRow,
): Omit<ResourceCardView, 'resourceType' | 'resourceId' | 'available'> {
  const bits = [
    row.isPersonal ? 'Tâche personnelle' : (row.project?.name ?? null),
    dateText(row.dueDate) ? `Échéance ${dateText(row.dueDate)}` : null,
  ];
  return {
    title: row.title,
    subtitle: bits.filter(Boolean).join(' · ') || null,
    statusKey: row.status,
    link: sharedResourceLink('TASK', row.id),
    amount: null,
  };
}

/**
 * Un dossier client dans une carte : la raison sociale et le statut, RIEN
 * d'autre. Pas de contact, pas d'adresse, pas de numero legal, pas de note
 * commerciale — le chat n'est pas le CRM, et une conversation de groupe n'est
 * pas un perimetre de lecture.
 */
export function cardFromClient(
  row: ClientRow,
): Omit<ResourceCardView, 'resourceType' | 'resourceId' | 'available'> {
  return {
    title: row.companyName,
    subtitle: row.sector ?? null,
    statusKey: row.status,
    link: sharedResourceLink('CLIENT', row.id),
    amount: null,
  };
}

export function cardFromQuote(
  row: BillingRow,
): Omit<ResourceCardView, 'resourceType' | 'resourceId' | 'available'> {
  return {
    title: `${row.reference} — ${row.subject ?? 'Devis'}`,
    subtitle: row.client?.companyName ?? null,
    statusKey: row.status,
    link: sharedResourceLink('QUOTE', row.id),
    amount: amountText(row.total, row.currency),
  };
}

export function cardFromInvoice(
  row: BillingRow,
): Omit<ResourceCardView, 'resourceType' | 'resourceId' | 'available'> {
  return {
    title: row.reference,
    subtitle:
      [
        row.client?.companyName ?? null,
        dateText(row.dueDate) ? `Échéance ${dateText(row.dueDate)}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
    statusKey: row.status,
    link: sharedResourceLink('INVOICE', row.id),
    amount: amountText(row.total, row.currency),
  };
}

export function cardFromPayment(
  row: BillingRow,
): Omit<ResourceCardView, 'resourceType' | 'resourceId' | 'available'> {
  return {
    title: row.reference,
    subtitle: row.paidAt ? `Reçu le ${dateText(row.paidAt)}` : null,
    statusKey: row.status,
    link: sharedResourceLink('PAYMENT', row.id),
    amount: amountText(row.amount, row.currency),
  };
}

export function cardFromDocument(
  row: DocumentRow,
): Omit<ResourceCardView, 'resourceType' | 'resourceId' | 'available'> {
  const size = Number.isFinite(row.sizeBytes as number)
    ? Math.round((row.sizeBytes as number) / 1024)
    : null;
  return {
    title: row.name,
    subtitle:
      [row.category ?? null, size !== null ? `${size} Ko` : null, dateText(row.updatedAt)]
        .filter(Boolean)
        .join(' · ') || null,
    // Un document n'a pas de page : on relie son projet quand il en a un.
    link: row.projectId ? `/projets/${row.projectId}?document=${row.id}` : null,
    // La visibilite n'est pas un statut : la carte n'affiche jamais INTERNAL
    // ou CLIENT — l'information est deja portee par le fait que la carte existe.
    statusKey: null,
    amount: null,
  };
}

/** Introuvable OU sans droit : la meme carte vide, pour la meme raison. */
export function unavailableCard(ref: SharedResourceRef): ResourceCardView {
  return {
    ...ref,
    available: false,
    title: null,
    subtitle: null,
    statusKey: null,
    link: null,
    amount: null,
  };
}

export function availableCard(
  ref: SharedResourceRef,
  card: Omit<ResourceCardView, 'resourceType' | 'resourceId' | 'available'>,
): ResourceCardView {
  return { ...ref, ...card, available: true };
}

/**
 * L'apercu de conversation quand un message ne porte AUCUN TEXTE : « 📎 Projet
 * · Client X », pas « (vide) ». La liste des conversations doit rester
 * lisible quand on y partage seulement une ressource.
 */
export function sharedResourcesPreview(cards: readonly ResourceCardView[]): string {
  const names = cards
    .filter((card) => card.available && card.title)
    .slice(0, 2)
    .map((card) => card.title);
  if (names.length === 0) return 'Ressource partagée';
  const more = cards.filter((card) => card.available).length > names.length ? '…' : '';
  return `📎 ${names.join(', ')}${more}`;
}
