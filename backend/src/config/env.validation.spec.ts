// En PREMIER, et volontairement : ce fichier importe une classe decoree, et un
// decorateur applique appelle `Reflect.defineMetadata`. Le polyfill arrive
// aujourd'hui par le graphe d'imports de `class-validator`, donc par effet de
// bord d'un autre paquet. Ce fichier ne veut pas en dependre.
import 'reflect-metadata';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allowsBootWithoutMail, forcesPathStyle, validateEnv } from './env.validation.js';

/**
 * CE QUE CES TESTS PROTEGENT.
 *
 * Deux reglages de ce fichier decident si le processus DEMARRE, et l'un des deux
 * a le pouvoir d'autoriser, en production, un etat degrade :
 *
 *   1. `assertMailConfigured` FERME : une production sans moyen d'envoi refuse
 *      de demarrer, parce qu'un « mot de passe oublie » qui repond 200 sans rien
 *      expedier est un mensonge a l'utilisateur. Ce refus doit continuer de
 *      fonctionner — c'est la raison pour laquelle la derogation est explicite.
 *   2. `ALLOW_BOOT_WITHOUT_MAIL` OUVRERT : elle rend cet etat CHOISI, pour
 *      qu'une absence de fournisseur de courriel n'interdise pas de deployer le
 *      reste du backend.
 *
 * LE PIEGE QUE CE FICHIER EXISTE POUR FIGER. Le champ est une CHAINE, pas un
 * booleen, parce que `validateEnv` s'execute avec `enableImplicitConversion`, ou
 * la chaine `'false'` devient `true` — l'inverse exact de la demande. C'est le
 * meme piege qui a impose le meme choix a `TRUST_PROXY` (voir
 * `common/http/client-ip.ts`). Un champ booleen ici ouvrirait la derogation sur
 * un deploiement qui a pourtant ecrit « false » : le test « la chaine false ne
 * doit jamais devenir vraie » est donc la piece centrale de ce fichier.
 *
 * UN TROISIEME REGLAGE EST ARRIVE ICI SANS DECIDER DU DEMARRAGE, et c'est
 * volontaire : `S3_FORCE_PATH_STYLE` (voir `forcesPathStyle`) n'est pas lu par
 * `validateEnv` mais par `resolveStorageConfig()` dans `storage.module.ts`. Il
 * figure dans ce fichier parce qu'il partage le meme piege que les deux autres —
 * la chaine `'false'` — et le meme contrat de lecture : une valeur NON RECONNUE
 * LEVE, au lieu de retomber sur un defaut.
 *
 * Aucun appel reseau, aucun acces a la base : `validateEnv` ne lit que l'objet
 * qu'on lui donne.
 */

/**
 * Valeurs minimales qui passent la validation, hors sujet du test.
 *
 * Les deux secrets font exactement 32 caracteres (`MinLength(32)`) et sont
 * DIFFERENTS : `assertSecretsDiffer` refuse deux secrets identiques, et un jeu
 * d'essai qui les confondrait ferait echouer tous les tests pour une raison sans
 * rapport avec ce qu'ils verifient.
 */
function baseEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://utilisateur:motdepasse@localhost:5432/comexa',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    ...overrides,
  };
}

