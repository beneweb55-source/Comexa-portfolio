import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException } from '../../common/errors/app-error.js';
import {
  SLUG_MAX_LENGTH,
  assertValidSlug,
  resolveSlug,
  slugify,
} from './slug.js';

/**
 * CE QUE CES TESTS PROTEGENT.
 *
 * Un slug est un segment d'URL, et il est `@unique` en base. Deux proprietes en
 * decoulent, et chacune correspond a un incident reel :
 *
 *  1. le slug ne doit contenir aucun caractere capable de changer la FORME du
 *     chemin — pas de `/`, pas de `.`, pas d'espace, pas de majuscule ;
 *  2. deux libelles differents ne doivent pas produire le meme slug a l'insu de
 *     l'editeur, et un libelle accentue doit produire le meme slug que sa version
 *     sans accent.
 *
 * Aucun de ces tests n'a besoin de base de donnees : la logique est pure, c'est
 * pour cela qu'elle est sortie du service.
 */

function codeOf(error: unknown): string {
  assert.ok(error instanceof AppException, `AppException attendue, recu : ${String(error)}`);
  return error.code;
}

describe('slugify — forme du slug', () => {
  it('retire les accents plutot que de les translitterer en tirets', () => {
    // Sans NFD, « Etude » et « Étude » produiraient deux slugs DIFFERENTS : le
    // `@unique` ne verrait pas le doublon (les chaines different bien), et deux
    // pages publiques quasi identiques coexisteraient.
    assert.equal(slugify('Étude de cas'), 'etude-de-cas');
    assert.equal(slugify('Etude de cas'), 'etude-de-cas');
    assert.equal(slugify('Création'), 'creation');
    assert.equal(slugify('Développement web'), 'developpement-web');
  });

  it('remplace tout ce qui n est pas alphanumerique par un tiret unique', () => {
    assert.equal(slugify('Pack   Premium !!'), 'pack-premium');
    assert.equal(slugify('Refonte / Site & SEO'), 'refonte-site-seo');
    assert.equal(slugify('  espaces  autour  '), 'espaces-autour');
  });

  it('ne laisse aucun separateur en tete ni en fin', () => {
    for (const value of ['--- fin ---', '!!!debut!!!', '  ', '...']) {
      const slug = slugify(value);
      assert.ok(!slug.startsWith('-'), `tiret en tete : ${slug}`);
      assert.ok(!slug.endsWith('-'), `tiret en fin : ${slug}`);
    }
  });

  it('ne produit jamais de segment de chemin ni de point', () => {
    // C'est la propriete qui compte pour la securite : le slug devient une
    // partie d'URL. Un `/` en ferait deux segments, un `..` remonterait, un `.`
    // ferait croire a une extension.
    for (const hostile of ['../../etc/passwd', 'a/b', '..', 'x.y', 'C:\\windows']) {
      const slug = slugify(hostile);
      assert.ok(!slug.includes('/'), `segment de chemin dans : ${slug}`);
      assert.ok(!slug.includes('\\'), `anti-slash dans : ${slug}`);
      assert.ok(!slug.includes('.'), `point dans : ${slug}`);
      assert.ok(!slug.includes('..'), `remontee dans : ${slug}`);
    }
  });

  it('borne la longueur sans finir par un tiret', () => {
    const slug = slugify('a '.repeat(200));
    assert.ok(slug.length <= SLUG_MAX_LENGTH, `slug trop long : ${slug.length}`);
    assert.ok(!slug.endsWith('-'), `tiret en fin apres troncature : ${slug}`);
  });

  it('rend une chaine vide quand rien d exploitable ne reste', () => {
    // Ce cas n'est pas un slug valide : c'est a `assertValidSlug` de le dire.
    // Renvoyer autre chose — « contenu », par exemple — masquerait une saisie
    // vide derriere un slug qui a l'air voulu.
    assert.equal(slugify(''), '');
    assert.equal(slugify('!!!'), '');
  });
});

describe('assertValidSlug — le filtre', () => {
  it('accepte les slugs produits par slugify', () => {
    for (const value of ['etude-de-cas', 'pack-premium', 'seo2026', 'a']) {
      assert.doesNotThrow(() => assertValidSlug(value));
    }
  });

  it('refuse un slug vide', () => {
    assert.throws(
      () => assertValidSlug(''),
      (error) => codeOf(error) === 'SLUG_INVALID',
    );
  });

  it('refuse un slug hors du jeu de caracteres autorise', () => {
    for (const hostile of [
      'Etude-De-Cas',
      'etude de cas',
      'etude/de/cas',
      'etude.de.cas',
      '..',
      'etude--de--cas',
      '-etude',
      'etude-',
      'etude_de_cas',
    ]) {
      assert.throws(
        () => assertValidSlug(hostile),
        (error) => codeOf(error) === 'SLUG_INVALID',
        `${hostile} devrait etre refuse`,
      );
    }
  });

  it('refuse un slug trop long', () => {
    assert.throws(
      () => assertValidSlug('a'.repeat(SLUG_MAX_LENGTH + 1)),
      (error) => codeOf(error) === 'SLUG_INVALID',
    );
  });

  it('refuse les slugs reserves', () => {
    // « admin » sous le prefixe d'un contenu creerait un chemin qui ressemble a
    // une route de l'application : le conflit ne se decouvre qu'une fois le
    // contenu cree, et un slug public ne se change pas sans casser les liens.
    // La liste est parcourue en entier : une entree qui ne peut jamais etre
    // atteinte — parce que le filtre de caracteres la refuse avant — est une
    // protection imaginaire. Ce test l'a d'ailleurs attrapee sur `_next`, dont
    // le souligne ne survit pas a `slugify`.
    for (const reserved of ['admin', 'api', 'login', 'robots', 'sitemap']) {
      assert.throws(
        () => assertValidSlug(reserved),
        (error) => codeOf(error) === 'SLUG_RESERVED',
        `${reserved} devrait etre reserve`,
      );
    }
  });
});

describe('resolveSlug — explicite ou derive', () => {
  it('utilise le slug fourni quand il y en a un', () => {
    assert.equal(resolveSlug('mon-slug', 'Titre du contenu'), 'mon-slug');
  });

  it('derive le slug du libelle quand le slug est absent ou vide', () => {
    assert.equal(resolveSlug(undefined, 'Étude de cas'), 'etude-de-cas');
    // Un formulaire HTML envoie une chaine vide pour un champ laisse vide : la
    // traiter comme « absent » est necessaire, sinon la creation echouerait sur
    // un SLUG_INVALID que l'utilisateur ne comprendrait pas.
    assert.equal(resolveSlug('   ', 'Étude de cas'), 'etude-de-cas');
  });

  it('fait passer le slug FOURNI par le meme filtre que le slug derive', () => {
    // Le point sensible : un slug saisi a la main est une entree utilisateur.
    // Le croire correct parce qu'il « a l'air bon » est exactement la maniere
    // dont un chemin relatif arrive en base.
    assert.equal(resolveSlug('../../etc/passwd', 'x'), 'etc-passwd');
    assert.doesNotThrow(() => resolveSlug('../../etc/passwd', 'x'));
    assert.throws(
      () => resolveSlug('!!!', 'x'),
      (error) => codeOf(error) === 'SLUG_INVALID',
    );
  });

  it('refuse un libelle qui ne produit aucun slug exploitable', () => {
    assert.throws(
      () => resolveSlug(undefined, '???'),
      (error) => codeOf(error) === 'SLUG_INVALID',
    );
  });
});
