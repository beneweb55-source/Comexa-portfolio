import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { BadRequestException, ValidationPipe, type Type } from '@nestjs/common';
import { Transform, Type as TypeDecorator } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { ListDocumentsQueryDto } from '../../modules/documents/dto/documents.dto.js';
import { UpdateContactDto, CreateContactDto } from '../../modules/clients/dto/client.dto.js';
import {
  ContentListQueryDto,
  CreateCaseStudyCategoryDto,
  CreateCaseStudyDto,
  CreateFaqDto,
  CreatePackageDto,
  CreatePartnerDto,
  CreateServiceDto,
  ModerateContentDto,
  UpdateCaseStudyCategoryDto,
  UpdateCaseStudyDto,
  UpdateFaqDto,
  UpdatePackageDto,
  UpdatePartnerDto,
  UpdateServiceDto,
} from '../../modules/content/dto/content.dto.js';
import {
  ListConversationsQueryDto,
  UpdateConversationDto,
} from '../../modules/messaging/dto/messaging.dto.js';
import { ListNotificationsQueryDto } from '../../modules/notifications/dto/notification.dto.js';
import { SettingsQueryDto } from '../../modules/settings/dto/settings.dto.js';
import {
  CreateTaskDto,
  TaskQueryDto,
  UpdateTaskDto,
} from '../../modules/tasks/dto/task.dto.js';
import {
  CreateTimeEntryDto,
  TimeEntryQueryDto,
  UpdateTimeEntryDto,
} from '../../modules/time-entries/dto/time-entry.dto.js';

/**
 * LE FILTRE BOOLEEN D'URL, MESURE SUR LE PIPE REEL.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE FICHIER PROUVE
 * ---------------------------------------------------------------------------
 * Avec `enableImplicitConversion` (voir `src/app.setup.ts`), class-transformer
 * convertit une valeur AVANT d'appliquer les `@Transform` du DTO, en se fiant a
 * la metadonnee `design:type` emise par `tsc`. Sur une propriete declaree
 * `boolean`, cette conversion est `Boolean(value)` — et `Boolean('false')` vaut
 * `true`. Un `@Transform` ecrit naivement ne voit donc JAMAIS la chaine : il
 * recoit deja un booleen faux. Le filtre est INVERSE, silencieusement.
 *
 * La table ci-dessous est la mesure. Elle est la meme pour les sept filtres de
 * requete et pour les vingt-quatre booleens de corps de l'API :
 *
 *     entree          attendu     obtenu sans correctif
 *     'false'         false       true      <-- l'inverse de la demande
 *     'true'          true        true
 *     ''              false       false
 *     false (JSON)    false       false
 *     true  (JSON)    true        true
 *     absent          undefined   undefined
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE FICHIER INJECTE LA METADONNEE `design:type`
 * ---------------------------------------------------------------------------
 * La suite unite tourne sous `tsx`, qui s'appuie sur esbuild. Or esbuild
 * n'emet PAS `emitDecoratorMetadata` : mesure faite, sous `tsx`
 * `Reflect.getMetadata('design:type', Dto.prototype, 'champ')` vaut `undefined`,
 * alors qu'apres `tsc` (voir `tsconfig.e2e.json`, qui documente le meme ecart
 * sur `design:paramtypes`) la meme lecture vaut `Boolean`.
 *
 * Sans metadonnee, la branche de conversion implicite de
 * `TransformOperationExecutor.transform` n'est jamais prise, le `@Transform`
 * recoit la chaine brute — et le bogue devient INVISIBLE en test. C'est
 * exactement pourquoi il a survecu : `npm test` ne pouvait pas le voir.
 *
 * Ce fichier remet donc la metadonnee que la PRODUCTION a, pour que la mesure
 * porte sur le comportement deploye et non sur celui de `tsx`. Le bloc
 * « le montage reproduit bien la production » verifie ce point de depart : sans
 * lui, tout ce fichier ne prouverait rien.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE FICHIER N'EST PAS
 * ---------------------------------------------------------------------------
 * Ce n'est pas un test de la logique metier, ni un test de bout en bout : aucun
 * service, aucune base. C'est le CONTRAT D'ENTREE, verifie avec le meme
 * `ValidationPipe` que l'application (memes options que `src/app.setup.ts`,
 * reproduites ci-dessous et surveillees par le test de derive en fin de
 * fichier).
 */

