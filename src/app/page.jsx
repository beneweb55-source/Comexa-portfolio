"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import quisommesnous from "../../public/image.png";
import quisommesnous1 from "../../public/image-copy-2.png";

export default function Home() {
  const [selectedNeed, setSelectedNeed] = useState("Site vitrine");

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

    const services = [
    {
      number: "01",
      title: "Sites vitrines",
      description:
        "Une présence claire, distinctive et pensée pour convertir vos visiteurs en prises de contact qualifiées.",
      tags: ["Design sur mesure", "CMS simple"],
      icon: "▤",
      style: "light",
    },
    {
      number: "02",
      title: "E-commerce",
      description:
        "Des parcours d’achat fluides, une administration fiable et les intégrations utiles à votre activité.",
      tags: ["Catalogue", "Paiement sécurisé"],
      icon: "▣",
      style: "blue",
    },
    {
      number: "03",
      title: "Applications web",
      description:
        "Des outils métiers et plateformes performants, développés autour de vos usages réels.",
      tags: ["Interfaces métier", "API & données"],
      icon: "▣",
      style: "dark",
    },
    {
      number: "04",
      title: "Maintenance & optimisation",
      description:
        "Un suivi continu pour garder votre produit web rapide, sécurisé et agréable à faire évoluer.",
      tags: ["Support", "Performance"],
      icon: "⌁",
      style: "white",
    },
    
  ];
 const steps = [
    {
      number: "01",
      title: "Cadrer",
      description:
        "Objectifs, utilisateurs, contexte et contraintes : nous alignons le cap avant de produire.",
    },
    {
      number: "02",
      title: "Concevoir",
      description:
        "Nous donnons forme aux parcours et à l’interface, avec des validations simples et régulières.",
      active: true,
    },
    {
      number: "03",
      title: "Développer",
      description:
        "Le produit prend vie sur une base propre, testée et documentée.",
    },
    {
      number: "04",
      title: "Accompagner",
      description:
        "Mise en ligne, prise en main et évolutions : la relation continue après la livraison.",
    },
  ];

  const testimonials = [
    {
      initials: "CR",
      name: "Claire Renaud",
      role: "Associée, Atelier Nord",
      text: "Comexa a su challenger nos idées sans jamais perdre de vue nos contraintes. Le nouveau site ressemble enfin à notre cabinet.",
    },
    {
      initials: "ML",
      name: "Mehdi Laurent",
      role: "Responsable opérations, Oryon",
      text: "Une équipe disponible, très claire sur les arbitrages techniques, et un outil adopté naturellement par nos collaborateurs.",
      active: true,
    },
    {
      initials: "LM",
      name: "Lucie Morel",
      role: "Fondatrice, Comptoir Local",
      text: "Nous avons gagné en autonomie sur le catalogue et le parcours d’achat est beaucoup plus cohérent avec notre façon de vendre.",
    },
  ];

  const partners = [
    "△ Vercel",
    "⬡ Strapi",
    "♧ Shopify",
    "▤ PostgreSQL",
    "⌁ Scalango",
    "⌘ Figma",
  ];
   const projects = [
    {
      category: "ARCHITECTURE",
      title: "Atelier Noroît — rendre l’architecture lisible et sensible.",
      description:
        "Refonte du site éditorial d’un studio d’architecture : projets mieux structurés, navigation sobre et publication facilitée pour l’équipe.",
      image: quisommesnous1,
      type: "large",
      footer: "Direction UX · Développement front-end · CMS",
      dark: false,
    },
    {
      category: "E-COMMERCE",
      title: "Comptoir Local",
      description:
        "Une boutique en ligne chaleureuse, avec un catalogue clarifié et un parcours de commande sans friction.",
      image: quisommesnous,
      type: "small",
      footer: "UX/UI · E-commerce · Connexions métier",
      dark: false,
    },
    {
      category: "APPLICATION WEB",
      title: "Oryon Pilot",
      description:
        "Un outil métier qui rassemble le suivi des dossiers, les échanges et les échéances dans une seule interface.",
      image: quisommesnous1,
      type: "small",
      footer: "Product design · Application web · API",
      dark: true,
    },
  ];
  return (
    <main className=" bg-[#F7F8FA] text-[#10182B]">
      <section className="scroll-reveal mx-auto flex max-w-300 items-center px-6 py-16 lg:px-0">

        <div className="grid w-full items-center gap-14 lg:grid-cols-2">


          <div className="scroll-slide-left max-w-142.5">

            <div className="mb-7 flex items-center gap-3">
              <div className="flex gap-1.75">
                <span className="h-1.5 w-1.5 rounded-full bg-[#10182B]" />
                <span className="h-1.5 w-1.5 rounded-full bg-[#10182B]" />
                <span className="h-1.5 w-1.5 rounded-full bg-[#2864E8]" />
                <span className="h-1.5 w-1.5 rounded-full bg-[#10182B]" />
                <span className="h-1.5 w-1.5 rounded-full bg-[#10182B]" />
              </div>

              <span className="text-[10px] font-semibold uppercase tracking-[-0.1px] text-[#2864E8]">
                Naviguer le digital ensemble
              </span>
            </div>


            <h1 className="max-w-[680px] text-[42px] font-semibold leading-[1] tracking-[-1.8px] sm:text-[52px] lg:text-[58px]">
              Le web qui

              avance avec

              votre entreprise.
            </h1>


            <p className="mt-7 max-w-127.5 text-[15px] leading-[1.55] text-[#667085]">
              Comexa conçoit et développe des sites et applications web
              clairs, performants et faciles à faire évoluer. De l’idée à la
              mise en ligne, vous gardez le cap.
            </p>


            <div className="mt-6 flex flex-wrap gap-3">

              <a
                href="#contact"
                className="flex h-11.25 items-center gap-4 rounded-lg bg-[#2864E8] px-5 text-sm font-semibold text-white transition hover:bg-[#1E54CE]"
              >
                <span>Demander un devis</span>
                <span className="text-base">↗</span>
              </a>

              <a
                href="#realisations"
                className="flex h-11.25 items-center gap-4 rounded-lg bg-white px-5 text-sm font-semibold text-[#172033] shadow-[0_1px_3px_rgba(16,24,40,0.04)] transition hover:bg-[#EEF2F7]"
              >
                <span>Voir nos réalisations</span>
                <span className="text-base">↗</span>
              </a>

            </div>


            <div className="mt-6 flex flex-wrap items-center gap-4 text-[10px] text-[#7B8496]">

              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#22A866]" />
                <span>Un interlocuteur dédié</span>
              </div>

              <span className="h-4 w-px bg-[#D9DDE5]" />

              <span>
                Conception · Développement · Suivi
              </span>

            </div>
          </div>


          <div className="scroll-slide-right relative flex min-h-97.5 items-center justify-center">
            <Image
              src={quisommesnous}
              alt="Comexa"
              width={600}
              height={600}
              priority
            />
          </div>
        </div>
      </section>
      <section className="scroll-reveal section-reveal-delay-1 w-full border-y border-dotted border-[#1E86E0] bg-[#0D172B]">
        <div className="mx-auto flex min-h-[62px] max-w-[1200px] flex-col items-start justify-center gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-0 lg:px-0">


          <div className="w-50 shrink-0">
            <p className="text-[10px] font-medium leading-4 text-[#D9E2F2]">
              Une expertise 100 % développement
              <br />
              web
            </p>
          </div>


          <ul className="flex flex-1 items-center justify-between">
            <li className="text-8 font-medium text-white transition-colors duration-200 hover:text-[#4FB0F0]"
            >Stratégie</li>
            <li className="text-8 font-medium text-white transition-colors duration-200 hover:text-[#4FB0F0]">UX / UI</li>
            <li className="text-8 font-medium text-white transition-colors duration-200 hover:text-[#4FB0F0]">Front-end</li>
            <li className="text-8 font-medium text-white transition-colors duration-200 hover:text-[#4FB0F0]">Back-end</li>
            <li className="text-8 font-medium text-white transition-colors duration-200 hover:text-[#4FB0F0]"> Optimisation</li>

          </ul>

        </div>
      </section>

      <section
        id="agence"
        className="scroll-reveal section-reveal-delay-2 w-full bg-white"
      >
        <div className="mx-auto flex max-w-[1200px] flex-col items-start gap-10 px-5 py-14 sm:px-8 md:gap-14 md:py-20 lg:flex-row lg:items-center lg:px-0">
          <Image
            src={quisommesnous1}
            alt="Comexa"
            width={500}
            height={500}
            priority
          />


          <div>


            <span className=" rounded-[5px] bg-[#2864E8] px-3 py-[6px] text-[8px] font-medium uppercase text-white">
              Qui sommes-nous ?

            </span>


            <h2 className="mt-5 text-26 font-semibold leading-[1.02] tracking-[-1.5px] text-[#10182B] sm:text-[40px]">
              Un partenaire technique qui
              <br />
              parle votre langage.
            </h2>


            <p className="mt-5 max-w-[570px] text-[16px] leading-[1.65] text-[#697386]">
              Comexa est une agence entièrement dédiée au développement web.
              Nous transformons un besoin métier en une expérience numérique
              utile, compréhensible et robuste — sans jargon inutile, ni
              solution surdimensionnée.
            </p>


            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-[9px] font-medium text-[#10182B]">

              <div className="flex items-center gap-2">
                <span className="flex h-[13px] w-[13px] items-center justify-center rounded-full border border-[#2864E8] text-[8px] text-[#2864E8]">
                  ✓
                </span>
                Écoute active
              </div>

              <div className="flex items-center gap-2">
                <span className="flex h-[13px] w-[13px] items-center justify-center rounded-full border border-[#2864E8] text-[8px] text-[#2864E8]">
                  ✓
                </span>
                Choix transparents
              </div>

              <div className="flex items-center gap-2">
                <span className="flex h-[13px] w-[13px] items-center justify-center rounded-full border border-[#2864E8] text-[8px] text-[#2864E8]">
                  ✓
                </span>
                Code maintenable
              </div>

            </div>

            <a
              href="#contact"
              className="mt-5 inline-flex h-[40px] items-center gap-4 rounded-xl border-[1.5px] border-[#10182B] bg-white px-4 text-[14px] font-semibold text-[#10182B] transition hover:bg-[#10182B] hover:text-white"
            >
              Découvrir notre approche
              <span className="text-[14px]">↗</span>
            </a>

          </div>
        </div>
      </section>
      <section className="scroll-reveal section-reveal-delay-3 w-full bg-[#f5f6f8] px-5 py-16 md:px-10 lg:px-14">
      <div className="mx-auto max-w-[1180px]">
        <div className="mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <span className="inline-flex rounded-md bg-[#2864f6] px-3 py-1 text-[12px] font-medium uppercase tracking-wide text-white">
              NOS SERVICES
            </span>

            <h2 className="mt-4 max-w-[650px] text-[30px] font-bold leading-[1.02] tracking-[-1.5px] text-[#101a30] md:text-[38px]">
              Tout ce qu’il faut pour
              <br />
              construire et faire vivre votre
              <br />
              projet web.
            </h2>
          </div>

          <p className="max-w-[230px] pb-1 text-[10px] leading-[1.55] text-[#737b8d] ">
            Un périmètre volontairement clair : nous concevons, développons et
            améliorons des produits web.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-7 md:grid-cols-2">
          {services.map((service) => (
            <div
              key={service.number}
              className={`group relative min-h-[180px] overflow-hidden rounded-[17px] border border-[#101a30] p-4 shadow-[5px_5px_0_#101a30] transition-transform duration-200 hover:-translate-y-1 ${
                service.style === "light"
                  ? "bg-[#e8efff] text-[#101a30]"
                  : service.style === "blue"
                    ? "bg-gradient-to-r from-blue-900 to-blue-700 text-white"
                    : service.style === "dark"
                      ? "bg-[#101a30] text-white"
                      : "bg-white text-[#101a30]"
              }`}
            >
              <div className="flex items-start justify-between">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-lg text-10 ${
                    service.style === "blue" || service.style === "dark"
                      ? "bg-white text-[#2864f6]"
                      : "bg-white text-[#101a30]"
                  }`}
                >
                  {service.icon}
                </div>

                <span
                  className={`text-[12px] font-medium ${
                    service.style === "blue" || service.style === "dark"
                      ? "text-white"
                      : "text-[#566076]"
                  }`}
                >
                  {service.number}
                </span>
              </div>

              <div className="mt-6">
                <h3 className="text-[22px] font-bold">
                  {service.title}
                </h3>

                <p
                  className={`mt-2 max-w-[500px] text-[10px] leading-[1.55] ${
                    service.style === "blue" || service.style === "dark"
                      ? "text-white/75"
                      : "text-[#737b8d]"
                  }`}
                >
                  {service.description}
                </p>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                {service.tags.map((tag) => (
                  <span
                    key={tag}
                    className={`rounded-full border px-2 py-1 text-[10px] font-medium ${
                      service.style === "blue" || service.style === "dark"
                        ? "border-white/50 text-white"
                        : "border-[#101a30] text-[#101a30]"
                    }`}
                  >
                    {tag}
                  </span>
                ))}
              </div>

              {service.style === "white" && (
                <div className="absolute bottom-0 right-0 h-full w-[4px] bg-[#2864f6]" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  <section className="scroll-reveal section-reveal-delay-4 w-full bg-[#e8efff] px-5 py-14 md:px-10 lg:px-14">
      <div className="mx-auto max-w-[1180px]">

        {/* HEADER */}
        <div className="mb-7 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <span className="inline-flex rounded-md bg-[#2864f6] px-3 py-1 text-[10px] font-semibold uppercase text-white">
              PROJETS RÉCENTS
            </span>

            <h2 className="mt-4 max-w-[620px] text-[30px] font-bold leading-[1.02] tracking-[-1.5px] text-[#101a30] md:text-[38px]">
              Des réalisations pensées pour
              <br />
              les usages, pas pour la
              <br />
              galerie.
            </h2>
          </div>

          <p className="max-w-[230px] pb-1 text-[10px] leading-[1.55] text-[#737b8d]">
            Chaque projet associe exigence visuelle, solidité technique et
            autonomie pour les équipes qui le font vivre.
          </p>
        </div>

        {/* PROJECTS */}
        <div className="space-y-3">

          {/* GRAND PROJET */}
          <article className="overflow-hidden rounded-[18px] border border-[#101a30] bg-white shadow-[5px_5px_0_#101a30]">
            <div className="grid md:grid-cols-[1.08fr_0.92fr]">

              {/* IMAGE */}
              <div className="h-[250px] overflow-hidden md:h-[250px]">
                <Image
                  src={projects[0].image}
                  alt={projects[0].title}
                  width={800}
                  height={500}
                  sizes="(min-width: 768px) 54vw, 100vw"
                  className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                />
              </div>

              {/* CONTENT */}
              <div className="flex flex-col justify-between p-5 md:p-6">
                <div>
                  <div className="flex items-start justify-between">
                    <span className="rounded-full bg-[#e8efff] px-2 py-1 text-[10px] font-bold uppercase text-[#101a30]">
                      {projects[0].category}
                    </span>

                    <span className="text-[14px] text-[#101a30]">
                      ↗
                    </span>
                  </div>

                  <h3 className="mt-7 text-[20px] font-bold leading-[1.15] text-[#101a30] md:text-[25px]">
                    {projects[0].title}
                  </h3>

                  <p className="mt-3 max-w-[410px] text-[12px] leading-[1.6] text-[#737b8d]">
                    {projects[0].description}
                  </p>
                </div>

                <p className="mt-7 text-[10px] font-semibold text-[#101a30]">
                  {projects[0].footer}
                </p>
              </div>
            </div>
          </article>

          {/* DEUX PETITS PROJETS */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">

            {projects.slice(1).map((project) => (
              <article
                key={project.title}
                className={`overflow-hidden rounded-[18px] border border-[#101a30] shadow-[5px_5px_0_#101a30] ${
                  project.dark
                    ? "bg-[#2864f6] text-white"
                    : "bg-white text-[#101a30]"
                }`}
              >
                {/* IMAGE */}
                <div className="h-[165px] overflow-hidden">
                  <Image
                    src={project.image}
                    alt={project.title}
                    width={500}
                    height={300}
                    sizes="(min-width: 768px) 46vw, 100vw"
                    className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                  />
                </div>

                {/* CONTENT */}
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${
                        project.dark
                          ? "bg-white text-[#2864f6]"
                          : "bg-[#e8efff] text-[#101a30]"
                      }`}
                    >
                      {project.category}
                    </span>

                    <span className="text-[13px]">
                      ↗
                    </span>
                  </div>

                  <h3 className="mt-5 text-[20px] font-bold">
                    {project.title}
                  </h3>

                  <p
                    className={`mt-2 min-h-[42px] text-[10px] leading-[1.6] ${
                      project.dark
                        ? "text-white/75"
                        : "text-[#737b8d]"
                    }`}
                  >
                    {project.description}
                  </p>

                  <p
                    className={`mt-5 text-[10px] font-semibold ${
                      project.dark
                        ? "text-white"
                        : "text-[#101a30]"
                    }`}
                  >
                    {project.footer}
                  </p>
                </div>
              </article>
            ))}

          </div>
        </div>

        {/* BOTTOM */}
        <div className="mt-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-[12px] font-medium text-[#101a30]">
            Votre projet mérite la même attention, quelle que soit sa taille.
          </p>

          <button className="flex items-center gap-3 rounded-[9px] bg-[#101a30] px-4 py-2.5 cursor-pointer text-[13px] font-semibold text-white transition hover:bg-[#18243d]">
            Explorer toutes les réalisations
            <span>↗</span>
          </button>
        </div>

      </div>
    </section>
 <section className="scroll-reveal section-reveal-delay-5 w-full">
     
      <div className="bg-[#101a30] px-5 py-14 text-white md:px-10 lg:px-14">
        <div className="mx-auto max-w-[1180px]">
          <div className="mb-7 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <span className="inline-flex rounded-md bg-[#2864f6] px-3 py-1 text-[12px] font-medium uppercase tracking-wide text-white">
                NOTRE MÉTHODE
              </span>

              <h2 className="mt-9 max-w-[600px] text-[30px] font-bold leading-[1.02] tracking-[-1.5px] md:text-[38px]">
                Un projet lisible, du premier
                <br />
                atelier à la mise en ligne.
              </h2>
            </div>

            <p className="max-w-[230px] text-[11px] leading-[1.55] text-white/60">
              Des étapes courtes, des décisions partagées et un suivi régulier :
              vous savez toujours où en est le projet.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((step) => (
              <div
                key={step.number}
                className={`relative flex min-h-[134px] flex-col rounded-[17px] border border-[#8b9bb9] p-3 ${
                  step.active
                    ? "bg-[#2864f6] border-[#2864f6]"
                    : "bg-[#18243d]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[15px] text-white/80">
                    {step.number}
                  </span>

                  <span className="h-[5px] w-[5px] rounded-full bg-[#2864f6]" />
                </div>

                <div className="mt-auto">
                  <h3 className="text-[20px] font-bold">{step.title}</h3>

                  <p className="mt-1 text-[13px] leading-[1.55] text-white/65">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

     
      <div className="bg-[#f5f6f8] px-5 py-14 md:px-10 lg:px-14">
        <div className="mx-auto max-w-[1180px]">
          <div className="mb-7 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <span className="inline-flex rounded-md bg-[#2864f6] px-3 py-1 text-[12px] font-medium uppercase tracking-wide text-white">
                ILS EN PARLENT
              </span>

              <h2 className="mt-4 max-w-[600px] text-[30px] font-bold leading-[1.02] tracking-[-1.5px] text-[#101a30] md:text-[38px]">
                Des collaborations qui restent
                <br />
                simples et humaines.
              </h2>
            </div>

            <p className="max-w-[230px] text-[11px] leading-[1.55] text-[#737b8d]">
              Nos clients apprécient autant la qualité du résultat que la clarté
              du chemin pour y arriver.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {testimonials.map((testimonial) => (
              <div
                key={testimonial.name}
                className={`relative flex min-h-[168px] flex-col rounded-[17px] border border-[#101a30] p-4 shadow-[5px_5px_0_#2864f6] ${
                  testimonial.active
                    ? "bg-[#2864f6] text-white"
                    : "bg-white text-[#101a30]"
                }`}
              >
                <div
                  className={`text-[22px] font-bold ${
                    testimonial.active
                      ? "text-white"
                      : "text-[#2864f6]"
                  }`}
                >
                  “
                </div>

                <p
                  className={`mt-3 text-[15px] font-medium leading-[1.65] ${
                    testimonial.active
                      ? "text-white"
                      : "text-[#101a30]"
                  }`}
                >
                  {testimonial.text}
                </p>

                <div className="mt-auto flex items-center gap-2 pt-4">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${
                      testimonial.active
                        ? "bg-white text-[#101a30]"
                        : "bg-[#edf1f8] text-[#101a30]"
                    }`}
                  >
                    {testimonial.initials}
                  </div>

                  <div>
                    <p className="text-[10px] font-bold">
                      {testimonial.name}
                    </p>

                    <p
                      className={`text-[8px] ${
                        testimonial.active
                          ? "text-white/70"
                          : "text-[#737b8d]"
                      }`}
                    >
                      {testimonial.role}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#737b8d]">
              PARTENAIRES & TECHNOLOGIES DE CONFIANCE
            </p>

            <div className="mt-3 border-t border-[#d8dce4]" />

            <div className="grid grid-cols-2 gap-y-5 pt-4 sm:grid-cols-3 md:grid-cols-6">
              {partners.map((partner) => (
                <div
                  key={partner}
                  className="flex items-center gap-2 text-[16px] font-semibold text-[#101a30]"
                >
                  {partner}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>

    <section className="scroll-reveal section-reveal-delay-5 w-full bg-[#2864f6] px-5 py-12 md:px-10 lg:px-14">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-10 lg:flex-row lg:items-center lg:justify-between">

        {/* LEFT */}
        <div className="w-full lg:max-w-[410px]">
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-[9px] font-semibold uppercase text-[#101a30]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2864f6]" />
            ÉCHANGES SUR VOTRE PROJET
          </span>

          <h2 className="mt-5 text-[32px] font-bold leading-[1.02] tracking-[-1.5px] text-white md:text-[50px]">
            Prêt à prendre le
            <br />
            bon cap ?
          </h2>

          <p className="mt-5 max-w-[340px] text-[14px] leading-[1.65] text-white/75">
            Parlez-nous de votre contexte, de vos priorités et de votre
            calendrier. Nous vous répondons avec une première lecture claire
            de votre besoin.
          </p>

          {/* CONTACT INFOS */}
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#2864f6]">
                ✉
              </div>

              <span className="text-[13px] font-medium text-white">
                bonjour@comexa.dz
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#2864f6]">
                ◉
              </div>

              <span className="text-[13px] font-medium text-white">
                Algérie · Projets partout en Algérie et à l’international
              </span>
            </div>
          </div>

          {/* DECORATION */}
          <div className="relative mt-8 h-16 w-36">
            <div className="absolute left-2 top-4 h-12 w-12 rounded-t-full border-l border-t border-white/80" />
            <div className="absolute left-11 top-4 h-12 w-12 rounded-t-full border-l border-t border-white/80" />

            <div className="absolute left-[112px] top-1 h-4 w-4 rotate-45 rounded-[3px] bg-[#101a30]" />
          </div>
        </div>

        {/* FORM CARD */}
        <div className="w-full max-w-[630px] rounded-[18px] border border-[#101a30] bg-white p-5 text-[#101a30] shadow-[6px_6px_0_#101a30] md:p-6">

          <h3 className="text-[24px] font-bold">
            Parlons de votre projet
          </h3>

          <p className="mt-1 text-[13px] text-[#737b8d]">
            Quelques lignes suffisent pour commencer.
          </p>

          <form className="mt-4 space-y-3">

            {/* NOM / ENTREPRISE */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[14px] font-semibold">
                  Nom
                </label>

                <input
                  type="text"
                  placeholder="Votre nom"
                  className="h-9 w-full rounded-[5px] border border-[#101a30] bg-[#f5f6f8] px-2 text-[14px] outline-none placeholder:text-[#8a92a3] focus:border-[#2864f6]"
                />
              </div>

              <div>
                <label className="mb-1 block text-[14px] font-semibold">
                  Entreprise
                </label>

                <input
                  type="text"
                  placeholder="Votre organisation"
                  className="h-9 w-full rounded-[5px] border border-[#101a30] bg-[#f5f6f8] px-2 text-[14px] outline-none placeholder:text-[#8a92a3] focus:border-[#2864f6]"
                />
              </div>
            </div>

            {/* EMAIL */}
            <div>
              <label className="mb-1 block text-[14px] font-semibold">
                E-mail professionnel
              </label>

              <input
                type="email"
                placeholder="vous@entreprise.com"
                className="h-9 w-full rounded-[5px] border border-[#101a30] bg-[#f5f6f8] px-2 text-[14px] outline-none placeholder:text-[#8a92a3] focus:border-[#2864f6]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[14px] font-semibold">
                Numéro de téléphone


              </label>

              <input
                type="email"
                placeholder="0555555555"
                className="h-9 w-full rounded-[5px] border border-[#101a30] bg-[#f5f6f8] px-2 text-[14px] outline-none placeholder:text-[#8a92a3] focus:border-[#2864f6]"
              />
            </div>

            {/* BESOIN */}
            <div>
              <label className="mb-2 block text-[14px] font-semibold">
                Votre besoin
              </label>

              <div className="flex flex-wrap gap-4">
                {[
                  "Site vitrine",
                  "E-commerce",
                  "Application web",
                  "Maintenance",
                ].map((item) => (
                  <button
                    type="button"
                    key={item}
                    aria-pressed={selectedNeed === item}
                    onClick={() => setSelectedNeed(item)}
                    className={`rounded-full border px-2 py-1 text-[13px] font-medium cursor-pointer ${
                      selectedNeed === item
                        ? "border-[#2864f6] text-[#2864f6]"
                        : "border-[#101a30] text-[#101a30]"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {/* MESSAGE */}
            <div>
              <label className="mb-1 block text-[14px] font-semibold">
                Votre projet
              </label>

              <textarea
                rows={4}
                placeholder="Contexte, objectifs, calendrier..."
                className="w-full resize-none rounded-[5px] border border-[#101a30] bg-[#f5f6f8] px-2 py-2 text-[14px] outline-none placeholder:text-[#8a92a3] focus:border-[#2864f6]"
              />
            </div>

            {/* BOTTOM */}
            <div className="flex flex-col gap-4 pt-1 sm:flex-row sm:items-end sm:justify-between">
              <p className="max-w-[210px] text-[10px] leading-[1.5] text-[#8a92a3]">
                Vos informations restent confidentielles et servent uniquement
                à vous répondre.
              </p>

              <button
                type="submit"
                className="flex h-10 items-center justify-center gap-3 cursor-pointer rounded-[9px] bg-[#101a30] px-6 text-[12px] font-semibold text-white transition hover:bg-[#18243d]"
              >
                Envoyer ma demande
                <span>↗</span>
              </button>
            </div>

          </form>
        </div>
      </div>
    </section>

    

    </main>
  );
}
