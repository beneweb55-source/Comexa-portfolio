"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/session";
import { ApiError, apiFetch, formatMoney, messageOf } from "@/lib/api";
import { OFFER_REASON } from "@/lib/labels";
import { Card, Empty, Notice, inputClass, primaryButton, secondaryButton } from "@/components/workspace/ui";

/**
 * Parcours de commande :
 *  1. le tarif affiche vient du serveur (GET /orders/offer), jamais du navigateur ;
 *  2. si la commande en ligne est possible : commande, qui active l'espace client ;
 *  3. sinon : demande de projet, que l'equipe examine avant tout projet.
 */
export default function CommanderPage() {
  const { request } = useAuth();
  const [packs, setPacks] = useState(null);
  const [packError, setPackError] = useState(null);
  const [selected, setSelected] = useState(null); // pack choisi
  const [offer, setOffer] = useState(null);
  const [offerError, setOfferError] = useState(null);
  const [loadingOffer, setLoadingOffer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [confirmation, setConfirmation] = useState(null); // { kind, reference }
  const [message, setMessage] = useState("");
  const [freeMessage, setFreeMessage] = useState("");
  const [freeError, setFreeError] = useState(null);

  useEffect(() => {
    apiFetch("/public/packages")
      .then(({ data }) => setPacks(data))
      .catch((caught) => setPackError(messageOf(caught)));
  }, []);

  async function loadOffer(pack) {
    const { data } = await request(`/orders/offer?packageId=${encodeURIComponent(pack.id)}`);
    return data;
  }

  async function chooseOffer(pack) {
    setSelected(pack);
    setOffer(null);
    setOfferError(null);
    setActionError(null);
    setConfirmation(null);
    setMessage("");
    setLoadingOffer(true);
    try {
      setOffer(await loadOffer(pack));
    } catch (caught) {
      setOfferError(messageOf(caught));
    } finally {
      setLoadingOffer(false);
    }
  }

  async function orderPack() {
    setBusy(true);
    setActionError(null);
    try {
      const { data } = await request("/orders", { method: "POST", body: { packageId: selected.id } });
      setConfirmation({ kind: "order", reference: data.reference });
    } catch (caught) {
      // Refus metier : on propose la demande de projet plutot que de laisser une impasse.
      setActionError(caught);
      if (caught instanceof ApiError && caught.status === 422) {
        // Le serveur donne le vrai motif : on le relit plutot que de le deviner.
        loadOffer(selected).then(setOffer).catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendRequest(packageId, text, setError = setActionError) {
    setBusy(true);
    setError(null);
    try {
      const body = {};
      if (packageId) body.packageId = packageId;
      if (text.trim()) body.message = text.trim();
      const { data } = await request("/project-requests", { method: "POST", body });
      setConfirmation({ kind: "request", reference: data.reference });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {confirmation ? (
        <Notice tone="success">
          {confirmation.kind === "order"
            ? `Votre commande ${confirmation.reference} est enregistrée. Votre espace client est activé : vous y suivez son traitement.`
            : `Votre demande ${confirmation.reference} est enregistrée. Notre équipe l'examine et revient vers vous.`}{" "}
          <Link href="/espace-client" className="font-medium underline">
            Retour à mon espace
          </Link>
        </Notice>
      ) : null}

      <Card title="Choisissez un pack">
        {packError ? <Notice>{packError}</Notice> : null}
        {packs === null && !packError ? <p className="text-[14px] text-[#4B5563]">Chargement des packs…</p> : null}
        {packs?.length === 0 ? <Empty>Aucun pack n’est proposé pour le moment.</Empty> : null}
        <ul className="grid gap-4 md:grid-cols-2">
          {(packs ?? []).map((pack) => (
            <li
              key={pack.id}
              className={`flex flex-col gap-3 rounded-xl border p-5 ${
                selected?.id === pack.id ? "border-[#1683E5] bg-[#F4F9FE]" : "border-[#E5ECF5]"
              }`}
            >
              <div>
                <h3 className="text-[18px] font-semibold text-[#0B2545]">{pack.name}</h3>
                <p className="text-[14px] text-[#4B5563]">{pack.tagline}</p>
              </div>
              {pack.features?.length ? (
                <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-[#374151]">
                  {pack.features.slice(0, 5).map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              ) : null}
              <button type="button" onClick={() => chooseOffer(pack)} className={`${secondaryButton} mt-auto self-start`} aria-pressed={selected?.id === pack.id}>
                {selected?.id === pack.id ? "Pack sélectionné" : "Voir le tarif"}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {selected ? (
        <Card title={`Votre offre : ${selected.name}`}>
          {loadingOffer ? <p className="text-[14px] text-[#4B5563]" role="status">Calcul de votre offre…</p> : null}
          {offerError ? <Notice>{offerError}</Notice> : null}

          {offer?.kind === "ORDER" ? (
            <div className="flex flex-col gap-4">
              <p className="text-[15px] text-[#111827]">
                Prix : <strong>{formatMoney(offer.amount, offer.currency)}</strong>
                {offer.paymentMethod ? <> · paiement par {offer.paymentMethod}</> : null}
              </p>
              <p className="text-[13.5px] text-[#4B5563]">
                Commander active votre espace client. Le paiement se règle selon les modalités indiquées après commande ;
                votre projet démarre après validation de notre équipe.
              </p>
              {actionError ? <Notice>{messageOf(actionError)}</Notice> : null}
              <button type="button" onClick={orderPack} disabled={busy || Boolean(confirmation)} className={`${primaryButton} self-start`}>
                {busy ? "Commande en cours…" : "Commander ce pack"}
              </button>
            </div>
          ) : null}

          {offer?.kind === "PROJECT_REQUEST" ? (
            <div className="flex flex-col gap-4">
              <Notice tone="info">{OFFER_REASON[offer.reason] ?? OFFER_REASON.NO_CURRENT_RATE}</Notice>
              <label htmlFor="pack-message" className="text-[14px] font-medium text-[#111827]">
                Précisez votre besoin (facultatif)
              </label>
              <textarea id="pack-message" rows={4} value={message} onChange={(event) => setMessage(event.target.value)} className={`${inputClass} h-auto py-2`} />
              {actionError ? <Notice>{messageOf(actionError)}</Notice> : null}
              <button type="button" onClick={() => sendRequest(selected.id, message)} disabled={busy || Boolean(confirmation)} className={`${primaryButton} self-start`}>
                {busy ? "Envoi…" : "Demander un projet pour ce pack"}
              </button>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card title="Votre projet ne correspond à aucun pack ?">
        <div className="flex flex-col gap-4">
          <p className="text-[14px] text-[#4B5563]">Décrivez votre besoin : notre équipe étudie chaque demande.</p>
          <label htmlFor="free-message" className="sr-only">
            Description de votre projet
          </label>
          <textarea id="free-message" rows={4} value={freeMessage} onChange={(event) => setFreeMessage(event.target.value)} className={`${inputClass} h-auto py-2`} />
          {freeError ? <Notice>{messageOf(freeError)}</Notice> : null}
          <button
            type="button"
            onClick={() => sendRequest(null, freeMessage, setFreeError)}
            disabled={busy || freeMessage.trim().length < 10 || Boolean(confirmation)}
            className={`${secondaryButton} self-start`}
          >
            Envoyer ma demande
          </button>
        </div>
      </Card>
    </div>
  );
}
