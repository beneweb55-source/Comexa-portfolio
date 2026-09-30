"use client";
import Image from "next/image";
import Link from "next/link";
import logo from "../../public/comexa-logo-horizontal-clair-transparent.png"

export default function Footer() {
    return (
        <footer className="w-full bg-[#0D172B] text-white">
            <div className="mx-10  px-6 py-9 lg:px-0 text-left my-2">


                <div className="grid grid-cols-1 gap-25 md:grid-cols-4">


                    <div className="md:col-span-1">
                        <Link href="/" className="mb-5 flex items-center gap-2">
                            <Image
                                src={logo}
                                alt="Comexa"
                                width={200}
                                height={50}
                                priority
                            />
                        </Link>

                        <h2 className="text-xl font-medium ">
                            Naviguer le digital ensemble.
                        </h2>

                        <p className="mt-4 max-w-67.5 text-13 leading-7 text-[#9BA9C1]">
                            Agence spécialisée exclusivement en conception
                            et développement web.
                        </p>
                    </div>


                    <div>
                        <h3 className="mb-4 text-16 font-semibold uppercase text-[#1E86E0]">
                            Explorer
                        </h3>

                        <ul className="space-y-3 text-14 text-white">
                            <li>
                                <a href="#agence" className="transition hover:text-[#1E86E0]">
                                    L&apos;agence
                                </a>
                            </li>

                            <li>
                                <a href="#services" className="transition hover:text-[#1E86E0]">
                                    Services
                                </a>
                            </li>

                            <li>
                                <a
                                    href="#realisations"
                                    className="transition hover:text-[#1E86E0]"
                                >
                                    Réalisations
                                </a>
                            </li>

                            <li>
                                <a href="#contact" className="transition hover:text-[#1E86E0]">
                                    Contact
                                </a>
                            </li>
                        </ul>
                    </div>


                    <div>
                        <h3 className="mb-4 text-16 font-semibold uppercase text-[#1E86E0]">
                            Expertises
                        </h3>

                        <ul className="space-y-3 text-14 text-white">
                            <li>
                                <a href="#" className="transition hover:text-[#1E86E0]">
                                    Sites vitrines
                                </a>
                            </li>

                            <li>
                                <a href="#" className="transition hover:text-[#1E86E0]">
                                    E-commerce
                                </a>
                            </li>

                            <li>
                                <a href="#" className="transition hover:text-[#1E86E0]">
                                    Applications web
                                </a>
                            </li>

                            <li>
                                <a href="#" className="transition hover:text-[#1E86E0]">
                                    Maintenance
                                </a>
                            </li>
                        </ul>
                    </div>


                    <div>
                        <h3 className="mb-4 text-16 font-semibold uppercase text-[#1E86E0]">
                            Nous suivre
                        </h3>

                        <ul className="space-y-3 text-14 text-white">
                            <li>
                                <a href="#" className="transition hover:text-[#1E86E0]">
                                    LinkedIn
                                </a>
                            </li>

                            <li>
                                <a href="#" className="transition hover:text-[#1E86E0]">
                                    Instagram
                                </a>
                            </li>



                            <li>
                                <a
                                    href="mailto:bonjour@comexa.dz"
                                    className="transition hover:text-[#1E86E0]"
                                >
                                    bonjour@comexa.dz
                                </a>
                            </li>
                        </ul>
                    </div>
                </div>


                <div className="mt-10 border-t border-[#18243A]" />


                <div className="flex flex-col gap-4 pt-10 text-[11px] text-[#9BA9C1] md:flex-row md:items-center md:justify-between">
                    <p>
                        © 2026 Comexa. Tous droits réservés.
                    </p>

                    <div className="flex gap-8">
                        <a
                            href="#"
                            className="transition hover:text-white"
                        >
                            Mentions légales
                        </a>

                        <a
                            href="#"
                            className="transition hover:text-white"
                        >
                            Politique de confidentialité
                        </a>
                    </div>
                </div>

            </div>
        </footer>
    );
}