/**
 * Les options du pipe global, RECOPIEES de `configureApp`.
 *
 * `src/app.setup.ts` les construit en ligne dans le corps de la fonction et ne
 * les exporte pas ; on ne peut donc pas les importer, et ce fichier ne doit pas
 * modifier `app.setup.ts`. La recopie est donc surveillee : le dernier `describe`
 * relit la source et echoue si l'un des trois drapeaux ou la conversion
 * implicite disparait. Une recopie non surveillee derive toujours.
 */
function appValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
}

/** Une entree soumise au pipe, et son etiquette dans la table de verite. */
interface BooleanInput {
  readonly label: string;
  readonly value: unknown;
}

const INPUTS: readonly BooleanInput[] = [
  { label: "chaine 'false'", value: 'false' },
  { label: "chaine 'true'", value: 'true' },
  { label: 'chaine vide', value: '' },
  { label: 'booleen false', value: false },
  { label: 'booleen true', value: true },
  { label: 'absent', value: undefined },
];

/** La table attendue. C'est le contrat, et c'est tout l'enjeu du fichier. */
const ATTENDU: Readonly<Record<string, unknown>> = {
  "chaine 'false'": false,
  "chaine 'true'": true,
  'chaine vide': false,
  'booleen false': false,
  'booleen true': true,
  absent: undefined,
};

/** Entree `REJET` : la valeur est refusee par le validateur. */
const REJET = 'REJET(BadRequestException)' as const;

/** Un champ obligatoire ne peut pas etre absent : `{}` doit etre refuse. */
const ATTENDU_OBLIGATOIRE: Readonly<Record<string, unknown>> = {
  ...ATTENDU,
  absent: REJET,
};

interface BooleanCase {
  readonly kind: 'query' | 'body';
  readonly metatype: Type<unknown>;
  readonly property: string;
  /** Champs obligatoires du DTO, pour que la validation ne porte que sur le booleen. */
  readonly base?: Readonly<Record<string, unknown>>;
  /** Le champ est declare obligatoire (`!:`), donc `@IsOptional()` n'a pas sa place. */
  readonly required?: boolean;
}

/**
 * L'INVENTAIRE. Chaque propriete booleenne d'un DTO d'entree de `src/` figure
 * ici, avec son origine : `query` quand la valeur vient d'une chaine d'URL,
 * `body` quand elle vient d'un corps JSON.
 *
 * Un DTO absent de cette table est un DTO sans booleen : `contact-request`,
 * `modification-request`, `prospect`, `auth`, `audit`, `dashboard`, `invoice`,
 * `milestone`, `payment`, `project`, `quote` (hors interface de reponse), `role`,
 * `report` et `user` n'en declarent aucun.
 */
