"use client";

import { useEffect, useState } from "react";
import { initialsOf, usePublicList } from "@/lib/public-api";
import { usePreviousPage } from "@/lib/previous-page";
import { usePathname } from "next/navigation";
import Link from "next/link";
export default function Partenaires() {
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
 const pathname = usePathname();
  const pageLabels = {
    "/": "Accueil",
    "/services": "Nos services",
    "/realisations": "Réalisations",
    "/partenaires": "Partenaires",
    "/contact": "Contact",
  };
  const currentPageLabel = pageLabels[pathname] ?? "Partenaires";
  const previousPage = usePreviousPage(pathname, pageLabels, { path: "/", label: "Accueil" });
    const technologies = [
    {
      name: "Vercel",
      category: "DÉPLOIEMENT WEB",
      description:
        "Une plateforme pour déployer et héberger des applications web.",
      website: "vercel.com",
    },
    {
      name: "Strapi",
      category: "GESTION DE CONTENU",
      description:
        "Un CMS headless pour structurer les contenus et les diffuser via API.",
      website: "strapi.io",
    },
    {
      name: "Shopify",
      category: "E-COMMERCE",
      description:
        "Une plateforme de commerce pour créer et gérer une boutique en ligne.",
      website: "shopify.com",
    },
    {
      name: "PostgreSQL",
      category: "BASE DE DONNÉES",
      description:
        "Un système de base de données relationnelle open source.",
      website: "postgresql.org",
    },
    {
      name: "Scalingo",
      category: "HÉBERGEMENT CLOUD",
      description:
        "Une plateforme cloud pour héberger et faire évoluer des applications.",
      website: "scalingo.com",
    },
    {
      name: "Figma",
      category: "CONCEPTION D’INTERFACES",
      description:
        "Un outil collaboratif pour concevoir des interfaces et des prototypes.",
      website: "figma.com",
    },
  ];


 
 // Témoignages publiés depuis l'espace équipe. Repli sur la liste ci-dessous si l'API est vide.
  const apiTestimonials = usePublicList("/public/testimonials");
  const testimonialFallback = [
    {
      project: "Atelier Noroît",
      text: "Comexa a su challenger nos idées sans jamais perdre de vue nos contraintes. Le nouveau site ressemble enfin à notre cabinet.",
      initials: "CR",
      name: "Claire Renaud",
      role: "Associée, Atelier Noroît",
    },
    {
      project: "Comptoir Local",
      text: "Nous avons gagné en autonomie sur le catalogue et le parcours d’achat est beaucoup plus cohérent avec notre façon de vendre.",
      initials: "LM",
      name: "Lucie Morel",
      role: "Fondatrice, Comptoir Local",
    },
    {
      project: "Oryon Pilot",
      text: "Une équipe disponible, très claire sur les arbitrages techniques, et un outil adopté naturellement par nos collaborateurs.",
      initials: "ML",
      name: "Mehdi Laurent",
      role: "Responsable opérations, Oryon",
    },
  ];
  const testimonials = apiTestimonials.items?.length
    ? apiTestimonials.items.map((item) => ({
        project: item.caseStudy?.title ?? item.authorCompany ?? "Témoignage",
        text: item.quote,
        initials: initialsOf(item.authorName),
        name: item.authorName,
        role: [item.authorRole, item.authorCompany].filter(Boolean).join(", "),
      }))
    : testimonialFallback;
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

        {/* Hero */}
        <div className="relative mt-5 min-h-[250px] sm:min-h-[290px] lg:min-h-[350px]">

          {/* LEFT CONTENT */}
          <div className="relative z-10 w-full max-w-[720px]">

            {/* Label */}
            <span className="inline-flex rounded-[8px] bg-[#168fe5] px-3 py-[7px] text-[10px] font-medium text-[#08203e]">
              NAVIGUER LE DIGITAL ENSEMBLE
            </span>

            {/* Title */}
            <h1 className="mt-6 text-[clamp(2.35rem,8vw,3.75rem)] font-medium leading-[1.03] tracking-[-2px] text-[#10294a]">
              Le bon cap se construit
              <br />
              ensemble.
            </h1>

            {/* Description */}
            <p className="mt-5 w-full max-w-[650px] text-[14px] leading-[1.7] text-[#69758a]">
              Partenaires, technologies et collaborations : découvrez
              l’écosystème qui accompagne notre expertise en développement
              web.
            </p>

            {/* Button */}
            <button className="mt-5 flex min-h-[46px] w-full items-center justify-center gap-4 rounded-[14px] bg-[#168fe5] px-5 py-3.5 text-[13px] font-medium text-[#08203e] transition duration-200 hover:bg-[#0c82d2] sm:w-fit">
              <span>Découvrir notre écosystème</span>
              <span className="text-[18px]">↗</span>
            </button>
          </div>

          {/* RIGHT ILLUSTRATION */}
          <div className="absolute right-0 top-0 hidden h-[330px] w-[430px] lg:block">

            {/* Grand cercle */}
            <div className="absolute left-[80px] top-[5px] h-[255px] w-[255px] rounded-full border-[1.5px] border-[#4aaef0]" />

            {/* Cercle intérieur pointillé */}
            <div className="absolute left-[116px] top-[41px] h-[185px] w-[185px] rounded-full border-[1.5px] border-dashed border-[#4aaef0]" />

            {/* COMEXA */}
            <div className="absolute left-[147px] top-[80px] flex h-[105px] w-[135px] items-center justify-center rounded-[24px] border border-[#10294a] bg-[#10294a] text-[20px] font-bold lowercase text-white shadow-[6px_7px_0_#10294a]">
              comexa
            </div>

            {/* Concevoir */}
            <div className="absolute left-[23px] top-[13px] flex h-[58px] w-[115px] items-center justify-center rounded-[16px] border-[1.5px] border-[#10294a] bg-white text-[14px] font-medium text-[#10294a] shadow-[5px_7px_0_#10294a]">
              Concevoir
            </div>

            {/* Développer */}
            <div className="absolute right-[8px] top-[37px] flex h-[58px] w-[123px] items-center justify-center rounded-[15px] border-[1.5px] border-[#10294a] bg-[#168fe5] text-[14px] font-medium text-[#08203e] shadow-[5px_7px_0_#10294a]">
              Développer
            </div>

            {/* Faire évoluer */}
            <div className="absolute bottom-[8px] left-[138px] flex h-[57px] w-[135px] items-center justify-center rounded-[15px] border-[1.5px] border-[#10294a] bg-white text-[14px] font-medium text-[#10294a] shadow-[5px_7px_0_#10294a]">
              Faire évoluer
            </div>

            {/* Petit point */}
            <div className="absolute bottom-[76px] left-[48px] h-[11px] w-[11px] rounded-full bg-[#10294a]" />

            {/* Losange */}
            <div className="absolute bottom-[64px] right-[17px] h-[27px] w-[27px] rotate-45 rounded-[5px] bg-[#4aaef0]" />
          </div>

        </div>
      </div>
    </section>


   
      <section className="scroll-reveal section-reveal-delay-1 w-full bg-white px-5 py-12 sm:px-6 md:px-10 lg:px-12">
      <div className="mx-auto max-w-[1180px]">

      
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">

          <div>
            <span className="inline-flex rounded-[7px] bg-[#168fe5] px-3 py-[6px] text-[11px] font-medium uppercase text-[#08203e]">
              NOTRE ÉCOSYSTÈME
            </span>

            <h2 className="mt-4 max-w-[520px] text-[30px] font-medium leading-[1.08] tracking-[-1px] text-[#10294a] md:text-[38px]">
              Partenaires & technologies
              <br />
              de confiance
            </h2>
          </div>

          <p className="max-w-[280px] text-[13px] leading-[1.55] text-[#69758a]">
            Les noms présents sur notre accueil, réunis ici pour mieux
            comprendre leur domaine d’expertise.
          </p>
        </div>

       
        <div className="mt-7 flex items-center gap-3 rounded-[13px] bg-[#e7f2fc] px-4 py-3">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#10294a] text-[10px]">
            i
          </div>

          <p className="text-[11px] leading-[1.5] text-[#10294a] md:text-[14px]">
            Ces références technologiques ne constituent pas une annonce de
            partenariat officiel. La nature des relations avec Comexa reste à
            compléter.
          </p>
        </div>

        {/* TECHNOLOGIES */}
        <div className="mt-7 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {technologies.map((technology) => (
            <article
              key={technology.name}
              className="flex min-h-[255px] flex-col rounded-[18px] border-[1.5px] border-[#10294a] bg-white p-[19px] shadow-[0_7px_0_#10294a]"
            >

              {/* LOGO PLACEHOLDER */}
              <div className="flex h-[73px] items-center justify-center rounded-[7px] border border-dashed border-[#cbd8e7] bg-[#e7f2fc]">
                <div className="text-center">
                  <p className="text-[22px] font-medium text-[#10294a]">
                    {technology.name}
                  </p>

                  <p className="mt-1 text-[13px] text-[#69758a]">
                    Logo officiel à fournir
                  </p>
                </div>
              </div>

              {/* CONTENT */}
              <div className="mt-4">

                <p className="text-[12px] uppercase text-[#69758a]">
                  {technology.category}
                </p>

                <h3 className="mt-2 text-[20px] font-medium leading-none text-[#10294a]">
                  {technology.name}
                </h3>

                <p className="mt-2 min-h-[38px] text-[15px] leading-[1.5] text-[#69758a]">
                  {technology.description}
                </p>

              </div>

              {/* WEBSITE */}
              <div className="mt-auto border-t border-[#d9e0e8] pt-3">
                <a
                  href={`https://${technology.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between text-[14px] font-medium text-[#10294a] underline underline-offset-2"
                >
                  <span>{technology.website}</span>
                  <span className="text-[13px] no-underline">
                    ↗
                  </span>
                </a>
              </div>

            </article>
          ))}
        </div>

        {/* FOOTNOTE */}
        <p className="mt-7 text-[15px] leading-[1.5] text-[#69758a]">
          Descriptions et sites éditeurs proposés à titre informatif, à
          valider avant publication. Relations avec Comexa à compléter ;
          logos officiels à fournir.
        </p>

      </div>
    </section>
 

      <section className="scroll-reveal section-reveal-delay-2 w-full border-b-2 border-[#168fe5] bg-[#0d2b4d] px-5 py-14 text-white md:px-10 lg:px-[54px]">
      <div className="mx-auto max-w-[1100px]">

        {/* HEADER */}
        <div className="flex flex-col justify-between gap-7 md:flex-row md:items-end">

          <div>
            <span className="inline-flex rounded-[7px] bg-[#168fe5] px-3 py-[7px] text-[11px] font-medium uppercase text-[#08203e]">
              ILS EN PARLENT
            </span>

            <h2 className="mt-5 max-w-[650px] text-[clamp(1.8rem,5vw,2.375rem)] font-medium leading-[1.08] tracking-[-1px]">
              Des collaborations qui restent
              <br />
              simples et humaines.
            </h2>
          </div>

          <p className="max-w-[310px] text-[11px] leading-[1.6] text-[#b9c8d9]">
            Les témoignages de notre accueil, associés aux projets
            correspondants. La relation compte autant que le résultat.
          </p>

        </div>

        {/* CARDS */}
        <div className="mt-9 grid grid-cols-1 gap-5 md:grid-cols-3">

          {testimonials.map((testimonial) => (
            <article
              key={`${testimonial.name}-${testimonial.project}`}
              className="flex min-h-[310px] flex-col rounded-[22px] border border-[#91b1cf] bg-[#163958] p-6"
            >

              {/* PROJECT + QUOTE */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#c4d2e1]">
                  {testimonial.project}
                </span>

                <span className="text-[23px] font-bold leading-none text-[#168fe5]">
                  “
                </span>
              </div>

              {/* TEXT */}
              <p className="mt-8 text-[15px] font-normal leading-[1.55] text-white">
                {testimonial.text}
              </p>

              {/* AUTHOR */}
              <div className="mt-auto border-t border-[#55748f] pt-5">

                <div className="flex items-center gap-3">

                  <div className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-[#edf4fa] text-[9px] font-medium text-[#163958]">
                    {testimonial.initials}
                  </div>

                  <div>
                    <p className="text-[11px] font-medium text-white">
                      {testimonial.name}
                    </p>

                    <p className="mt-[2px] text-[8px] text-[#9db4c9]">
                      {testimonial.role}
                    </p>
                  </div>

                </div>

              </div>

            </article>
          ))}

        </div>

        {/* FOOTNOTE */}
        <p className="mt-8 text-[9px] text-[#9db4c9]">
          Témoignages repris de l’accueil Comexa.
        </p>

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