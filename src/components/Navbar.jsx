"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import logo from "../../public/comexa-logo-horizontal-transparent.png";

const navigationLinks = [
    { href: "/", label: "L’agence" },
    { href: "/services", label: "Services" },
    { href: "/realisations", label: "Réalisations" },
    { href: "/partenaires", label: "Partenaires" },
];

export default function Navbar() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    useEffect(() => {
        const closeMenuOnEscape = (event) => {
            if (event.key === "Escape") {
                setIsMenuOpen(false);
            }
        };

        document.addEventListener("keydown", closeMenuOnEscape);
        return () => document.removeEventListener("keydown", closeMenuOnEscape);
    }, []);

    return (
        <nav className="relative w-full border-b border-dotted border-[#1683E5] bg-[#F8F9FC]">
            <div className="mx-auto flex min-h-20 max-w-[1440px] items-center justify-between px-4 py-4 sm:px-8 md:px-10 md:py-0 lg:px-14">
                <Link href="/" className="flex items-center" onClick={() => setIsMenuOpen(false)}>
                    <Image
                        src={logo}
                        alt="Comexa"
                        width={130}
                        height={30}
                        className="h-auto w-[min(130px,45vw)]"
                        priority
                    />
                </Link>

                <div className="hidden items-center justify-end gap-7 lg:flex">
                    {navigationLinks.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="text-[15px] font-medium text-[#111827] transition hover:text-[#1E86E0]"
                        >
                            {link.label}
                        </Link>
                    ))}

                    <Link
                        href="/contact"
                        className="flex h-10 items-center gap-2 rounded-lg border border-[#0B2545] px-5 text-[15px] font-medium text-[#0B2545] transition hover:bg-[#0B2545] hover:text-white"
                    >
                        <span>Parlons de votre projet</span>
                        <span className="text-[20px] leading-none">↗</span>
                    </Link>
                </div>

                <button
                    type="button"
                    aria-label={isMenuOpen ? "Fermer le menu" : "Ouvrir le menu"}
                    aria-expanded={isMenuOpen}
                    aria-controls="mobile-navigation"
                    onClick={() => setIsMenuOpen((open) => !open)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#0B2545] text-[#0B2545] transition hover:bg-[#0B2545] hover:text-white lg:hidden"
                >
                    <span className="sr-only">
                        {isMenuOpen ? "Fermer le menu" : "Ouvrir le menu"}
                    </span>
                    <span className="flex w-5 flex-col gap-1" aria-hidden="true">
                        <span className={`h-0.5 w-full bg-current transition-transform ${isMenuOpen ? "translate-y-1.5 rotate-45" : ""}`} />
                        <span className={`h-0.5 w-full bg-current transition-opacity ${isMenuOpen ? "opacity-0" : ""}`} />
                        <span className={`h-0.5 w-full bg-current transition-transform ${isMenuOpen ? "-translate-y-1.5 -rotate-45" : ""}`} />
                    </span>
                </button>
            </div>

            <div
                id="mobile-navigation"
                className={`${isMenuOpen ? "block" : "hidden"} border-t border-[#1683E5]/30 bg-[#F8F9FC] px-4 pb-5 pt-3 sm:px-8 md:px-10 lg:hidden`}
            >
                <div className="mx-auto flex max-w-[1440px] flex-col gap-1">
                    {navigationLinks.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            onClick={() => setIsMenuOpen(false)}
                            className="rounded-lg px-3 py-3 text-[15px] font-medium text-[#111827] transition hover:bg-[#e8f1fa] hover:text-[#1E86E0]"
                        >
                            {link.label}
                        </Link>
                    ))}

                    <Link
                        href="/contact"
                        onClick={() => setIsMenuOpen(false)}
                        className="mt-2 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#0B2545] px-4 text-[14px] font-medium text-white transition hover:bg-[#1683E5]"
                    >
                        <span>Parlons de votre projet</span>
                        <span className="text-[18px] leading-none">↗</span>
                    </Link>
                </div>
            </div>
        </nav>
    );
}