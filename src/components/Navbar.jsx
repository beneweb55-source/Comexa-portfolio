"use client";

import Image from "next/image";
import logo from "../../public/comexa-logo-horizontal-transparent.png"
export default function Navbar() {
    return (
        <nav className="w-full bg-[#F8F9FC] border-b border-dotted border-[#1683E5]">
            <div className="mx-20 flex h-20  items-center justify-between px-6">


                <a href="/" className="flex items-center">
                    <Image
                        src={logo}
                        alt="Comexa"
                        width={130}
                        height={35}
                        priority
                    />
                </a>



                <div className="flex items-center gap-7">
                    <a
                        href="#agence"
                        className="text-15 font-medium text-[#111827] transition hover:text-[#1E86E0]"
                    >
                        L’agence
                    </a>

                    <a
                        href="#services"
                        className="text-15 font-medium text-[#111827] transition hover:text-[#1E86E0]"
                    >
                        Services
                    </a>

                    <a
                        href="#realisations"
                        className="text-15 font-medium text-[#111827] transition hover:text-[#1E86E0]"
                    >
                        Réalisations
                    </a>

                    <a
                        href="#avis"
                        className="text-15 font-medium text-[#111827] transition hover:text-[#1E86E0]"
                    >
                        Avis
                    </a>


                    <a
                        href="#contact"
                        className="ml-2 flex h-10 items-center gap-3 rounded-lg border border-[#0B2545] px-5 text-15 font-medium text-[#0B2545] transition hover:bg-[#0B2545] hover:text-white"
                    >
                        <span>Parlons de votre projet</span>

                        <span className="text-20 leading-none">
                            ↗
                        </span>
                    </a>
                </div>
            </div>
        </nav>
    );
}