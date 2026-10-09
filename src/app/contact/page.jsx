'use client';
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
export default function Contact() {
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
    const currentPageLabel = pageLabels[pathname] ?? "Contact";
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

     const [projectType, setProjectType] = useState("Site vitrine");

  const projectTypes = [
    "Site vitrine",
    "E-commerce",
    "Application web",
    "Refonte",
    "Autre",
  ];
  const [openIndex, setOpenIndex] = useState(0);

  const questions = [
    {
      number: "01",
      question: "Quels types de sites développez-vous ?",
      answer:
        "Sites vitrines, boutiques e-commerce et applications web sur mesure : nous concevons des outils adaptés à vos usages. Nous intervenons aussi sur la refonte ou l’évolution d’un site existant.",
    },
    {
      number: "02",
      question: "Comment obtenir un devis pour mon projet ?",
      answer:
        "Décrivez votre besoin dans le formulaire. Après un premier échange pour cadrer les objectifs, les fonctionnalités et les contraintes, nous vous proposons un devis détaillé. Le coût dépend du périmètre, pas d’un forfait imposé.",
    },
    {
      number: "03",
      question: "Quels sont les délais de réalisation ?",
      answer:
        "Ils varient selon la taille du projet, les fonctionnalités et la disponibilité des contenus. Nous définissons ensemble un calendrier réaliste avant de démarrer, avec des étapes de validation et une date de mise en ligne partagée.",
    },
    {
      number: "04",
      question: "Que dois-je fournir pour démarrer ?",
      answer:
        "Vos objectifs, votre identité visuelle, vos textes et vos images sont un bon point de départ. Si tout n’est pas prêt, nous vous aidons à organiser les éléments manquants et à prioriser ce qui est nécessaire.",
    },
    {
      number: "05",
      question: "Proposez-vous un suivi après la mise en ligne ?",
      answer:
        "Oui, nous pouvons assurer la maintenance, les mises à jour de sécurité et l’optimisation des performances. Un accompagnement adapté à votre site permet aussi d’ajouter de nouvelles fonctionnalités au fil de vos besoins.",
    },
  ];

  const toggleQuestion = (index) => {
    setOpenIndex(openIndex === index ? -1 : index);
  };

  return (
    <main className="min-h-screen bg-[#f5f7fa] text-[#10294a]">

      <section className="scroll-reveal">
        <div className="mx-auto max-w-[1300px] px-5 pb-10 pt-8 sm:px-6 md:px-10 md:pt-10">

       
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
          <div className="mt-8 flex flex-col items-start justify-between gap-8 md:flex-row md:items-center md:gap-10">

            <div className="scroll-slide-left w-full max-w-[650px]">
              <span className="inline-flex rounded-lg bg-[#168fe5] px-3 py-1.5 text-[11px] font-medium text-[#08203e]">
                NAVIGUER LE DIGITAL ENSEMBLE
              </span>

              <h1 className="mt-5 text-[clamp(2.25rem,8vw,3.25rem)] font-medium leading-[1.08] tracking-[-1.5px]">
                Votre prochain cap web
                <br />
                commence ici.
              </h1>

              <p className="mt-4 w-full max-w-[620px] text-[15px] leading-[1.65] text-[#69758a]">
                Une idée, une refonte, un besoin technique ? Parlez-nous de
                votre projet.
                <br className="hidden md:block" />
                Ensemble, donnons-lui une direction claire.
              </p>
            </div>

            {/* Illustration */}
            <div className="scroll-slide-right relative hidden h-[190px] w-[320px] md:block">

              <div className="absolute left-[35px] top-[0px] h-[188px] w-[188px] rounded-full border border-[#2490e8]" />

              <div className="absolute right-0 top-[35px] h-6 w-6 rotate-45 rounded-[3px] bg-[#50afe8]" />

              <div className="absolute left-[0px] top-[25px] h-[95px] w-[220px] rounded-[20px] border-2 border-[#10294a] bg-white p-4 shadow-[5px_7px_0_#10294a]">
                <div className="flex items-center gap-2 text-[11px] font-medium">
                  <span className="text-[19px]">◯</span>
                  Et si on en parlait ?
                </div>

                <div className="mt-3 h-1.5 w-[85%] rounded-full bg-[#e8f1fa]" />
                <div className="mt-3 h-1.5 w-[58%] rounded-full bg-[#e8f1fa]" />
              </div>

              <div className="absolute bottom-[0px] right-[10px] flex h-[43px] w-[174px] items-center justify-between rounded-[12px] border-2 border-[#10294a] bg-[#168fe5] px-4 text-[12px] font-medium shadow-[4px_5px_0_#10294a]">
                <span>Prenons le bon cap.</span>
                <span>↗</span>
              </div>

              <div className="absolute bottom-[17px] left-[8px] h-2 w-2 rounded-full bg-[#10294a]" />
            </div>
          </div>
        </div>
      </section>

      <section className="scroll-reveal section-reveal-delay-1 mx-auto max-w-[1200px] px-5 py-2 md:px-10">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_310px]">

          <div className="reveal-card reveal-card-delay-1 min-w-0 rounded-[20px] border border-[#10294a] bg-white p-5 shadow-[5px_7px_0_#10294a] sm:p-6 md:p-7">

            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[clamp(1.65rem,5vw,1.875rem)] font-medium">
                  Parlons de votre projet
                </h2>

                <p className="mt-2 text-[15px] text-[#69758a]">
                  Quelques lignes suffisent pour commencer. Les champs marqués
                  * sont obligatoires.
                </p>
              </div>

              <span className="text-[20px]">↗</span>
            </div>

            <form className="mt-5 space-y-4">

              {/* Nom + Email */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

                <div>
                  <label className="mb-1.5 block text-[17px] font-medium">
                    Nom complet *
                  </label>

                  <input
                    type="text"
                    placeholder="Votre prénom et votre nom"
                    className="h-11 w-full min-w-0 rounded-[7px] border border-[#10294a] bg-[#f7f9fc] px-3 text-[16px] outline-none transition focus:border-[#168fe5] sm:px-4 sm:text-[18px]"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[17px] font-medium">
                    E-mail *
                  </label>

                  <input
                    type="email"
                    placeholder="vous@entreprise.fr"
                    className="h-11 w-full min-w-0 rounded-[7px] border border-[#10294a] bg-[#f7f9fc] px-3 text-[16px] outline-none transition focus:border-[#168fe5] sm:text-[18px]"
                  />
                </div>

              </div>

              {/* Entreprise */}
              <div>
                <label className="mb-1.5 block text-[17px] font-medium">
                  Entreprise{" "}
                  <span className="font-normal text-[#69758a]">
                    (facultatif)
                  </span>
                </label>

                <input
                  type="text"
                  placeholder="Le nom de votre organisation"
                  className="h-11 w-full min-w-0 rounded-[7px] border border-[#10294a] bg-[#f7f9fc] px-3 text-[16px] outline-none transition focus:border-[#168fe5] sm:text-[18px]"
                />
              </div>

              {/* Type de projet */}
              <div>
                <label className="mb-2 block text-[17px] font-medium">
                  Type de projet *
                </label>

                <div className="flex flex-wrap gap-2">
                  {projectTypes.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setProjectType(type)}
                      className={`flex items-center gap-2 rounded-full border px-3 cursor-pointer py-1.5 text-[13px] transition ${
                        projectType === type
                          ? "border-[#168fe5] text-[#10294a]"
                          : "border-[#cbd3df] bg-white"
                      }`}
                    >
                      <span
                        className={`flex h-3 w-3 items-center justify-center rounded-full border ${
                          projectType === type
                            ? "border-[#168fe5]"
                            : "border-[#9ba7b8]"
                        }`}
                      >
                        {projectType === type && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[#168fe5]" />
                        )}
                      </span>

                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[17px] font-medium">
                  Votre message *
                </label>

                <textarea
                  rows={5}
                  placeholder="Votre contexte, vos objectifs, les fonctionnalités souhaitées... Si vous avez un budget ou un calendrier en tête, dites-le-nous aussi."
                  className="w-full resize-none rounded-[7px] border border-[#10294a] bg-[#f7f9fc] px-3 py-3 text-[13px] leading-[1.5] outline-none transition focus:border-[#168fe5]"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-2 text-[10px] text-[#69758a]">
                <input
                  type="checkbox"
                  className="mt-[1px] h-4 w-4 accent-[#168fe5]"
                />

                <span>
                  J’accepte que Comexa utilise mes informations pour répondre à
                  ma demande. *
                  <span className="ml-1 underline">
                    Politique de confidentialité
                  </span>
                </span>
              </label>

            
              <div className="flex flex-col justify-between gap-4 pt-2 sm:flex-row sm:items-center">

                <div className="flex gap-2 text-[12px] leading-[1.5] text-[#69758a]">
                  <span className="text-[15px]">♙</span>

                  <p>
                    Vos informations restent confidentielles.
                    <br />
                    Aucun démarchage, juste un échange.
                  </p>
                </div>

                <button
                  type="submit"
                  className="flex h-10 items-center justify-center gap-3 rounded-[11px] bg-[#168fe5] px-4 text-[15px] font-medium text-[#08203e] transition hover:bg-[#0b7dcc] sm:px-5 sm:text-[17px]"
                >
                  Envoyer ma demande
                  <span>↗</span>
                </button>

              </div>
            </form>
          </div>

        
          <aside className="reveal-card reveal-card-delay-2 space-y-6">

            <div className="rounded-[19px] border border-[#10294a] bg-white p-5 shadow-[5px_7px_0_#10294a]">

              <h2 className="text-[25px] font-medium">
                Un échange en direct ?
              </h2>

              <div className="mt-5 space-y-5">

                <div className="flex gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f3fc]">
                    ✉
                  </div>

                  <div>
                    <p className="text-[10px] text-[#69758a]">
                      Écrivez-nous
                    </p>

                    <p className="mt-1 text-[15px] font-medium">
                      bonjour@comexa.dz
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f3fc]">
                    ♡
                  </div>

                  <div>
                    <p className="text-[10px] text-[#69758a]">
                      Téléphone
                    </p>

                    <p className="mt-1 text-[15px] font-medium">
                      Numéro à renseigner
                    </p>
                  </div>
                </div>

              </div>

              <div className="my-5 border-t border-[#d8dee8]" />

              <h3 className="text-[16px] font-medium">
                Retrouvez Comexa
              </h3>

              <div className="mt-3 space-y-3 text-[14px]">
                <div className="flex justify-between">
                  <span>LinkedIn</span>
                  <span className="text-[12px] text-[#69758a]">
                    Lien à renseigner
                  </span>
                </div>

                <div className="flex justify-between">
                  <span>Instagram</span>
                  <span className="text-[12px] text-[#69758a]">
                    Lien à renseigner
                  </span>
                </div>

                <div className="flex justify-between">
                  <span>Behance</span>
                  <span className="text-[12px] text-[#69758a]">
                    Lien à renseigner
                  </span>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-2 text-[12px] text-[#69758a]">
                <span>⌖</span>
                 Algérie · Projets partout en Algérie et à l’international
              </div>
            </div>

            {/* Après message */}
            <div className="rounded-[19px] border border-[#10294a] bg-[#238dde] p-5 text-[#08203e] shadow-[5px_7px_0_#10294a]">

              <h2 className="text-[20px] font-medium">
                Et après votre message ?
              </h2>

              <div className="mt-5 space-y-4">

                <div className="flex gap-3">
                  <span className="text-[12px] font-medium">01</span>
                  <p className="text-[12px]">
                    Nous prenons connaissance de votre besoin.
                  </p>
                </div>

                <div className="flex gap-3">
                  <span className="text-[12px] font-medium">02</span>
                  <p className="text-[12px]">
                    Nous échangeons pour préciser le périmètre.
                  </p>
                </div>

                <div className="flex gap-3">
                  <span className="text-[12px] font-medium">03</span>
                  <p className="text-[12px]">
                    Vous recevez une proposition adaptée.
                  </p>
                </div>

              </div>
            </div>

          </aside>
        </div>
      </section>
       <section className="scroll-reveal section-reveal-delay-2 mt-10 w-full bg-[#e8f1fb] px-10 py-12 text-[#10294a] md:px-10 lg:px-14">
      <div className="mx-auto max-w-[1180px]">

        {/* HEADER */}
        <div className="mb-6 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <span className="inline-flex rounded-md bg-[#168fe5] px-3 py-1 text-[12px] font-semibold uppercase text-[#08203e]">
              QUESTIONS FRÉQUENTES
            </span>

            <h2 className="mt-4 max-w-[520px] text-3xl font-medium leading-[1.05] tracking-[-1px] md:text-[34px]">
              Quelques réponses
              <br />
              pour avancer sereinement.
            </h2>
          </div>

          <p className="max-w-[220px] pb-1 text-[12px] leading-[1.5] text-[#69758a]">
            Du premier devis au suivi de votre site, voici ce qu’il faut savoir
            avant de prendre le cap.
          </p>
        </div>

        {/* FAQ */}
        <div className="space-y-8">

          {questions.map((item, index) => {
            const isOpen = openIndex === index;

            return (
              <div
                key={item.number}
                className={`reveal-card reveal-card-delay-${(index % 3) + 1} overflow-hidden rounded-[15px] border border-[#10294a] shadow-[4px_5px_0_#10294a] transition-colors ${
                  isOpen
                    ? "bg-[#238dde] text-[#08203e]"
                    : "bg-white"
                }`}
              >
               
                <button
                  type="button"
                  onClick={() => toggleQuestion(index)}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left md:px-4"
                >
                  <span className="w-[25px] shrink-0 text-[20px] font-medium">
                    {item.number}
                  </span>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-medium md:text-[20px]">
                      {item.question}
                    </h3>

                    {isOpen && (
                      <div className="mt-2 border-t border-[#10294a]/15 pt-2">
                        <p className="max-w-[1050px] text-[13px] leading-[1.6] text-[#173452] md:text-[15px]">
                          {item.answer}
                        </p>
                      </div>
                    )}
                  </div>

                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center text-[16px] transition-transform duration-200 ${
                      isOpen ? "rotate-45" : ""
                    }`}
                  >
                    +
                  </span>
                </button>
              </div>
            );
          })}

        </div>

      
        <div className="mt-5 flex flex-col justify-between gap-3 text-[12px] sm:flex-row sm:items-center">
          <p>
            Votre question n’est pas ici ?{" "}
            <span className="font-medium">
              Parlons-en simplement.
            </span>
          </p>

          <a
            href="mailto:bonjour@comexa.dz"
            className="font-medium underline underline-offset-2"
          >
            Écrire à bonjour@comexa.dz&nbsp; ↗
          </a>
        </div>

      </div>
    </section>
    </main>
  );
}