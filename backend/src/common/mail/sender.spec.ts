import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSender } from './sender.js';

/**
 * CE QUE CES TESTS PROTEGENT.
 *
 * `parseSender` est le SEUL endroit ou une adresse d'expedition malformee est
 * arretee, et cet endroit est volontairement le demarrage : un expediteur
 * invalide ne produit sinon que des refus a chaque envoi, c'est-a-dire une panne
 * decouverte par un client qui n'a pas recu son lien de reinitialisation. Aucun
 * test d'integration ne couvre ce cas, parce qu'il demanderait un compte reel
 * chez le fournisseur d'envoi.
 *
 * Ces tests ont demenage avec la fonction. Ils vivaient dans le spec du transport
 * d'un fournisseur, ou ils ne provoquaient aucun degat mais ou ils rendaient le
 * remplacement de ce fournisseur plus risque qu'il ne devait l'etre : on ne
 * savait plus, en lisant le nom du fichier, si les tests de l'expediteur
 * appartenaient au fournisseur ou au module.
 *
 * Aucun appel reseau, aucun acces a la configuration : `parseSender` ne lit que
 * la chaine qu'on lui donne.
 */

describe('parseSender — decomposition de SMTP_FROM', () => {
  it("separe le nom et l'adresse de « Comexa <no-reply@comexa.com> »", () => {
    assert.deepEqual(parseSender('Comexa <no-reply@comexa.com>'), {
      email: 'no-reply@comexa.com',
      name: 'Comexa',
    });
  });

  it('accepte une adresse seule : le nom est alors absent, et non vide', () => {
    const sender = parseSender('no-reply@comexa.com');

    assert.equal(sender.email, 'no-reply@comexa.com');
    // `name` absent plutot que `name: ''` : la requete HTTP omet alors le champ,
    // ce qui laisse le fournisseur afficher le nom du compte au lieu d'un libelle
    // vide dans la boite du destinataire.
    assert.equal('name' in sender, false, 'le champ name ne doit pas exister');
  });

  it("tolere les espaces autour du nom et de l'adresse", () => {
    assert.deepEqual(parseSender('   Comexa   <   no-reply@comexa.com   >  '), {
      email: 'no-reply@comexa.com',
      name: 'Comexa',
    });
  });

  it('enleve les guillemets doubles qui entourent le nom', () => {
    assert.deepEqual(parseSender('"Comexa Algerie" <no-reply@comexa.com>'), {
      email: 'no-reply@comexa.com',
      name: 'Comexa Algerie',
    });
  });

  it('enleve les guillemets simples et preserve la virgule du nom', () => {
    // La virgule est le cas qui casse un en-tete SMTP mal compose ; elle doit
    // survivre a la decomposition pour que le transport SMTP la re-echappe.
    assert.deepEqual(parseSender("'Comexa, Algerie' <no-reply@comexa.com>"), {
      email: 'no-reply@comexa.com',
      name: 'Comexa, Algerie',
    });
  });

  it('preserve une virgule dans un nom non guillemete', () => {
    assert.deepEqual(parseSender('Comexa, Algerie <no-reply@comexa.com>'), {
      email: 'no-reply@comexa.com',
      name: 'Comexa, Algerie',
    });
  });

  it('enleve les guillemets qui entourent la VALEUR ENTIERE, comme dans un .env', () => {
    // Le cas que ce test protege est celui du modele du depot lui-meme :
    // `.env.example` ecrit `SMTP_FROM="Comexa <no-reply@comexa.example>"`, et
    // `.env.render` fait pareil. Les guillemets y protegent les espaces et les
    // chevrons, mais tous les lecteurs ne les retirent pas — `docker run
    // --env-file` est connu pour les conserver. Sans le retrait, la valeur recue
    // finit par un guillemet, le motif d'angle ne s'applique plus, et l'adresse
    // retournee devient la chaine entiere : elle contient une arobase, donc
    // elle franchit la verification, et le fournisseur refuse chaque envoi en
    // designant un expediteur que personne n'a ecrit.
    assert.deepEqual(parseSender('"Comexa <no-reply@comexa.com>"'), {
      email: 'no-reply@comexa.com',
      name: 'Comexa',
    });

    assert.deepEqual(parseSender("'no-reply@comexa.com'"), {
      email: 'no-reply@comexa.com',
    });
  });

  it("accepte un angle sans nom d'affichage, sans produire de nom vide", () => {
    assert.deepEqual(parseSender('<no-reply@comexa.com>'), {
      email: 'no-reply@comexa.com',
    });
  });

  it('refuse une valeur sans arobase, en nommant le format attendu', () => {
    for (const raw of ['Comexa', 'Comexa <comexa>', '', 'comexa.com']) {
      assert.throws(
        () => parseSender(raw),
        (error: unknown) => {
          assert.ok(error instanceof Error, `Error attendue pour « ${raw} »`);
          assert.match(error.message, /SMTP_FROM/);
          assert.match(error.message, /Comexa <no-reply@comexa\.com>/);
          return true;
        },
        `« ${raw} » aurait du etre refuse`,
      );
    }
  });
});
