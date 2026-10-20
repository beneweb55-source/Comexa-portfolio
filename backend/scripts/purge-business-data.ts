import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * PURGE DES DONNEES METIER — FACTURES, CLIENTS, DEVIS, PROJETS…
 *
 *   npm run db:purge            # simulation : compte tout, ne supprime rien
 *   npm run db:purge -- --yes   # suppression effective
 *
 * -----------------------------------------------------------------------------
 * CE QUE CE SCRIPT FAIT, ET CE QU'IL NE FAIT PAS
 * -----------------------------------------------------------------------------
 * Il supprime les LIGNES qui representent du travail : factures, devis,
 * paiements, clients, prospects, projets, taches, documents, messages, soldes.
 *
 * Il NE supprime pas la STRUCTURE : les comptes de l'equipe, les roles, les
 * permissions, les parametres, les devises, les taux de change, les packs, les
 * services, le contenu public du site. Ces lignes-la ne sont pas des donnees
 * de test : ce sont les parametres du produit. Les retirer rendrait l'application
 * inutilisable alors que la demande porte sur les DONNEES.
 *
 * La separation est celle du cahier des charges : un client, un devis, une
 * facture sont des OBJETS ; un role, une devise, un pack sont des
 * CONFIGURATIONS. Effacer des configurations pour « nettoyer » une base
 * reviendrait a demonter l'outil.
 *
 * -----------------------------------------------------------------------------
 * L'ORDRE DE SUPPRESSION EST LE CONTRAT DE CE SCRIPT
 * -----------------------------------------------------------------------------
 * PostgreSQL refuse de supprimer une ligne encore referencee. Les contraintes
 * `ON DELETE RESTRICT` du schema sont donc la regle : on supprime les ENFANTS
 * avant les PARENTS. Une facture reference son client (`RESTRICT`) : supprimer
 * le client d'abord echouerait, et le script s'arreterait au milieu — avec la
 * base a moitie purgee, ce qui est le pire etat possible.
 *
 * D'ou la liste ci-dessous : elle est ordonnee, et chaque entree depend
 * seulement des entree qui la precedent. Ne la reordonnez pas.
 *
 * -----------------------------------------------------------------------------
 * LE SCRIPT EST DESTRUCTIF : DEUX GARDE-FOUS
 * -----------------------------------------------------------------------------
 * 1. SIMULATION PAR DEFAUT. Sans `--yes`, rien n'est supprime : le script
 *    affiche ce qu'il supprimerait, table par table, et s'arrete la. C'est le
 *    mode par defaut parce que l'erreur la plus grave n'est pas de ne pas
 *    purger, mais de purger la base de production par erreur.
 *
 * 2. L'HOTE DE LA BASE EST AFFICHE. Avant toute suppression, le script montre
 *    l'hote de `DATABASE_URL` — jamais le mot de passe, jamais la chaine
 *    complete. La ligne doit etre lue avant de taper `--yes` : une base de
 *    developpement et une base de production ne se ressemblent que par le
 *    reste du script.
 *
 * -----------------------------------------------------------------------------
 * CE QUE LE SCRIPT NE PEUT PAS FAIRE
 * -----------------------------------------------------------------------------
 * Les FICHIERS des documents restent dans le stockage objet (S3, ou le dossier
 * local du driver `local`). Supprimer la ligne `documents` ne supprime pas
 * l'objet dans le bucket : le lien signe ne fonctionnera plus, mais l'objet y
 * reste. C'est volontaire — purger un bucket demande de connaitre son contenu,
 * et le script ne devine pas. Passez par le driver de stockage pour ca.
 *
 * -----------------------------------------------------------------------------
 * LES COMPTES NE SONT JAMAIS SUPPRIMES
 * -----------------------------------------------------------------------------
 * Ce script ne touche PAS a la table `users`. Aucun compte n'est efface, quel
 * que soit son role : ni les comptes de l'equipe, ni les comptes techniques
 * (`isServiceAccount`, ceux des integrations n8n), ni les comptes de l'espace
 * client.
 *
 * Un compte n'est pas une donnee metier : c'est une IDENTITE. Le supprimer
 * effacerait l'historique de ce que la personne a fait — ses activites, ses
 * messages, ses saisies de temps — et avec lui la tracabilite que le journal
 * d'audit pretend justement garantir. Purger les factures sans effacer ceux
 * qui les ont emises serait une base qui ne dit plus qui a fait quoi.
 *
 * CE QU'IL ADVIENT AU COMPTE D'UN CLIENT SUPPRIME. La relation
 * `ClientPortalAccount` est en `ON DELETE SET NULL` : le compte survit, mais
 * `clientId` passe a NULL. Il peut toujours se connecter ; l'espace client lui
 * repond `403 — ce compte client n'est rattache a aucun dossier`, message
 * prevu pour ce cas exact (voir `client-scope.ts`). Ce n'est ni une panne ni
 * une donnee corrompue : c'est un compte sans dossier, et l'agent qui le
 * rattache a nouveau le fait depuis l'administration.
 *
 * `npm run db:seed` fait cette mise en liaison : il recree le client
 * coquille `CLI-2026-0001` et rattache le compte existant a ce nouveau client.
 *
 * -----------------------------------------------------------------------------
 * LES COMPTEURS DE NUMEROTATION
 * -----------------------------------------------------------------------------
 * `counters` porte le dernier numero utilise par portee et par annee
 * (`FAC-2026-0042`). Apres la purge, plus aucune facture n'existe : un compteur
 * laisse a 42 ferait attribuer `FAC-2026-0043` a la premiere facture recreee,
 * et les numeros 1 a 42 ne correspondraient a rien. Les compteurs sont donc
 * remis a zero — sauf si `--no-reset-counters` est passe.
 *
 * -----------------------------------------------------------------------------
 * LE JOURNAL D'AUDIT
 * -----------------------------------------------------------------------------
 * `audit_logs` est supprime avec le reste. Ses lignes pointent vers des
 * entites qui n'existent plus ; les laisserproduirait un journal qui parle de
 * clients, de factures et de projets introuvables. Sur une base de
 * demonstration, c'est du bruit ; sur une base de production, ce serait une
 * trace a ne pas effacer — dans ce cas, ne lancez pas ce script.
 *
 * -----------------------------------------------------------------------------
 * APRES LA PURGE : RE-SEMER
 * -----------------------------------------------------------------------------
 * La purge emporte le client coquille `CLI-2026-0001` du seed, puisque c'est
 * un client. Le COMPTE qui y etait rattache, lui, survit : il se retrouve
 * simplement sans dossier.
 *
 * `npm run db:seed` restaure le tout : il est idempotent, il ne touche qu'a
 * ce qui manque, il recree le client et rattache le compte existant a ce
 * nouveau client, et il ne reinjecte AUCUNE donnee metier. C'est la suite
 * logique d'une purge, et l'ordre compte : on purge, puis on re-seme.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL est absente. Copiez .env.example vers .env et renseignez la chaine.');
  process.exit(1);
}

