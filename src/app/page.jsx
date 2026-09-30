import Image from "next/image";
import quisommesnous from "../../public/image.png";
import quisommesnous1 from "../../public/image-copy-2.png";

export default function Home() {
  return (
    <main className=" bg-[#F7F8FA] text-[#10182B]">
      <section className="mx-auto flex max-w-300 items-center px-6 py-16 lg:px-0">

        <div className="grid w-full items-center gap-14 lg:grid-cols-2">


          <div className="max-w-142.5">

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


            <h1 className=" max-w-110 text-8xl font-semibold leading-[0.98] tracking-[-2.5px] sm:text-6xl lg:text-[58px]">
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


          <div className="relative flex min-h-97.5 items-center justify-center">
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
      <section className="w-full border-y border-dotted border-[#1E86E0] bg-[#0D172B]">
        <div className="mx-auto flex min-h-[62px] max-w-[1200px] items-center justify-between gap-8 px-6 lg:px-0">


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
        className="w-full bg-white"
      >
        <div className="mx-auto flex max-w-[1200px] items-center gap-16 px-6 py-20 lg:px-0">
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

    </main>
  );
}