const CASES: readonly BooleanCase[] = [
  // --- Filtres de CHAINE DE REQUETE (les plus exposes) ----------------------
  { kind: 'query', metatype: ListNotificationsQueryDto, property: 'read' },
  { kind: 'query', metatype: ListDocumentsQueryDto, property: 'includeExpired' },
  { kind: 'query', metatype: ListConversationsQueryDto, property: 'includeArchived' },
  { kind: 'query', metatype: SettingsQueryDto, property: 'includeInternal' },
  { kind: 'query', metatype: TaskQueryDto, property: 'rootOnly' },
  { kind: 'query', metatype: TimeEntryQueryDto, property: 'billable' },
  { kind: 'query', metatype: ContentListQueryDto, property: 'active' },

  // --- Corps JSON ----------------------------------------------------------
  { kind: 'body', metatype: UpdateConversationDto, property: 'isArchived' },
  { kind: 'body', metatype: ModerateContentDto, property: 'isPublished', required: true },

  { kind: 'body', metatype: CreateServiceDto, property: 'isActive', base: { title: 'Aa', shortDescription: 'Aa' } },
  { kind: 'body', metatype: CreateServiceDto, property: 'isFeatured', base: { title: 'Aa', shortDescription: 'Aa' } },
  { kind: 'body', metatype: UpdateServiceDto, property: 'isActive' },
  { kind: 'body', metatype: UpdateServiceDto, property: 'isFeatured' },

  { kind: 'body', metatype: CreatePackageDto, property: 'isActive', base: { name: 'Aa' } },
  { kind: 'body', metatype: CreatePackageDto, property: 'isFeatured', base: { name: 'Aa' } },
  { kind: 'body', metatype: UpdatePackageDto, property: 'isActive' },
  { kind: 'body', metatype: UpdatePackageDto, property: 'isFeatured' },

  { kind: 'body', metatype: CreateCaseStudyCategoryDto, property: 'isActive', base: { name: 'Aa' } },
  { kind: 'body', metatype: UpdateCaseStudyCategoryDto, property: 'isActive' },

  { kind: 'body', metatype: CreateCaseStudyDto, property: 'isFeatured', base: { title: 'Aa', excerpt: 'Aa', content: 'Aa' } },
  { kind: 'body', metatype: UpdateCaseStudyDto, property: 'isFeatured' },

  { kind: 'body', metatype: CreatePartnerDto, property: 'isActive', base: { name: 'Aa' } },
  { kind: 'body', metatype: UpdatePartnerDto, property: 'isActive' },

  { kind: 'body', metatype: CreateFaqDto, property: 'isPublished', base: { question: 'Aaa', answer: 'Aa' } },
  { kind: 'body', metatype: UpdateFaqDto, property: 'isPublished' },

  { kind: 'body', metatype: CreateTaskDto, property: 'isClientVisible', base: { title: 'Aa' } },
  { kind: 'body', metatype: UpdateTaskDto, property: 'isClientVisible' },

  { kind: 'body', metatype: CreateTimeEntryDto, property: 'billable', base: { minutes: 30 } },
  { kind: 'body', metatype: UpdateTimeEntryDto, property: 'billable' },

  { kind: 'body', metatype: CreateContactDto, property: 'isPrimary', base: { firstName: 'Aa', lastName: 'Aa' } },
  { kind: 'body', metatype: UpdateContactDto, property: 'isPrimary' },
];

/**
 * Remet la metadonnee que `emitDecoratorMetadata` produit a la compilation.
 *
 * `Boolean` est bien le `design:type` d'une propriete declaree `boolean` : c'est
 * ce que `tsc` ecrit dans `.e2e-build` et ce que lit class-transformer. La
 * poser ici est donc une restitution, pas un artifice.
 */
function restaurerMetadonneeCompilee(metatype: Type<unknown>, property: string): void {
  Reflect.defineMetadata('design:type', Boolean, metatype.prototype, property);
}

for (const c of CASES) restaurerMetadonneeCompilee(c.metatype, c.property);

/** Fait passer une entree dans le VRAI pipe, et rend la valeur obtenue. */
async function mesure(c: BooleanCase, input: BooleanInput): Promise<unknown> {
  const payload: Record<string, unknown> = { ...(c.base ?? {}) };
  if (input.value !== undefined) payload[c.property] = input.value;

  try {
    const dto = (await appValidationPipe().transform(payload, {
      type: c.kind,
      metatype: c.metatype,
    })) as Record<string, unknown>;
    return dto[c.property];
  } catch (error) {
    if (error instanceof BadRequestException) return REJET;
    throw error;
  }
}

/**
 * Toutes les cibles, dans un seul `describe` : la moitie de ce fichier consiste
 * a montrer que les trente et une proprietes se comportent PAREIL, et un rapport
 * separe par DTO noierait ce fait.
 */
