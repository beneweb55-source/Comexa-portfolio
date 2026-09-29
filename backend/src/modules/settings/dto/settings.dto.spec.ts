import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SettingsQueryDto, UpdateSettingsDto } from './settings.dto.js';

/**
 * Tests du CONTRAT des parametres.
 *
 * On ne teste pas ici la logique metier mais la porte d'entree, avec le MEME
 * `ValidationPipe` que l'application (`whitelist`, `forbidNonWhitelisted`,
 * `transform`). C'est le seul endroit ou l'on peut verifier deux choses qui
 * conditionnent la securite du module :
 *
 *  - un champ non declare est REFUSE, donc la liste des champs modifiables est
 *    exactement celle du DTO — pas celle qu'un appelant decide d'envoyer ;
 *  - une valeur JSON libre traverse la validation SANS etre rognee, sinon un
 *    parametre objet arriverait incomplet en base.
 */

function appPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
}

async function validateBody(payload: unknown): Promise<UpdateSettingsDto> {
  return (await appPipe().transform(payload, {
    type: 'body',
    metatype: UpdateSettingsDto,
  })) as UpdateSettingsDto;
}

async function validateQuery(payload: unknown): Promise<SettingsQueryDto> {
  return (await appPipe().transform(payload, {
    type: 'query',
    metatype: SettingsQueryDto,
  })) as SettingsQueryDto;
}

describe('UpdateSettingsDto — la porte d entree', () => {
  it('accepte un lot valide', async () => {
    const dto = await validateBody({
      settings: [{ key: 'company.name', value: 'Comexa' }],
    });

    assert.equal(dto.settings.length, 1);
    assert.equal(dto.settings[0]?.key, 'company.name');
    assert.equal(dto.settings[0]?.value, 'Comexa');
  });

  it('laisse intacte une valeur JSON imbriquee', async () => {
    // Le point a prouver : la valeur libre n'est ni rognee par `whitelist`, ni
    // convertie par `transform`. Sans cela, un parametre objet perdrait ses
    // cles en silence entre le formulaire et la base.
    const value = { niveaux: [1, 2, { actif: true }], libelle: 'x' };

    const dto = await validateBody({ settings: [{ key: 'ui.theme', value }] });

    assert.deepEqual(dto.settings[0]?.value, value);
  });

  it('refuse un champ non declare sur un parametre', async () => {
    // Le scenario hostile : ajouter un champ au corps en esperant qu'il soit
    // ecrit. `forbidNonWhitelisted` arrete la requete avant le service.
    await assert.rejects(
      () => validateBody({ settings: [{ key: 'company.name', value: 'x', clientId: 'cli_1' }] }),
      BadRequestException,
    );
  });

  it('refuse une cle en majuscules ou mal formee', async () => {
    for (const key of ['Company.Name', 'company..name', 'company name', '']) {
      await assert.rejects(() => validateBody({ settings: [{ key, value: 'x' }] }), BadRequestException, key);
    }
  });

  it('refuse un parametre sans valeur et un lot vide', async () => {
    await assert.rejects(() => validateBody({ settings: [{ key: 'company.name' }] }), BadRequestException);
    await assert.rejects(() => validateBody({ settings: [] }), BadRequestException);
    await assert.rejects(() => validateBody({}), BadRequestException);
  });

  it('accepte les valeurs fausses et nulles, qui sont des valeurs', async () => {
    // `false` et `0` sont des valeurs legitimes : les confondre avec « absent »
    // ferait echouer l'enregistrement d'une case a cocher decochee.
    const dto = await validateBody({
      settings: [
        { key: 'notifications.email.enabled', value: false },
        { key: 'invoice.payment_terms_days', value: 0 },
      ],
    });

    assert.equal(dto.settings[0]?.value, false);
    assert.equal(dto.settings[1]?.value, 0);
  });
});

describe('SettingsQueryDto — includeInternal', () => {
  it('interprete les booleens textuels dans le bon sens', async () => {
    // Piege connu : avec la conversion implicite, `Boolean('false')` vaut vrai.
    // Le formulaire afficherait les parametres internes a qui demandait a ne pas
    // les voir.
    assert.equal((await validateQuery({ includeInternal: 'true' })).includeInternal, true);
    assert.equal((await validateQuery({ includeInternal: 'false' })).includeInternal, false);
    assert.equal((await validateQuery({ includeInternal: true })).includeInternal, true);
    assert.equal((await validateQuery({})).includeInternal, undefined);
  });

  it('refuse une valeur qui n est pas booleenne', async () => {
    await assert.rejects(() => validateQuery({ includeInternal: 'maybe' }), BadRequestException);
    await assert.rejects(() => validateQuery({ includeInternal: '1' }), BadRequestException);
  });

  it('refuse un parametre inconnu', async () => {
    await assert.rejects(() => validateQuery({ clientId: 'cli_1' }), BadRequestException);
  });
});
