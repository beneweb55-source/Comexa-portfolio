'use client';

import Image from "next/image";
import Link from "next/link";

export default function Réalisations() {
  return (
    <section className="scroll-reveal w-full bg-[#f5f7fa] px-[18px] py-10 md:px-8 lg:px-[45px]">
      <div className="mx-auto max-w-[1240px]">

        {/* Breadcrumb */}
        <div className="flex items-center gap-3 text-[14px] text-[#66758c]">
          <span>Accueil</span>
          <span className="text-[18px] text-[#10294a]">›</span>
          <span className="font-medium text-[#10294a]">
            Réalisations
          </span>
        </div>

        {/* Hero */}
        <div className="relative mt-5 min-h-[330px] lg:min-h-[350px]">

          {/* LEFT CONTENT */}
          <div className="relative z-10 max-w-[720px]">

            {/* Label */}
            <span className="inline-flex rounded-[8px] bg-[#168fe5] px-3 py-[7px] text-[10px] font-medium text-[#08203e]">
              NAVIGUER LE DIGITAL ENSEMBLE
            </span>

            {/* Title */}
            <h1 className="mt-6 text-[43px] font-medium leading-[1.03] tracking-[-2px] text-[#10294a] sm:text-[52px] lg:text-[60px]">
              Le bon cap se construit
              <br />
              ensemble.
            </h1>

            {/* Description */}
            <p className="mt-5 max-w-[650px] text-[14px] leading-[1.7] text-[#69758a]">
              Partenaires, technologies et collaborations : découvrez
              l’écosystème qui accompagne notre expertise en développement
              web.
            </p>

            {/* Button */}
            <button className="mt-5 flex items-center gap-4 rounded-[14px] bg-[#168fe5] px-5 py-3.5 text-[13px] font-medium text-[#08203e] transition duration-200 hover:bg-[#0c82d2]">
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


  );
}