/**
 * La chaine de connexion, typee `string`.
 *
 * Le raffinement de type fait par le garde ci-dessus estVisible dans le meme
 * bloc, mais PAS dans une fonction imbriquee — c'est une regle de TypeScript,
 * pas un oubli. On laLie donc une fois pour toutes dans une constante
 * explicitement typee : les fonctions plus bas peuvent alors l'utiliser sans
 * repeter l'assertion.
 */
const databaseUrl: string = connectionString;

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

/** Un etape du plan de suppression : un modele, son libelle, et les deux operations. */
type Step = {
  /** Nom du modele Prisma — sert a l'affichage et a l'ordre. */
  model: string;
  /** Ce que l'etape supprime, en francais. */
  label: string;
  /** Compte les lignes qui seraient supprimees. */
  count: () => Promise<number>;
  /** Supprime les lignes et renvoie le nombre supprime. */
  purge: () => Promise<number>;
};

/**
 * L'hote de la base, SANS les identifiants.
 *
 * Afficher l'hote est une precaution, pas un compliment : deux bases peuvent
 * differer par leur nom, pas par le reste du script. On ne montre jamais la
 * chaine complete — elle porte le mot de passe.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(hote illisible)';
  }
}

/** `--yes` : la suppression est demandee explicitement. Sans lui, rien ne part. */
const confirmed = process.argv.includes('--yes');
/** `--no-reset-counters` : la numerotation repart d'ou elle en etait. */
const resetCounters = !process.argv.includes('--no-reset-counters');

/**
 * Le plan de suppression, DANS L'ORDRE.
 *
 * Chaque entree ne depend que des entrees qui la precedent. Les contraintes
 * `RESTRICT` du schema sont la regle qui produit cet ordre ; les `CASCADE` et
 * les `SET NULL` sonttraits explicitement quand meme, pour que le compte
 * rendu dise ce qui a disparu plutot que ce qui a suivi.
 */
