"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

export default function Réalisations() {
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
    const currentPageLabel = pageLabels[pathname] ?? "Réalisations";
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

  const projects = [
    {
      category: "Sites vitrines",
      name: "Atelier Noroît",
      image: "/images/atelier-noroit.jpg",
      description:
        "Refonte du site éditorial d’un studio d’architecture : projets mieux structurés, navigation sobre et publication facilitée pour l’équipe.",
      expertise: "Direction UX · Développement front-end · CMS",
    },
    {
      category: "E-commerce",
      name: "Comptoir Local",
      image: "/images/comptoir-local.jpg",
      description:
        "Une boutique en ligne chaleureuse, avec un catalogue clarifié et un parcours de commande sans friction.",
      expertise: "UX/UI · E-commerce · Connexions métier",
    },
    {
      category: "Applications web",
      name: "Oryon Pilot",
      image: "/images/oryon-pilot.jpg",
      description:
        "Un outil métier qui rassemble le suivi des dossiers, les échanges et les échéances dans une seule interface.",
      expertise: "Product design · Application web · API",
    },
  ];

 const cases = [
    {
      number: "01",
      name: "Atelier Noroît",
      image: "/images/atelier-noroit.jpg",
      intro:
        "Refonte du site éditorial d’un studio d’architecture : une expérience plus claire pour présenter les projets et faciliter la publication.",
      need:
        "Le studio avait besoin d’une présentation plus structurée de ses réalisations, tout en conservant une identité sobre et éditoriale.",
      solution:
        "Une interface pensée autour des projets, avec une navigation simplifiée, une hiérarchie claire et un système de publication adapté à l’équipe.",
    },
    {
      number: "02",
      name: "Comptoir Local",
      image: "/images/comptoir-local.jpg",
      intro:
        "Une boutique en ligne chaleureuse, pensée pour rendre le catalogue plus lisible et simplifier le parcours de commande.",
      need:
        "Le catalogue devait être mieux organisé afin de permettre aux visiteurs de trouver rapidement les produits et de passer commande.",
      solution:
        "Une expérience e-commerce plus claire, avec une organisation du catalogue et un parcours d’achat pensé pour limiter les frictions.",
    },
    {
      number: "03",
      name: "Oryon Pilot",
      image: "/images/oryon-pilot.jpg",
      intro:
        "Un outil métier pour centraliser les dossiers, les échanges et les échéances dans une seule interface.",
      need:
        "L’équipe avait besoin de rassembler plusieurs informations et actions métier dans un même espace de travail.",
      solution:
        "Une application web structurée autour du suivi des dossiers, des échanges et des échéances, avec une interface adaptée aux usages quotidiens.",
    },
  ];
  
  return (
    <main className="w-full overflow-hidden">
      <section className="scroll-reveal w-full bg-[#f5f7fa] px-5 py-10 sm:px-6 md:px-8 lg:px-[45px]">
        <div className="mx-auto max-w-[1240px]">

        {/* BREADCRUMB */}
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

        {/* HERO */}
        <div className="relative mt-5 min-h-[250px] sm:min-h-[290px] lg:min-h-[350px]">

          {/* CONTENU GAUCHE */}
          <div className="scroll-slide-left relative z-10 w-full max-w-[720px]">

            {/* LABEL */}
            <span className="inline-flex rounded-[7px] bg-[#168fe5] px-3 py-[6px] text-[11px] font-medium uppercase text-[#08203e]">
              NAVIGUER LE DIGITAL ENSEMBLE
            </span>

            {/* TITRE */}
            <h1 className="mt-6 text-[clamp(2.35rem,8vw,3.75rem)] font-medium leading-[1.03] tracking-[-2px] text-[#10294a]">
              Des projets concrets.
              <br />
              Un cap qui vous
              <br />
              ressemble.
            </h1>

            {/* DESCRIPTION */}
            <p className="mt-5 w-full max-w-[650px] text-[14px] leading-[1.7] text-[#69758a]">
              Sites vitrines, e-commerce et applications web : découvrez nos
              réalisations et les choix qui donnent forme à chaque besoin.
            </p>

            {/* ACTIONS */}
            <div className="mt-5 flex flex-col items-stretch gap-4 sm:flex-row sm:flex-wrap sm:items-center">

              <a
                href="#projets"
                className="flex min-h-[46px] items-center justify-center gap-4 rounded-[14px] bg-[#168fe5] px-5 py-3.5 text-[13px] font-medium text-[#08203e] transition hover:bg-[#0d82d0] sm:w-fit"
              >
                <span>Explorer nos réalisations</span>
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
                  comexa / projets
                </p>

                <h3 className="mt-2 max-w-[120px] text-[14px] font-medium leading-[1.05] text-[#10294a]">
                  Du besoin à
                  <br />
                  l’expérience.
                </h3>

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
    
 <section
      id="projets"
      className="scroll-reveal section-reveal-delay-1 w-full bg-white px-5 py-12 sm:px-6 md:px-10 lg:px-12">
    
      <div className="mx-auto max-w-[1180px]">

        {/* HEADER */}
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <span className="inline-flex rounded-[8px] bg-[#168fe5] px-3 py-[7px] text-[10px] font-medium text-[#08203e]">
              NOS RÉALISATIONS
            </span>

            <h2 className="mt-4 max-w-[570px] text-[clamp(1.8rem,5vw,2.375rem)] font-medium leading-[1.08] tracking-[-1px] text-[#10294a]">
              Trois besoins différents.
              <br />
              La même exigence web.
            </h2>
          </div>

          <p className="max-w-[280px] text-[13px] leading-[1.55] text-[#69758a]">
            Chaque projet associe exigence visuelle, solidité technique et
            autonomie pour les équipes qui le font vivre.
          </p>
        </div>

        {/* FILTERS */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button className="rounded-full border border-[#10294a] bg-[#168fe5] px-4 py-2 text-[12px] font-medium text-[#08203e]">
            ✓ &nbsp;Tous
          </button>

          <button className="rounded-full border border-[#ccd6e2] bg-white px-4 py-2 text-[12px] text-[#10294a]">
            Sites vitrines
          </button>

          <button className="rounded-full border border-[#ccd6e2] bg-white px-4 py-2 text-[12px] text-[#10294a]">
            E-commerce
          </button>

          <button className="rounded-full border border-[#ccd6e2] bg-white px-4 py-2 text-[12px] text-[#10294a]">
            Applications web
          </button>

          <span className="text-[12px] text-[#69758a] sm:ml-auto">
            3 réalisations
          </span>
        </div>

        {/* PROJECT CARDS */}
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project, index) => (
            <article
              key={project.name}
              className={`reveal-card overflow-hidden rounded-[18px] border-[1.5px] border-[#10294a] bg-white shadow-[0_7px_0_#10294a] reveal-card-delay-${index + 1}`}
            >

              {/* IMAGE */}
              <div className="h-[185px] overflow-hidden bg-[#e7f2fc]">
                <img
                  src={project.image}
                  alt={project.name}
                  className="h-full w-full object-cover"
                />
              </div>

              {/* CONTENT */}
              <div className="p-[18px]">

                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-[#e7f2fc] px-3 py-[5px] text-[12px] font-medium text-[#10294a]">
                    {project.category}
                  </span>

                  <span className="text-[15px] text-[#10294a]">
                    ↗
                  </span>
                </div>

                <h3 className="mt-4 text-[20px] font-medium text-[#10294a]">
                  {project.name}
                </h3>

                <p className="mt-2 min-h-[88px] text-[15px] leading-[1.5] text-[#69758a]">
                  {project.description}
                </p>

                <div className="mt-4 border-t border-[#dbe2ea] pt-3">
                  <p className="text-[12px] font-medium text-[#10294a]">
                    {project.expertise}
                  </p>
                </div>

                <a
                  href="#etudes-de-cas"
                  className="mt-5 inline-block text-[14px] font-medium text-[#10294a] underline underline-offset-4"
                >
                  Découvrir le projet en détail
                </a>

              </div>
            </article>
          ))}
        </div>

        <p className="mt-7 text-[15px] leading-[1.5] text-[#69758a]">
          Les études de cas et les détails de chaque projet sont présentés
          ci-dessous.
        </p>

      </div>
    </section>


     <section
      id="etudes-de-cas"
      className="scroll-reveal section-reveal-delay-2 w-full bg-[#e7f2fc] px-5 py-14 md:px-10 lg:px-[54px]"
    >
      <div className="mx-auto max-w-[1180px]">

        {/* HEADER */}
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">

          <div>
            <span className="inline-flex rounded-[7px] bg-[#168fe5] px-3 py-[6px] text-[11px] font-medium uppercase text-[#08203e]">
              ÉTUDES DE CAS
            </span>

            <h2 className="mt-4 text-[clamp(1.8rem,5vw,2.375rem)] font-medium leading-[1.08] tracking-[-1px] text-[#10294a]">
              Derrière l’interface,
              <br />
              un besoin bien compris.
            </h2>
          </div>

          <p className="max-w-[280px] text-[13px] leading-[1.55] text-[#69758a]">
            Chaque réalisation répond à un besoin concret. Découvrez les
            choix faits derrière chaque projet.
          </p>

        </div>

        {/* INFO */}
        <div className="mt-7 rounded-[13px] border border-[#c8d7e6] bg-white px-4 py-3">
          <p className="text-[11px] leading-[1.5] text-[#69758a]">
            Des études de cas pensées pour présenter le contexte, le besoin
            et les solutions mises en place.
          </p>
        </div>

        {/* CASES */}
        <div className="mt-7 space-y-5">

          {cases.map((item) => (
            <article
              key={item.number}
              className="rounded-[18px] border-[1.5px] border-[#10294a] bg-white p-5 shadow-[0_7px_0_#10294a]"
            >

              {/* TOP */}
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[15px] font-medium text-[#10294a]">
                  <span className="mr-1 text-[#168fe5]">
                    {item.number}
                  </span>
                  {item.name}
                </h3>

                <span className="text-[10px] text-[#69758a]">
                  Voir le projet ↗
                </span>
              </div>

              {/* PROJECT */}
              <div className="mt-4 grid gap-5 md:grid-cols-[48%_52%]">

                {/* IMAGE / MOCKUP */}
                <div className="overflow-hidden rounded-[10px] border border-[#b9c9d9] bg-[#f5f7fa]">
                  <img
                    src={item.image}
                    alt={item.name}
                    className="h-[180px] w-full object-cover md:h-[220px]"
                  />
                </div>

                {/* DESCRIPTION */}
                <div className="flex flex-col justify-center">
                  <h4 className="text-[15px] font-medium text-[#10294a]">
                    Le projet, en quelques mots.
                  </h4>

                  <p className="mt-2 text-[14px] leading-[1.5] text-[#69758a]">
                    {item.intro}
                  </p>

                  <p className="mt-3 text-[12px] text-[#69758a]">
                    <span className="font-medium text-[#10294a]">
                      Périmètre :
                    </span>{" "}
                    UX/UI · Développement · Mise en ligne
                  </p>
                </div>

              </div>

              {/* BESOIN / SOLUTION */}
              <div className="mt-4 grid gap-4 md:grid-cols-2">

                <div className="rounded-[10px] bg-[#f5f7fa] p-4">
                  <h4 className="text-[13px] font-medium text-[#10294a]">
                    Le besoin
                  </h4>

                  <p className="mt-2 text-[12px] leading-[1.5] text-[#69758a]">
                    {item.need}
                  </p>
                </div>

                <div className="rounded-[10px] bg-[#d9ebfa] p-4">
                  <h4 className="text-[13px] font-medium text-[#10294a]">
                    La solution
                  </h4>

                  <p className="mt-2 text-[12px] leading-[1.5] text-[#69758a]">
                    {item.solution}
                  </p>
                </div>

              </div>

            </article>
          ))}

        </div>

      </div>
    </section>
    <section className="scroll-reveal section-reveal-delay-3 w-full bg-[#f5f7fa] px-5 py-14 md:px-10 lg:px-[54px]">
      <div className="mx-auto max-w-[1110px]">

        <div className="grid items-center gap-10 lg:grid-cols-[1fr_395px]">

          {/* LEFT */}
          <div className="scroll-slide-left">

            <span className="inline-flex rounded-[7px] bg-[#168fe5] px-3 py-[7px] text-[10px] font-medium uppercase text-[#08203e]">
              UN PROJET EN TÊTE ?
            </span>

            <h2 className="mt-5 max-w-[550px] text-[clamp(1.9rem,5vw,2.6875rem)] font-medium leading-[1.08] tracking-[-1.5px] text-[#10294a]">
              Donnons forme à
              <br />
              votre prochain projet.
            </h2>

            <p className="mt-5 max-w-[540px] text-[15px] leading-[1.7] text-[#69758a]">
              Vous avez un besoin, une idée ou un site à faire évoluer ?
              Parlons de vos objectifs et construisons une expérience web
              claire, utile et durable.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-5">

              <a
                href="/contact"
                className="flex items-center gap-4 rounded-[14px] bg-[#10294a] px-5 py-3.5 text-[16px] font-medium text-white transition hover:bg-[#173b64]"
              >
                <span>Parler de votre projet</span>
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

          <div className="scroll-slide-right relative overflow-hidden rounded-[22px] border-[1.5px] border-[#10294a] bg-[#238dde] p-6 shadow-[0_8px_0_#10294a] md:p-7">

            <div className="absolute left-6 top-6 flex">
              <div className="h-[43px] w-[43px] rounded-full border-[1.5px] border-[#10294a]" />
              <div className="-ml-[10px] h-[43px] w-[43px] rounded-full border-[1.5px] border-[#10294a]" />
            </div>

           
            <div className="absolute right-7 top-7 h-[22px] w-[22px] rotate-45 rounded-[4px] bg-[#10294a]" />

            <div className="relative z-10 mt-[65px]">

              <h3 className="text-[23px] font-medium text-[#08203e]">
                Pour bien commencer.
              </h3>

              <div className="mt-5 space-y-4">

                <div className="flex gap-3">
                  <span className="text-[15px] font-medium text-[#08203e]">
                    01
                  </span>


                  <p className="text-[15px] text-[#08203e]">
                    Vos objectifs et vos priorités.
                  </p>
                </div>

                <div className="flex gap-3">
                  <span className="text-[15px] font-medium text-[#08203e]">
                    02
                  </span>

                  <p className="text-[15px] text-[#08203e]">
                    Les besoins de vos utilisateurs.
                  </p>
                </div>

                <div className="flex gap-3">
                  <span className="text-[15px] font-medium text-[#08203e]">
                    03
                  </span>

                  <p className="text-[15px] text-[#08203e]">
                    Le bon niveau de solution.
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