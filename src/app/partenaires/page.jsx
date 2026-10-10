import PartenairesView from "@/components/public/PartenairesView";
import { getPublicList } from "@/lib/public-server";

export const metadata = {
  title: "Partenaires et témoignages — Comexa",
  description: "Les entreprises qui nous font confiance et les retours de nos clients.",
};

/** Partenaires et témoignages : lus côté serveur (SEO), cache 1 h. */
export default async function Page() {
  const [apiTestimonials, apiPartners] = await Promise.all([
    getPublicList("/public/testimonials"),
    getPublicList("/public/partners"),
  ]);
  return <PartenairesView apiTestimonials={apiTestimonials} apiPartners={apiPartners} />;
}