describe('les booleens d entree de l API — table de verite du pipe reel', () => {
  for (const c of CASES) {
    const attendu = c.required === true ? ATTENDU_OBLIGATOIRE : ATTENDU;

    it(`${c.metatype.name}.${c.property} [${c.kind}]`, async () => {
      const obtenu: Record<string, unknown> = {};
      for (const input of INPUTS) obtenu[input.label] = await mesure(c, input);

      assert.deepEqual(obtenu, attendu);
    });
  }
});

/**
 * LE MONTAGE REPRODUIT BIEN LA PRODUCTION.
 *
 * Ce bloc ne teste pas un DTO de l'application : il teste le HARNAIS. Sans lui,
 * tout le reste pourrait passer au vert pour la mauvaise raison — un `@Transform`
 * qui recoit la chaine brute se comporte correctement, et c'est precisement ce
 * que fait `tsx` quand la metadonnee manque.
 *
 * Les deux classes ci-dessous sont identiques a un decorateur pres. La premiere
 * n'a pas de `@Type(() => String)`, la seconde en a un. Avec la metadonnee
 * `design:type = Boolean` que la production porte, la premiere doit rendre
 * `true` pour `'false'` : c'est la definition du bogue. La seconde doit rendre
 * `false` : c'est la definition du correctif.
 */
describe('le montage reproduit bien la production', () => {
  class SansTypeExplicite {
    @IsOptional()
    @Transform(({ value }) => (value === undefined ? undefined : value === true || value === 'true'))
    @IsBoolean()
    flag?: boolean;
  }

  class AvecTypeExplicite {
    @IsOptional()
    @TypeDecorator(() => String)
    @Transform(({ value }) => (value === undefined ? undefined : value === true || value === 'true'))
    @IsBoolean()
    flag?: boolean;
  }

  for (const classe of [SansTypeExplicite, AvecTypeExplicite]) {
    Reflect.defineMetadata('design:type', Boolean, classe.prototype, 'flag');
  }

  it('la metadonnee de type est bien absente sous tsx, et donc injectee ici', () => {
    // Sondage sur une classe temoin NON instrumentee : c'est l'etat que `tsx`
    // laisse derriere lui, et la raison d'etre de `restaurerMetadonneeCompilee`.
    class Temoin {
      @IsOptional()
      @IsBoolean()
      flag?: boolean;
    }

    assert.equal(Reflect.getMetadata('design:type', Temoin.prototype, 'flag'), undefined);
    assert.equal(Reflect.getMetadata('design:type', SansTypeExplicite.prototype, 'flag'), Boolean);
  });

  it('sans @Type(() => String), le filtre est inverse — le bogue est reel', async () => {
    const dto = await appValidationPipe().transform(
      { flag: 'false' },
      { type: 'query', metatype: SansTypeExplicite },
    );

    assert.equal((dto as SansTypeExplicite).flag, true, "Boolean('false') vaut true");
  });

  it('avec @Type(() => String), la chaine arrive intacte au @Transform', async () => {
    const dto = await appValidationPipe().transform(
      { flag: 'false' },
      { type: 'query', metatype: AvecTypeExplicite },
    );

    assert.equal((dto as AvecTypeExplicite).flag, false);
  });
});

/**
 * GARDE DE DERIVE.
 *
 * Le pipe de ce fichier est une RECOPIE, faute d'export dans `app.setup.ts`. Une
 * recopie qui n'est pas surveillee finit par mentir : le jour ou quelqu'un
 * retire `forbidNonWhitelisted` ou `enableImplicitConversion` du vrai pipe, les
 * tests ci-dessus continueraient de passer en testant un pipe qui n'existe plus.
 */
describe('le pipe de test est celui de app.setup.ts', () => {
  const source = readFileSync(new URL('../../app.setup.ts', import.meta.url), 'utf8');

  for (const fragment of [
    'whitelist: true',
    'forbidNonWhitelisted: true',
    'transform: true',
    'transformOptions: { enableImplicitConversion: true }',
  ]) {
    it(`app.setup.ts contient toujours « ${fragment} »`, () => {
      assert.ok(source.includes(fragment), `option disparue de app.setup.ts : ${fragment}`);
    });
  }
});
