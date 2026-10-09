"use client";

import Image from "next/image";
import Link from "next/link";
import logo from "../../public/comexa-logo-horizontal-transparent.png"
export default function Navbar() {
    
    return (
        <nav className="w-full bg-[#F8F9FC] border-b border-dotted border-[#1683E5]">
            <div className="mx-auto flex min-h-20 max-w-[1440px] flex-col gap-4 px-5 py-4 sm:px-8 md:flex-row md:items-center md:justify-between md:px-10 md:py-0 lg:px-14">


                <Link href="/" className="flex items-center">
                    <Image
                        src={logo}
                        alt="Comexa"
                        width={130}
                        height={30}
                        className="h-[30px] w-[130px]"
                        priority
                    />
                </Link>



                <div className="flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 md:w-auto md:justify-end md:gap-7">
                    <a
                        href="/"
                        className="text-15 font-medium text-[#111827] transition hover:text-[#1E86E0]"
                    >
                        L’agence
                    </a>

                    <a
                        href="/services"
                        className="text-15 font-medium text-[#111827] transition hover:text-[#1E86E0]"
                    >
                        Services
                    </a>

                    <a
                        href="/realisations"
                        className="text-15 font-medium text-[#111827] transition hover:text-[#1E86E0]"
                    >
                        Réalisations
                    </a>

                    <a
                        href="/partenaires"
                        className="text-15 font-medium text-[#111827] transition hover:text-[#1E86E0]"
                    >
                        partenaires
                    </a>


                    <a
                        href="/contact"
                        className="flex h-10 items-center gap-2 rounded-lg border border-[#0B2545] px-3 text-[13px] font-medium text-[#0B2545] transition hover:bg-[#0B2545] hover:text-white sm:px-5 sm:text-[15px]"
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