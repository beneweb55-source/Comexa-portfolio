import ServicesView from "@/components/public/ServicesView";
import { getPublicList } from "@/lib/public-server";

export const metadata = {
  title: "Nos services — Comexa",
  description: "Sites vitrines, boutiques en ligne et applications web : les services Comexa, leur périmètre et leurs prix de départ.",
};

/** Services lus côté serveur (SEO), cache 1 h, purgé à chaque modification. */
export default async function Page() {
  const apiServices = await getPublicList("/public/services");
  return <ServicesView apiServices={apiServices} />;
}
