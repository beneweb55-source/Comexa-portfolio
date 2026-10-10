import HomeView from "@/components/public/HomeView";
import { getPublicList } from "@/lib/public-server";

export const metadata = {
  title: "Comexa — Sites, applications et accompagnement digital",
  description: "Comexa conçoit et accompagne vos sites vitrines, applications et projets digitaux, de la maquette à la mise en ligne.",
};

/** Page d'accueil : données lues côté serveur (SEO), cache 1 h. */
export default async function Page() {
  const [apiServices, apiTestimonials] = await Promise.all([
    getPublicList("/public/services"),
    getPublicList("/public/testimonials"),
  ]);
  return <HomeView apiServices={apiServices} apiTestimonials={apiTestimonials} />;
}
