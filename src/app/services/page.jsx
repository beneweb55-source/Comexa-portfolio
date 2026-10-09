"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Services() {
  const pathname = usePathname();
  const pageLabels = {
    "/": "Accueil",
    "/services": "Nos services",
    "/realisations": "Réalisations",
    "/partenaires": "Partenaires",
    "/contact": "Contact",
  };
  const currentPageLabel = pageLabels[pathname] ?? "Nos services";
  const [previousPage, setPreviousPage] = useState({
    path: "/",
    label: "Accueil",
  });

  useEffect(() => {
    const previousPath = sessionStorage.getItem("comexa-previous-path");

    if (previousPath && previousPath !== pathname) {
      setPreviousPage({
        path: previousPath,
        label: pageLabels[previousPath] ?? "Page précédente",
      });
    }
  }, [pathname]);

  useEffect(() => {
    const sections = document.querySelectorAll(".scroll-reveal");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8%" },
    );

    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, []);
  const packs = [
    {
      name: "Site vitrine",
      icon: "▣",
      tagline: "Présenter & convaincre",
      description:
        "Une présence claire, distinctive et pensée pour convertir vos visiteurs en prises de contact qualifiées.",
      color: "light",
      features: [
        "Cadrage des objectifs et arborescence",
        "Conception UX/UI et interface responsive",
        "Développement front-end et CMS",
        "Pages de présentation et formulaire de contact",
        "Bases SEO techniques et performance",
        "Tests, mise en ligne et prise en main",
      ],
      benefit:
        "Votre activité devient lisible. Votre équipe garde la main sur les contenus.",
      project: "Atelier Noroît",
    },
    {
      name: "E-commerce",
      icon: "▣",
      tagline: "Vendre & gérer",
      description:
        "Des parcours d’achat fluides, une administration fiable et les intégrations utiles à votre activité.",
      color: "blue",
      features: [
        "Cadrage du catalogue et parcours d’achat",
        "Conception UX/UI et boutique responsive",
        "Catalogue, fiches produits et panier",
        "Paiement et modes de livraison configurés",
        "Gestion des commandes et connexions métier",
        "Tests, mise en ligne et prise en main",
      ],
      benefit:
        "Une boutique cohérente avec votre façon de vendre, plus simple à administrer.",
      project: "Comptoir Local",
    },
    {
      name: "Application web",
      icon: "</>",
      tagline: "Outiller & connecter",
      description:
        "Des outils métiers et plateformes performants, développés autour de vos usages réels.",
      color: "light",
      features: [
        "Ateliers métier et périmètre fonctionnel",
        "Product design et parcours utilisateurs",
        "Développement front-end et back-end",
        "Comptes, rôles et fonctionnalités métier",
        "API et connexions aux outils existants",
        "Tests, déploiement et documentation",
      ],
      benefit:
        "Vos informations et vos actions réunies dans un outil adapté à votre équipe.",
      project: "Oryon Pilot",
    },
  ];
  return (
    <main className="w-full overflow-hidden">
      <section className="scroll-reveal w-full bg-[#f5f7fa] px-5 py-10 sm:px-6 md:px-8 lg:px-[45px]">
        <div className="mx-auto max-w-[1240px]">
          <div className="flex items-center gap-3 text-[14px] text-[#66758c]">
            <Link
              href={previousPage.path}
              className="transition hover:text-[#10294a]"
            >
              {previousPage.label}
            </Link>
            <span className="text-[18px] text-[#10294a]">›</span>
            <span className="font-medium text-[#10294a]">
              {currentPageLabel}
            </span>
          </div>

          <div className="relative mt-5 min-h-[250px] sm:min-h-[290px] lg:min-h-[350px]">
            <div className="scroll-slide-left relative z-10 w-full max-w-[720px]">
              <span className="inline-flex rounded-[7px] bg-[#168fe5] px-3 py-[6px] text-[11px] font-medium uppercase text-[#08203e]">
                Naviguer le digital ensemble
              </span>

              <h1 className="mt-6 text-[clamp(2.35rem,8vw,3.75rem)] font-medium leading-[1.03] tracking-[-2px] text-[#10294a]">
                Votre besoin web.
                <br />
                Le bon pack pour
                <br />
                avancer.
              </h1>

              {/* DESCRIPTION */}
              <p className="mt-5 w-full max-w-[650px] text-[14px] leading-[1.7] text-[#69758a]">
                Site vitrine, boutique e-commerce ou application sur mesure : un
                cadre clair pour concevoir, développer et faire vivre votre
                projet web.
              </p>

              {/* ACTIONS */}
              <div className="mt-5 flex flex-col items-stretch gap-4 sm:flex-row sm:flex-wrap sm:items-center">
                <a
                  href="#projets"
                  className="flex min-h-[46px] items-center justify-center gap-4 rounded-[14px] bg-[#168fe5] px-5 py-3.5 text-[13px] font-medium text-[#08203e] transition hover:bg-[#0d82d0] sm:w-fit"
                >
                  <span>Découvrir les packs</span>
                  <span className="text-[18px]">↗</span>
                </a>

                <a
                  href="#etudes-de-cas"
                  className="text-[14px] font-medium text-[#10294a] underline underline-offset-4"
                >
                  Lire les études de cas
                </a>
              </div>
            </div>

            {/* ILLUSTRATION DROITE */}
            <div className="scroll-slide-right absolute right-0 top-0 hidden h-[300px] w-[390px] lg:block">
              {/* Grand cercle */}
              <div className="absolute left-[65px] top-[12px] h-[200px] w-[200px] rounded-full border-[1.5px] border-[#4aaef0]" />

              {/* Cercle intérieur */}
              <div className="absolute left-[100px] top-[45px] h-[130px] w-[130px] rounded-full border border-dashed border-[#4aaef0]" />

              {/* FENÊTRE */}
              <div className="absolute left-[48px] top-[32px] h-[155px] w-[240px] overflow-hidden rounded-[16px] border-[1.5px] border-[#10294a] bg-white shadow-[0_7px_0_#10294a]">
                {/* Barre navigateur */}
                <div className="flex h-[27px] items-center gap-[5px] border-b border-[#dce3eb] px-3">
                  <span className="h-[4px] w-[4px] rounded-full bg-[#10294a]" />
                  <span className="h-[4px] w-[4px] rounded-full bg-[#10294a]" />
                  <span className="h-[4px] w-[4px] rounded-full bg-[#10294a]" />
                </div>

                <div className="p-4">
                  <p className="text-[6px] text-[#69758a]">
                    comexa / nos-servis
                  </p>

                  <ul>
                    <li>Présenter votre activité</li>
                    <li>Vendre vos produits en ligne</li>
                    <li>simplifier vos usages</li>
                  </ul>

                  <div className="mt-3 h-[11px] w-[55px] rounded-[3px] bg-[#168fe5]" />

                  {/* Bloc image */}
                  <div className="absolute right-[15px] top-[42px] flex h-[90px] w-[66px] items-center justify-center rounded-[9px] bg-[#e7f2fc]">
                    <div className="h-[27px] w-[27px] rotate-45 rounded-[4px] bg-[#4aaef0]" />
                  </div>
                </div>
              </div>

              {/* Losange haut droit */}
              <div className="absolute right-[47px] top-[53px] h-[25px] w-[25px] rotate-45 rounded-[4px] bg-[#4aaef0]" />

              {/* Badge */}
              <div className="absolute bottom-[35px] right-[5px] flex h-[43px] w-[174px] items-center justify-center rounded-[13px] border-[1.5px] border-[#10294a] bg-[#168fe5] text-[10px] font-medium text-[#08203e] shadow-[0_6px_0_#10294a]">
                100 % développement web
              </div>

              {/* Petit point */}
              <div className="absolute bottom-[38px] left-[67px] h-[8px] w-[8px] rounded-full bg-[#10294a]" />
            </div>
          </div>
        </div>
      </section>

      <section className="scroll-reveal section-reveal-delay-1 w-full bg-white px-5 py-12 sm:px-6 md:px-10 lg:px-12">
        <div className="mx-auto max-w-[1180px]">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <span className="inline-flex rounded-[7px] bg-[#168fe5] px-3 py-[6px] text-[11px] font-medium uppercase text-[#08203e]">
                NOS PACKS WEB
              </span>
              <h2 className="mt-4 max-w-[570px] text-[clamp(1.8rem,5vw,2.375rem)] font-medium leading-[1.08] tracking-[-1px] text-[#10294a]">
                Trois besoins différents. <br /> La même exigence web.
              </h2>
            </div>
            <p className="max-w-[280px] text-[13px] leading-[1.55] text-[#69758a]">
              Des offres organisées par usage, pas des forfaits figés. Nous
              ajustons les fonctionnalités et le périmètre après un premier
              échange.
            </p>
          </div>
          <div className="mt-7 grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 lg:grid-cols-3">
            {packs.map((pack, index) => {
              const highlighted = pack.color === "blue";
              return (
                <article
                  key={pack.name}
                  className={`reveal-card reveal-card-delay-${index + 1} flex flex-col rounded-[18px] border-[1.5px] border-[#10294a] p-5 shadow-[0_7px_0_#10294a] ${highlighted ? "bg-[#238dde] text-[#08203e]" : "bg-[#f5f7fa] text-[#10294a]"}`}
                >
                  <div className="flex items-center justify-between">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[14px] text-[#10294a]"
                    >
                      {pack.icon}
                    </div>
                    <span className="text-[12px] font-medium">
                      {" "}
                      {pack.tagline}
                    </span>
                  </div>
                  <h3 className="mt-4 text-[22px] font-medium">{pack.name}</h3>
                  <p className="mt-2 min-h-[72px] text-[15px] leading-[1.5]">
                    {pack.description}
                  </p>
                  <div className="mt-3">
                    {" "}
                    <h4 className="text-[19px] font-medium">Sur devis</h4>
                    <p className="mt-1 text-[12px] opacity-75">
                      Périmètre adapté à votre projet
                    </p>
                  </div>
                  <div
                    className={`mt-3 border-t pt-3 ${highlighted ? "border-[#1479bd]" : "border-[#dbe2ea]"}`}
                  >
                    <h4 className="text-[13px] font-medium">
                      {" "}
                      Le socle du pack
                    </h4>
                    <ul className="mt-2 space-y-2">
                      {pack.features.map((feature) => (
                        <li
                          key={feature}
                          className="flex items-start gap-2 text-[13px] leading-[1.5]"
                        >
                          <span className="shrink-0">✓</span>{" "}
                          <span>{feature}</span>{" "}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div
                    className={`mt-4 rounded-lg p-3 ${highlighted ? "bg-white" : "bg-[#e7f2fc]"}`}
                  >
                    <p className="text-[13px] font-medium">
                      Ce que vous y gagnez
                    </p>
                    <p className="mt-2 text-[13px] leading-[1.5]">
                      {pack.benefit}
                    </p>
                  </div>
                  {/* CTA */}
                  <a
                    href={`mailto:bonjour@comexa.fr?subject=${encodeURIComponent(`Demande de devis - ${pack.name}`)}`}
                    className={`mt-5 flex w-fit items-center gap-3 rounded-xl border border-[#10294a] px-4 py-3 text-[13px] font-medium transition hover:opacity-80 ${highlighted ? "bg-[#10294a] text-white" : "bg-transparent text-[#10294a]"}`}
                  >
                    Demander un devis
                    <span className="text-[16px]">↗</span>
                  </a>{" "}
                  {/* Lien vers le projet */}
                  <a
                    href={`/projets#${pack.project.toLowerCase().replaceAll(" ", "-")}`}
                    className="mt-4 text-[12px] opacity-80 hover:underline"
                  >
                    À découvrir plus bas : {pack.project}
                  </a>
                </article>
              );
            })}
          </div>
          {/* Note de bas de section */}
          <p className="mt-7 text-[15px] leading-[1.5] text-[#69758a]">
            {" "}
            Structure des packs et inclusions proposées à titre illustratif, à
            valider par Comexa. Le devis précise les pages, fonctionnalités,
            intégrations et responsabilités de chacun.
          </p>
        </div>
      </section>

      <section className="scroll-reveal section-reveal-delay-2 bg-slate-50 px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
  <div className="mx-auto max-w-6xl">

    <div className="mb-6">
      <span className="inline-flex items-center rounded-full bg-sky-500 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-white">
        Choisir votre cap
      </span>
    </div>

   
    <div className="mb-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <h2 className="text-3xl font-bold tracking-tight text-slate-800 sm:text-4xl">
        Quel pack pour votre usage ?
      </h2>
      <p className="max-w-md text-sm text-slate-500 leading-relaxed">
        Le bon point de départ dépend de ce que votre site doit permettre de faire. Les connexions et options sont précisées dans le devis.
      </p>
    </div>

    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="bg-slate-800 text-white">
            <th className="px-5 py-4 font-semibold rounded-tl-2xl">Votre besoin</th>
            <th className="px-5 py-4 font-semibold">Site vitrine</th>
            <th className="px-5 py-4 font-semibold">E-commerce</th>
            <th className="px-5 py-4 font-semibold rounded-tr-2xl">Application web</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          <tr className="bg-slate-50/70">
            <td className="px-5 py-4 font-medium text-slate-700">Votre priorité</td>
            <td className="px-5 py-4 text-slate-600">Présenter votre activité</td>
            <td className="px-5 py-4 text-slate-600">Vendre vos produits</td>
            <td className="px-5 py-4 text-slate-600">Outiller vos équipes</td>
          </tr>
          <tr>
            <td className="px-5 py-4 font-medium text-slate-700">Contenus &amp; administration</td>
            <td className="px-5 py-4 text-slate-600">Pages, projets et CMS</td>
            <td className="px-5 py-4 text-slate-600">Catalogue et commandes</td>
            <td className="px-5 py-4 text-slate-600">Données et interface métier</td>
          </tr>
          <tr className="bg-slate-50/70">
            <td className="px-5 py-4 font-medium text-slate-700">Fonctionnalité centrale</td>
            <td className="px-5 py-4 text-slate-600">Prise de contact</td>
            <td className="px-5 py-4 text-slate-600">Parcours de commande</td>
            <td className="px-5 py-4 text-slate-600">Workflows sur mesure</td>
          </tr>
          <tr>
            <td className="px-5 py-4 font-medium text-slate-700">Connexions</td>
            <td className="px-5 py-4 text-slate-600">Selon votre besoin</td>
            <td className="px-5 py-4 text-slate-600">Paiement, livraison, outils métier</td>
            <td className="px-5 py-4 text-slate-600">API et systèmes existants</td>
          </tr>
          <tr className="bg-slate-50/70">
            <td className="px-5 py-4 font-medium text-slate-700">Socle commun</td>
            <td className="px-5 py-4 text-slate-600">UX/UI · responsive · tests</td>
            <td className="px-5 py-4 text-slate-600">UX/UI · responsive · tests</td>
            <td className="px-5 py-4 text-slate-600">UX/UI · responsive · tests</td>
          </tr>
          <tr>
            <td className="px-5 py-4 font-medium text-slate-700 rounded-bl-2xl">Après la mise en ligne</td>
            <td className="px-5 py-4 text-slate-600">Maintenance en option</td>
            <td className="px-5 py-4 text-slate-600">Maintenance en option</td>
            <td className="px-5 py-4 text-slate-600 rounded-br-2xl">Maintenance en option</td>
          </tr>
        </tbody>
      </table>
    </div>

   
    <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-500">
        Une refonte ou plusieurs besoins à réunir ? Nous construisons le périmètre avec vous.
      </p>
      <a href="#" className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-600 hover:text-sky-700 transition-colors">
        Être guidé dans mon choix
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M17 7H7M17 7v10" />
        </svg>
      </a>
    </div>
  </div>
</section>
      

<section className="scroll-reveal section-reveal-delay-3 bg-slate-900 px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
  <div className="mx-auto max-w-6xl">
  
    <div className="mb-6">
      <span className="inline-flex items-center rounded-full bg-sky-500/20 px-3.5 py-1 text-xs font-semibold uppercase tracking-wide text-sky-400 ring-1 ring-inset ring-sky-500/30">
        Les bénéfices
      </span>
    </div>

    
    <div className="mb-12 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <h2 className="max-w-xl text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
        Un outil utile aujourd’hui.<br className="hidden sm:block" />
        Une base solide pour la suite.
      </h2>
      <p className="max-w-sm text-sm text-slate-400 leading-relaxed">
        Exigence visuelle, solidité technique et autonomie : les mêmes principes guident chaque pack, du premier atelier à la mise en ligne.
      </p>
    </div>

   
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
     
      <div className="rounded-2xl border border-slate-700/80 bg-slate-800/50 p-6">
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full border border-slate-600 text-slate-300">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-white mb-2">Des décisions plus claires</h3>
        <p className="text-sm text-slate-400 leading-relaxed">
          Des objectifs cadrés, des choix expliqués et des validations partagées. Vous savez ce qui est construit et pourquoi.
        </p>
      </div>

     
      <div className="rounded-2xl border border-slate-700/80 bg-slate-800/50 p-6">
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full border border-slate-600 text-slate-300">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-white mb-2">Des usages plus simples</h3>
        <p className="text-sm text-slate-400 leading-relaxed">
          Une navigation et des parcours pensés pour vos visiteurs, vos clients ou vos équipes — sans complexité superflue.
        </p>
      </div>

     
      <div className="rounded-2xl border border-slate-700/80 bg-slate-800/50 p-6">
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full border border-slate-600 text-slate-300">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-white mb-2">Plus d’autonomie</h3>
        <p className="text-sm text-slate-400 leading-relaxed">
          Une administration adaptée et une prise en main accompagnée pour faire vivre vos contenus et vos données.
        </p>
      </div>

     
      <div className="rounded-2xl border border-slate-700/80 bg-slate-800/50 p-6">
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full border border-slate-600 text-slate-300">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-white mb-2">Un projet qui évolue</h3>
        <p className="text-sm text-slate-400 leading-relaxed">
          Une base technique robuste, prête à accueillir de nouveaux contenus, des connexions et des fonctionnalités utiles.
        </p>
      </div>
    </div>

   
    <div className="rounded-2xl bg-white p-6 sm:p-8 shadow-lg">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
      
        <div className="max-w-md">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
            </svg>
            En complément de chaque pack
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">Maintenance &amp; optimisation</h3>
          <p className="text-sm text-slate-500 leading-relaxed">
            Un suivi continu pour garder votre produit web rapide, évolutif et agréable à faire utiliser.
          </p>
        </div>

       
        <ul className="space-y-2.5 text-sm text-slate-600">
          <li className="flex items-start gap-2.5">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Maintenance et mises à jour de sécurité
          </li>
          <li className="flex items-start gap-2.5">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Optimisation des performances
          </li>
          <li className="flex items-start gap-2.5">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Évolutions fonctionnelles selon vos besoins
          </li>
          <li className="mt-1 text-xs text-slate-400">
            Accompagnement optionnel · modalités définies au devis
          </li>
        </ul>

     
        <div className="flex flex-col items-start lg:items-end gap-3 shrink-0">
          <span className="text-sm font-medium text-slate-500">Sur devis</span>
          <a href="#" className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-600 transition-colors">
            Prévoir le suivi
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M17 7H7M17 7v10" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  </div>
</section>

      <section className="scroll-reveal section-reveal-delay-3 w-full bg-[#f5f7fa] px-5 py-14 md:px-10 lg:px-[54px]">
      <div className="mx-auto max-w-[1110px]">

        <div className="grid items-center gap-10 lg:grid-cols-[1fr_395px]">

          {/* LEFT */}
          <div>

            <span className="inline-flex rounded-[7px] bg-[#168fe5] px-3 py-[7px] text-[10px] font-medium uppercase text-[#08203e]">
              DEVENIR PARTENAIRE
            </span>

            <h2 className="mt-5 max-w-[550px] text-[clamp(1.9rem,5vw,2.6875rem)] font-medium leading-[1.08] tracking-[-1.5px] text-[#10294a]">
              Et si nous prenions
              <br />
              le même cap ?
            </h2>

            <p className="mt-5 max-w-[540px] text-[15px] leading-[1.7] text-[#69758a]">
              Vous souhaitez associer votre expertise à notre savoir-faire web ?
              Présentez-nous votre activité et ce que nous pourrions construire
              ensemble.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-5">

              <a
                href="#contact"
                className="flex items-center gap-4 rounded-[14px] bg-[#10294a] px-5 py-3.5 text-[16px] font-medium text-white transition hover:bg-[#173b64]"
              >
                <span>Proposer une collaboration</span>
                <span className="text-[17px]">↗</span>
              </a>

              <a
                href="mailto:bonjour@comexa.dz"
                className="text-[15px] font-medium text-[#10294a] underline underline-offset-4"
              >
                bonjour@comexa.dz
              </a>

            </div>
          </div>

          <div className="relative overflow-hidden rounded-[22px] border-[1.5px] border-[#10294a] bg-[#238dde] p-6 shadow-[0_8px_0_#10294a] md:p-7">

            <div className="absolute left-6 top-6 flex">
              <div className="h-[43px] w-[43px] rounded-full border-[1.5px] border-[#10294a]" />
              <div className="-ml-[10px] h-[43px] w-[43px] rounded-full border-[1.5px] border-[#10294a]" />
            </div>

           
            <div className="absolute right-7 top-7 h-[22px] w-[22px] rotate-45 rounded-[4px] bg-[#10294a]" />

            <div className="relative z-10 mt-[65px]">

              <h3 className="text-[23px] font-medium text-[#08203e]">
                Pour commencer, simplement.
              </h3>

              <div className="mt-5 space-y-4">

                <div className="flex gap-3">
                  <span className="text-[15px] font-medium text-[#08203e]">
                    01
                  </span>


                  <p className="text-[15px] text-[#08203e]">
                    Votre activité et votre expertise.
                  </p>
                </div>

                <div className="flex gap-3">
                  <span className="text-[15px] font-medium text-[#08203e]">
                    02
                  </span>

                  <p className="text-[15px] text-[#08203e]">
                    Votre idée de collaboration.
                  </p>
                </div>

                <div className="flex gap-3">
                  <span className="text-[15px] font-medium text-[#08203e]">
                    03
                  </span>

                  <p className="text-[15px] text-[#08203e]">
                    Vos attentes et vos disponibilités.
                  </p>
                </div>

              </div>

            </div>
          </div>

        </div>

      </div>
    </section>
    </main>
  );
}
