import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, ValidationPipe, type Type } from '@nestjs/common';
import { UpsertExchangeRateDto, ConvertAmountQueryDto } from '../../modules/exchange-rates/dto/exchange-rate.dto.js';
import { AdjustBalanceDto } from '../../modules/balances/dto/balance.dto.js';
import { CreateBeneficiaryDto } from '../../modules/distributions/dto/distribution.dto.js';

/**
 * LES MONTANTS DES TROIS MODULES FINANCIERS, MESURES SUR LE PIPE REEL.
 * ---------------------------------------------------------------------------
 * CE QUE CE FICHIER PROUVE, ET RIEN D'AUTRE
 *
 * Qu'un montant accepté par l'API est bien un nombre, et qu'un montant refuse
 * l'est avec un 400 lisible — jamais avec un 500. Ce fichier existe parce que
 * les trois DTO portaient `@IsDecimal({ decimal_digits: '19,6' })`,
 * `'14,2'` et `'5,2'`, c'est-a-dire la precision Prisma de la colonne
 * (`@db.Decimal(19, 6)`).
 *
 * Or `class-validator` ne comprend pas une precision Prisma. La bibliotheque
 * `validator` insere `decimal_digits` TEL QUEL dans une expression reguliere :
 * `'19,6'` produit `[0-9]{19,6}`, dont la borne inferieure depasse la borne
 * superieure. Le constructeur de `RegExp` leve alors
 *
 *     Invalid regular expression: /…[0-9]{19,6}…/: numbers out of order in {} quantifier
 *
 * et la route repond 500 `INTERNAL_ERROR`. Le symptôme ne ressemble a rien : ni
 * une erreur de validation, ni une erreur metier. Aucune compilation ne le
 * signale — le decorateur est bien typé — et aucun test de service ne peut le
 * voir, puisque l'erreur nait dans le validateur, avant le service.
 *
 * `decimal_digits` attend « chiffres apres la virgule, sous la forme `min,max` ».
 * `@db.Decimal(p, s)` se traduit donc par `'1,s'`. La correction est mesuree
 * ici : chaque ligne du tableau passe par le pipe, et une regex invalide
 * ferait echouer le test par une exception, pas par une assertion.
 *
 * ---------------------------------------------------------------------------
 * CE FICHIER N'EST PAS
 * ---------------------------------------------------------------------------
 * Ce n'est pas un test des regles metier (arrondis, conversions, repartitions) :
 * aucun service, aucune base. C'est le CONTRAT D'ENTREE, verifie avec le meme
 * `ValidationPipe` que l'application.
 */

/**
 * Les options du pipe global, RECOPIEES de `configureApp`.
 *
 * `src/app.setup.ts` les construit en ligne et ne les exporte pas ; la recopie
 * est donc assumee, et ses trois drapeaux sont les memes que ceux que la sonde
 * HTTP a mesures (`pirate` refuse en 400 `VALIDATION_FAILED`).
 */
function appValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
}

/** Soumet un corps au pipe, et rend ce que le pipe accepte. */
async function accept<T>(metatype: Type<T>, body: unknown): Promise<T> {
  return appValidationPipe().transform(body, {
    type: 'body',
    metatype,
    data: '',
  } as never) as Promise<T>;
}

/** Soumet un corps au pipe, et rend l'exception quand il refuse. */
async function reject<T>(metatype: Type<T>, body: unknown): Promise<BadRequestException> {
  try {
    await accept(metatype, body);
  } catch (error) {
    assert.ok(error instanceof BadRequestException, `attendu BadRequestException, reçu ${String(error)}`);
    return error;
  }
  throw new Error('le pipe aura dû refuser ce corps');
}

describe('UpsertExchangeRateDto — le taux', () => {
  const base = {
    fromCurrency: 'DZD',
    toCurrency: 'EUR',
    source: "Banque d'Algérie",
  };

  it('accepte un taux a six decimales, comme la colonne le permet', async () => {
    // `Decimal(19, 6)` : l'echelle est 6.
    const dto = await accept(UpsertExchangeRateDto, { ...base, rate: '0.006843' });

    assert.equal(dto.rate, '0.006843');
  });

  it('accepte un taux entier, sans partie decimale', async () => {
    const dto = await accept(UpsertExchangeRateDto, { ...base, rate: '1' });

    assert.equal(dto.rate, '1');
  });

  it('refuse un taux a sept decimales', async () => {
    await reject(UpsertExchangeRateDto, { ...base, rate: '0.0068432' });
  });

  it('refuse un taux qui n’est pas un nombre', async () => {
    await reject(UpsertExchangeRateDto, { ...base, rate: 'environ zero virgule' });
  });

  it('refuse un corps sans source : la tracabilite du taux est obligatoire', async () => {
    await reject(UpsertExchangeRateDto, { fromCurrency: 'DZD', toCurrency: 'EUR', rate: '0.0068' });
  });
});

describe('ConvertAmountQueryDto — le montant a convertir', () => {
  it('accepte un montant entier', async () => {
    const dto = await accept(ConvertAmountQueryDto, { amount: '10000', from: 'DZD', to: 'EUR' });

    assert.equal(dto.amount, '10000');
  });

  it('accepte un montant decimal', async () => {
    const dto = await accept(ConvertAmountQueryDto, { amount: '1250.75', from: 'DZD', to: 'EUR' });

    assert.equal(dto.amount, '1250.75');
  });

  it('refuse un montant qui n’est pas un nombre', async () => {
    await reject(ConvertAmountQueryDto, { amount: 'beaucoup', from: 'DZD', to: 'EUR' });
  });
});

describe('AdjustBalanceDto — l’ajustement de solde', () => {
  const base = { userId: 'u-1', currency: 'DZD', description: 'Correction manuelle' };

  it('accepte un montant negatif : un debit est un ajustement legitime', async () => {
    const dto = await accept(AdjustBalanceDto, { ...base, amount: '-1500.50' });

    assert.equal(dto.amount, '-1500.50');
  });

  it('accepte un montant entier', async () => {
    const dto = await accept(AdjustBalanceDto, { ...base, amount: '2000' });

    assert.equal(dto.amount, '2000');
  });

  it('refuse un montant a trois decimales, au-dela de l’echelle de la colonne', async () => {
    // `Decimal(14, 2)` : deux decimales.
    await reject(AdjustBalanceDto, { ...base, amount: '1500.505' });
  });
});

describe('CreateBeneficiaryDto — les pourcentages de répartition', () => {
  const base = { beneficiaryType: 'MEMBER', name: 'Younes', order: 1 };

  it('accepte un pourcentage a deux decimales', async () => {
    // `Decimal(5, 2)` : l'echelle est 2.
    const dto = await accept(CreateBeneficiaryDto, { ...base, percentage: '33.33' });

    assert.equal(dto.percentage, '33.33');
  });

  it('accepte un pourcentage entier', async () => {
    const dto = await accept(CreateBeneficiaryDto, { ...base, percentage: '40' });

    assert.equal(dto.percentage, '40');
  });

  it('refuse un pourcentage a trois decimales', async () => {
    await reject(CreateBeneficiaryDto, { ...base, percentage: '33.333' });
  });

  it('refuse un pourcentage qui n’est pas un nombre', async () => {
    await reject(CreateBeneficiaryDto, { ...base, percentage: 'un tiers' });
  });
});
