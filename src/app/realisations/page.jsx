import RealisationsView from "@/components/public/RealisationsView";
import { getPublicList } from "@/lib/public-server";

export const metadata = {
  title: "Réalisations — Comexa",
  description: "Sites vitrines, boutiques en ligne et applications web réalisés par Comexa, et les études de cas associées.",
};

/** Études de cas et catégories lues côté serveur (SEO), cache 1 h, purgé à chaque modification. */
export default async function Page() {
  const [apiCaseStudies, apiCategories] = await Promise.all([
    getPublicList("/public/case-studies?perPage=100"),
    getPublicList("/public/case-study-categories"),
  ]);
  return <RealisationsView apiCaseStudies={apiCaseStudies} apiCategories={apiCategories} />;
}
