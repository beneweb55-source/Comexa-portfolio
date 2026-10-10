import ContactView from "@/components/public/ContactView";
import { getPublicList } from "@/lib/public-server";

export const metadata = {
  title: "Contact — Comexa",
  description: "Parlez-nous de votre projet : nous vous répondons avec une proposition claire.",
};

/** Contact : FAQ lue côté serveur (SEO), cache 1 h. */
export default async function Page() {
  const apiFaqs = await getPublicList("/public/faqs");
  return <ContactView apiFaqs={apiFaqs} />;
}