describe('allowsBootWithoutMail — lecture de la derogation', () => {
  it('vaut FAUX quand la variable est absente ou vide', () => {
    // Le defaut doit etre « non » : un `.env` qui porte `ALLOW_BOOT_WITHOUT_MAIL=`
    // sans valeur ne doit pas ouvrir la derogation.
    for (const raw of [undefined, '', '   ']) {
      assert.equal(allowsBootWithoutMail(raw), false, `« ${String(raw)} » devrait valoir false`);
    }
  });

  it('vaut FAUX pour les orthographes negatives', () => {
    for (const raw of ['false', 'FALSE', ' false ', '0', 'no', 'off', 'No', 'OFF']) {
      assert.equal(allowsBootWithoutMail(raw), false, `« ${raw} » devrait valoir false`);
    }
  });

  it('vaut VRAI pour les orthographes positives', () => {
    for (const raw of ['true', 'TRUE', ' true ', '1', 'yes', 'on', 'Yes', 'ON']) {
      assert.equal(allowsBootWithoutMail(raw), true, `« ${raw} » devrait valoir true`);
    }
  });

  it('LE PIEGE : la chaine « false » ne doit jamais devenir vraie', () => {
    // Si le champ etait declare booleen, `enableImplicitConversion` le lirait
    // comme `true` — la derogation s'ouvrirait sur un deploiement qui l'a
    // explicitement fermee. C'est exactement ce que le `@IsString()` empeche, et
    // c'est la raison d'etre de cette fonction.
    assert.equal(allowsBootWithoutMail('false'), false);
    // Rappel du mecanisme, pour que l'intention reste lisible :
    assert.equal(Boolean('false'), true, 'une chaine non vide est vraie en JavaScript');
  });

  it('REFUSE une valeur non booleenne, en la nommant', () => {
    // Un repli silencieux serait ici trompeur : quelqu'un qui ecrit « oui » a
    // l'intention d'ouvrir la derogation, et s'il obtenait `false` sans un mot,
    // il verrait le serveur refuser de demarrer en cherchant la panne partout
    // sauf dans la variable qu'il vient de poser.
    for (const raw of ['oui', 'vrai', 'TRUE!', '2', 'enabled', '-1', 'peut-etre']) {
      assert.throws(
        () => allowsBootWithoutMail(raw),
        (error: unknown) => {
          assert.ok(error instanceof Error, `Error attendue pour « ${raw} »`);
          assert.match(error.message, /ALLOW_BOOT_WITHOUT_MAIL/);
          assert.ok(
            error.message.includes(raw),
            `le message doit citer la valeur fautive : ${error.message}`,
          );
          return true;
        },
        `« ${raw} » aurait du etre refuse`,
      );
    }
  });
});

describe("forcesPathStyle — lecture de l'adressage S3", () => {
  it('vaut VRAI quand la variable est absente ou vide, comme le defaut declare', () => {
    // Une variable absente vaut `true` : c'est le defaut de la declaration dans
    // `env.validation.ts`, et la forme d'adressage qui fonctionne sur la
    // quasi-totalite des stockages compatibles. Un `.env` qui ecrit
    // `S3_FORCE_PATH_STYLE=false`, lui, reste faux — c'est le cas AWS, teste plus
    // bas.
    for (const raw of [undefined, '', '   ']) {
      assert.equal(forcesPathStyle(raw), true, `« ${String(raw)} » devrait valoir true`);
    }
  });

  it('vaut VRAI pour les orthographes positives', () => {
    for (const raw of ['true', 'TRUE', ' true ', '1', 'yes', 'on', 'Yes', 'ON']) {
      assert.equal(forcesPathStyle(raw), true, `« ${raw} » devrait valoir true`);
    }
  });

  it('vaut FAUX pour les orthographes negatives', () => {
    // Le cas qui compte reellement en production : un stockage adresse par
    // sous-domaine (AWS). Un repli silencieux sur le defaut `true` y produirait
    // des URL signees que le service refuse, et l'echec apparaitrait cote
    // navigateur, tres loin de la variable fautive.
    for (const raw of ['false', 'FALSE', ' false ', '0', 'no', 'off', 'No', 'OFF']) {
      assert.equal(forcesPathStyle(raw), false, `« ${raw} » devrait valoir false`);
    }
  });

  it('LE PIEGE : la chaine « false » ne doit jamais devenir vraie', () => {
    // Meme mecanisme que pour `ALLOW_BOOT_WITHOUT_MAIL`, et meme raison d'etre :
    // le champ est declare comme CHAINE, donc il traverse
    // `enableImplicitConversion` sans devenir un booleen. Declare booleen, il
    // aurait ete lu `true` sur un `.env` qui ecrit pourtant `false`.
    assert.equal(forcesPathStyle('false'), false);
    assert.equal(Boolean('false'), true, 'une chaine non vide est vraie en JavaScript');
  });

  it('REFUSE une valeur non booleenne, en la nommant', () => {
    // Le repli silencieux est precisement ce que ce parseur remplace : avant, un
    // « oui » ou un « vrai » etait lu comme le defaut, sans un mot, et les liens
    // signes sortaient dans la mauvaise forme. Le message doit donc citer la
    // valeur fautive, sinon l'exploitant ne sait pas laquelle corriger.
    for (const raw of ['oui', 'vrai', 'TRUE!', '2', 'enabled', '-1', 'chemin']) {
      assert.throws(
        () => forcesPathStyle(raw),
        (error: unknown) => {
          assert.ok(error instanceof Error, `Error attendue pour « ${raw} »`);
          assert.match(error.message, /S3_FORCE_PATH_STYLE/);
          assert.ok(
            error.message.includes(raw),
            `le message doit citer la valeur fautive : ${error.message}`,
          );
          return true;
        },
        `« ${raw} » aurait du etre refuse`,
      );
    }
  });
});