function buildPlan(): Step[] {
  return [
    // -- Les traces d'activite, avant tout le reste -------------------
    {
      model: 'IdempotencyRecord',
      label: "cles d'idempotence (rejeu de requetes)",
      count: () => prisma.idempotencyRecord.count(),
      purge: () => prisma.idempotencyRecord.deleteMany().then((r) => r.count),
    },
    {
      model: 'Notification',
      label: 'notifications',
      count: () => prisma.notification.count(),
      purge: () => prisma.notification.deleteMany().then((r) => r.count),
    },
    {
      model: 'Activity',
      label: 'activites',
      count: () => prisma.activity.count(),
      purge: () => prisma.activity.deleteMany().then((r) => r.count),
    },
    {
      model: 'AuditLog',
      label: "journal d'audit",
      count: () => prisma.auditLog.count(),
      purge: () => prisma.auditLog.deleteMany().then((r) => r.count),
    },

    // -- La messagerie ---------------------------------------------------
    {
      model: 'MessageReadReceipt',
      label: 'accuses de lecture',
      count: () => prisma.messageReadReceipt.count(),
      purge: () => prisma.messageReadReceipt.deleteMany().then((r) => r.count),
    },
    {
      model: 'MessageResource',
      label: 'ressources partagees dans la messagerie',
      count: () => prisma.messageResource.count(),
      purge: () => prisma.messageResource.deleteMany().then((r) => r.count),
    },
    {
      model: 'MessageAttachment',
      label: 'pieces jointes de messages',
      count: () => prisma.messageAttachment.count(),
      purge: () => prisma.messageAttachment.deleteMany().then((r) => r.count),
    },
    {
      model: 'Message',
      label: 'messages',
      count: () => prisma.message.count(),
      purge: () => prisma.message.deleteMany().then((r) => r.count),
    },
    {
      model: 'ConversationParticipant',
      label: 'participants de conversation',
      count: () => prisma.conversationParticipant.count(),
      purge: () => prisma.conversationParticipant.deleteMany().then((r) => r.count),
    },
    {
      model: 'Conversation',
      label: 'conversations',
      count: () => prisma.conversation.count(),
      purge: () => prisma.conversation.deleteMany().then((r) => r.count),
    },

    // -- Les soldes et la repartition ------------------------------------
    {
      model: 'BalanceTransaction',
      label: 'ecritures de solde',
      count: () => prisma.balanceTransaction.count(),
      purge: () => prisma.balanceTransaction.deleteMany().then((r) => r.count),
    },
    {
      model: 'MemberBalance',
      label: 'soldes par membre',
      count: () => prisma.memberBalance.count(),
      purge: () => prisma.memberBalance.deleteMany().then((r) => r.count),
    },
    {
      model: 'DistributionHistory',
      label: 'historique de repartition',
      count: () => prisma.distributionHistory.count(),
      purge: () => prisma.distributionHistory.deleteMany().then((r) => r.count),
    },
    {
      model: 'DistributionItem',
      label: 'ventilations de repartition',
      count: () => prisma.distributionItem.count(),
      purge: () => prisma.distributionItem.deleteMany().then((r) => r.count),
    },
    {
      model: 'ProjectDistribution',
      label: 'repartitions appliquees aux projets',
      count: () => prisma.projectDistribution.count(),
      purge: () => prisma.projectDistribution.deleteMany().then((r) => r.count),
    },
    {
      model: 'DistributionBeneficiary',
      label: 'beneficiaires de repartition',
      count: () => prisma.distributionBeneficiary.count(),
      purge: () => prisma.distributionBeneficiary.deleteMany().then((r) => r.count),
    },
    {
      model: 'DistributionConfig',
      label: 'regles de repartition',
      count: () => prisma.distributionConfig.count(),
      purge: () => prisma.distributionConfig.deleteMany().then((r) => r.count),
    },

    // -- Les objectifs, l'agenda, les rapports ---------------------------
    {
      model: 'GoalTask',
      label: 'liens objectif-tache',
      count: () => prisma.goalTask.count(),
      purge: () => prisma.goalTask.deleteMany().then((r) => r.count),
    },
    {
      model: 'Goal',
      label: 'objectifs',
      count: () => prisma.goal.count(),
      purge: () => prisma.goal.deleteMany().then((r) => r.count),
    },
    {
      model: 'CalendarEventParticipant',
      label: "participants d'evenement",
      count: () => prisma.calendarEventParticipant.count(),
      purge: () => prisma.calendarEventParticipant.deleteMany().then((r) => r.count),
    },
    {
      model: 'CalendarEvent',
      label: "evenements d'agenda",
      count: () => prisma.calendarEvent.count(),
      purge: () => prisma.calendarEvent.deleteMany().then((r) => r.count),
    },
    {
      model: 'Report',
      label: 'rapports generes',
      count: () => prisma.report.count(),
      purge: () => prisma.report.deleteMany().then((r) => r.count),
    },
    {
      model: 'DailyReport',
      label: 'rapports journaliers',
      count: () => prisma.dailyReport.count(),
      purge: () => prisma.dailyReport.deleteMany().then((r) => r.count),
    },

    // -- Le temps passe ---------------------------------------------------
    {
      model: 'TimerSession',
      label: 'sessions de minuteur',
      count: () => prisma.timerSession.count(),
      purge: () => prisma.timerSession.deleteMany().then((r) => r.count),
    },
    {
      model: 'TimeEntry',
      label: 'saisies de temps',
      count: () => prisma.timeEntry.count(),
      purge: () => prisma.timeEntry.deleteMany().then((r) => r.count),
    },

    // -- Les documents -----------------------------------------------------
    // `documents` reference clients, projets, taches, devis et factures, mais
    // par des colonnes `SET NULL` : la suppression aurait fonctionne meme
    // sans cette etape. Elle est explicite pour que le compte rendu soit
    // exact — et parce que le FICHIER reste dans le stockage objet, ce que le
    // compte rendu doit rappeler.
    {
      model: 'Document',
      label: 'documents (les fichiers restent dans le stockage)',
      count: () => prisma.document.count(),
      purge: () => prisma.document.deleteMany().then((r) => r.count),
    },

    // -- La facturation : le coeur de la demande --------------------------
    // L'ORDRE EST IMPOSE : `payments.invoiceId` est en `RESTRICT`, donc les
    // paiements partent avant les factures ; les articles partaient avec leur
    // facture (`CASCADE`), mais ils sont supprimes explicitement pour le
    // compte rendu.
    {
      model: 'Payment',
      label: 'paiements',
      count: () => prisma.payment.count(),
      purge: () => prisma.payment.deleteMany().then((r) => r.count),
    },
    {
      model: 'InvoiceItem',
      label: 'lignes de facture',
      count: () => prisma.invoiceItem.count(),
      purge: () => prisma.invoiceItem.deleteMany().then((r) => r.count),
    },
    {
      model: 'Invoice',
      label: 'FACTURES',
      count: () => prisma.invoice.count(),
      purge: () => prisma.invoice.deleteMany().then((r) => r.count),
    },
    {
      model: 'QuoteItem',
      label: 'lignes de devis',
      count: () => prisma.quoteItem.count(),
      purge: () => prisma.quoteItem.deleteMany().then((r) => r.count),
    },
    {
      model: 'Quote',
      label: 'DEVIS',
      count: () => prisma.quote.count(),
      purge: () => prisma.quote.deleteMany().then((r) => r.count),
    },

    // -- Les commandes et les demandes -------------------------------------
    {
      model: 'Order',
      label: 'commandes',
      count: () => prisma.order.count(),
      purge: () => prisma.order.deleteMany().then((r) => r.count),
    },
    {
      model: 'ProjectRequest',
      label: 'demandes de projet',
      count: () => prisma.projectRequest.count(),
      purge: () => prisma.projectRequest.deleteMany().then((r) => r.count),
    },
    {
      model: 'ContactRequest',
      label: 'demandes de contact (formulaire public)',
      count: () => prisma.contactRequest.count(),
      purge: () => prisma.contactRequest.deleteMany().then((r) => r.count),
    },
    {
      model: 'ModificationRequest',
      label: 'demandes de modification',
      count: () => prisma.modificationRequest.count(),
      purge: () => prisma.modificationRequest.deleteMany().then((r) => r.count),
    },

    // -- Les clients et le pipeline commercial -----------------------------
    {
      model: 'Contact',
      label: 'interlocuteurs clients',
      count: () => prisma.contact.count(),
      purge: () => prisma.contact.deleteMany().then((r) => r.count),
    },
    {
      model: 'LeadStatusHistory',
      label: 'historique des etapes de prospect',
      count: () => prisma.leadStatusHistory.count(),
      purge: () => prisma.leadStatusHistory.deleteMany().then((r) => r.count),
    },

    // -- Les projets et les taches -----------------------------------------
    {
      model: 'Milestone',
      label: 'jalons',
      count: () => prisma.milestone.count(),
      purge: () => prisma.milestone.deleteMany().then((r) => r.count),
    },
    {
      model: 'Task',
      label: 'taches',
      count: () => prisma.task.count(),
      // `tasks.parentTaskId` est la SEULE contrainte `ON DELETE NO ACTION` du
      // schema : une tache parente ne peut pas disparaitre avant sa fille.
      // La suppression se fait donc en DEUX passes — les taches qui ont un
      // parent d'abord, les racines ensuite. Une seule passe suffirait
      // (PostgreSQL verifie la contrainte en fin d'instruction), mais deux
      // passes ne dependent d'aucun detail du moteur.
      purge: async () => {
        const enfants = await prisma.task.deleteMany({
          where: { parentTaskId: { not: null } },
        });
        const racines = await prisma.task.deleteMany({ where: { parentTaskId: null } });
        return enfants.count + racines.count;
      },
    },
    {
      model: 'ProjectMember',
      label: 'membres de projet',
      count: () => prisma.projectMember.count(),
      purge: () => prisma.projectMember.deleteMany().then((r) => r.count),
    },
    {
      model: 'Project',
      label: 'projets',
      count: () => prisma.project.count(),
      purge: () => prisma.project.deleteMany().then((r) => r.count),
    },

    // -- Le pipeline commercial ---------------------------------------------
    {
      model: 'Prospect',
      label: 'PROSPECTS',
      count: () => prisma.prospect.count(),
      purge: () => prisma.prospect.deleteMany().then((r) => r.count),
    },
    {
      model: 'Client',
      label: 'CLIENTS',
      count: () => prisma.client.count(),
      purge: () => prisma.client.deleteMany().then((r) => r.count),
    },
  ];
}

async function main(): Promise<void> {
  const host = hostOf(databaseUrl);
  const plan = buildPlan();

  console.log('');
  console.log('  PURGE DES DONNEES METIER');
  console.log('  ========================');
  console.log(`  Base   : ${host}`);
  console.log(
    `  Mode   : ${confirmed ? 'SUPPRESSION EFFECTIVE' : 'simulation (rien ne sera supprime)'}`,
  );
  console.log('');

  // --- Le plan, compte avant coup -----------------------------------------
  const counts = await Promise.all(plan.map((step) => step.count()));

  const rows: Array<[string, string, number]> = plan.map((step, i) => [
    step.model,
    step.label,
    counts[i] as number,
  ]);

  const largeur = Math.max(...rows.map((r) => r[1].length));
  let total = 0;
  for (const [model, label, n] of rows) {
    total += n;
    const ligne = `  ${String(n).padStart(6)}  ${label.padEnd(largeur)}  (${model})`;
    console.log(n === 0 ? ligne.replace(/^\s+(\d+)/, '       -') : ligne);
  }
  console.log('');

  // --- Ce qui survit -------------------------------------------------------
  const users = await prisma.user.count();
  const roles = await prisma.role.count();
  const currencies = await prisma.currency.count();
  const packages = await prisma.package.count();
  console.log('  Ce qui survit (structure du produit) :');
  console.log(
    `    ${users} compte(s) — AUCUN n'est supprime, ${roles} role(s), ${currencies} devise(s), ${packages} pack(s)`,
  );
  console.log('    permissions, parametres, taux de change, services, contenu public, compteurs');
  console.log('');

  if (total === 0) {
    console.log('  Rien a supprimer : la base ne contient aucune donnee metier.');
    console.log('');
    return;
  }

  if (!confirmed) {
    console.log("  SIMULATION — aucune ligne n'a ete supprimee.");
    console.log('  Pour supprimer : npm run db:purge -- --yes');
    console.log('');
    return;
  }

  // --- La suppression effective -------------------------------------------
  console.log('  Suppression en cours...');
  console.log('');

  for (const step of plan) {
    const n = await step.purge();
    if (n > 0) console.log(`  ${String(n).padStart(6)}  ${step.label}`);
  }

  // La numerotation repart de zero : plus aucun document n'existe.
  if (resetCounters) {
    const n = await prisma.counter.updateMany({ where: {}, data: { value: 0 } });
    console.log(`  ${String(n.count).padStart(6)}  compteurs remis a zero`);
  }

  console.log('');
  console.log('  Purge terminee.');
  console.log('');
  console.log('  RAPPEL : les FICHIERS des documents supprimes sont encore dans le');
  console.log("  stockage objet. La base est propre ; le bucket ne l'est pas.");
  console.log('');
  console.log('  Les COMPTES sont conserves. Ceux qui etaient rattaches a un client');
  console.log('  sont maintenant sans dossier : npm run db:seed recree le client');
  console.log('  et rattache les comptes existants.');
  console.log('');
}

main()
  .catch((error: unknown) => {
    console.error('');
    console.error('  PURGE INTERROMPUE.');
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    console.error('');
    console.error("  La suppression se fait table par table et n'est PAS transactionnelle :");
    console.error("  en cas d'erreur, la base peut etre a moitie purgee. Relancez le script.");
    console.error('');
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