describe("validateEnv — refus de demarrer sans moyen d'envoi", () => {
  it('REFUSE une production sans transport et sans derogation', () => {
    assert.throws(
      () => validateEnv(baseEnv({ NODE_ENV: 'production' })),
      /Aucun moyen d'envoi de courriel/,
    );
  });

  it('REFUSE une production dont la derogation est explicitement fermee', () => {
    assert.throws(
      () => validateEnv(baseEnv({ NODE_ENV: 'production', ALLOW_BOOT_WITHOUT_MAIL: 'false' })),
      /Aucun moyen d'envoi de courriel/,
    );
  });

  it('ACCEPTE une production sans transport quand la derogation est ouverte', () => {
    const env = validateEnv(baseEnv({ NODE_ENV: 'production', ALLOW_BOOT_WITHOUT_MAIL: 'true' }));

    // La valeur reste une CHAINE apres passage dans `plainToInstance` : c'est la
    // preuve que la conversion implicite ne l'a pas transformee, et donc que
    // « false » restera faux sur un deploiement qui l'ecrit.
    assert.equal(env.ALLOW_BOOT_WITHOUT_MAIL, 'true');
    assert.equal(allowsBootWithoutMail(env.ALLOW_BOOT_WITHOUT_MAIL), true);
  });

  it('ACCEPTE le developpement sans aucune derogation', () => {
    // En developpement, l'absence de transport est normale : le lien de
    // reinitialisation est ecrit dans les journaux (voir `MailService`). Le
    // demarrage ne doit pas dependre d'une variable qui ne sert pas la.
    const env = validateEnv(baseEnv({ NODE_ENV: 'development' }));

    assert.equal(env.ALLOW_BOOT_WITHOUT_MAIL, 'false');
  });

  it('ACCEPTE une production qui a un relais SMTP, derogation fermee', () => {
    assert.doesNotThrow(() =>
      validateEnv(baseEnv({ NODE_ENV: 'production', SMTP_HOST: 'smtp.exemple.tld' })),
    );
  });

  it("ACCEPTE une production qui a le couple de cles d'API HTTP, derogation fermee", () => {
    assert.doesNotThrow(() =>
      validateEnv(
        baseEnv({
          NODE_ENV: 'production',
          MAILJET_API_KEY: 'clef-publique',
          MAILJET_SECRET_KEY: 'clef-secrete',
        }),
      ),
    );
  });

  it('REFUSE une cle Mailjet seule, en nommant celle qui manque', () => {
    // LES DEUX CLES VONT ENSEMBLE. Mailjet authentifie en HTTP Basic : la cle
    // publique sert d'identifiant, la secrete de mot de passe. Une seule des
    // deux donne un 401 a chaque envoi, donc l'etat est refuse.
    const sansSecrete = baseEnv({ NODE_ENV: 'production', MAILJET_API_KEY: 'clef-publique' });
    const sansPublique = baseEnv({ NODE_ENV: 'production', MAILJET_SECRET_KEY: 'clef-secrete' });

    // Le message doit NOMMER la manquante. Sans cela, l'exploitant lit « aucun
    // moyen d'envoi » alors qu'il vient d'en coller une, et cherche la panne
    // partout sauf dans la variable qu'il n'a pas remplie.
    assert.throws(() => validateEnv(sansSecrete), /MAILJET_SECRET_KEY/);
    assert.throws(() => validateEnv(sansPublique), /MAILJET_API_KEY/);
  });

  it('REFUSE une derogation mal orthographiee plutot que de la fermer en silence', () => {
    // Le controle doit remonter jusqu'a `validateEnv`, et pas seulement exister
    // dans `allowsBootWithoutMail` : c'est ce chemin-la qui decide du demarrage.
    assert.throws(
      () => validateEnv(baseEnv({ NODE_ENV: 'production', ALLOW_BOOT_WITHOUT_MAIL: 'oui' })),
      /ALLOW_BOOT_WITHOUT_MAIL/,
    );
  });

  it('ne laisse pas la derogation exempter les AUTRES controles', () => {
    // Elle n'ouvre QUE le courriel. Deux secrets identiques restent une raison
    // d'arreter le processus, meme sur un deploiement qui a ouvert la derogation.
    assert.throws(
      () =>
        validateEnv(
          baseEnv({
            NODE_ENV: 'production',
            ALLOW_BOOT_WITHOUT_MAIL: 'true',
            JWT_REFRESH_SECRET: 'a'.repeat(32),
          }),
        ),
      /DIFFERENTS/,
    );
  });
});
