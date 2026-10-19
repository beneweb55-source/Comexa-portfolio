"use client";

import { useState } from "react";
import Dialog from "@/components/softui/Dialog";
import { useAuth } from "@/lib/session";
import { useActionNotification } from "@/components/workspace/ui/ActionNotification";
import { Field, Notice, inputClass, primaryButton, secondaryButton, textareaClass } from "@/components/workspace/ui";

/*
 * Envoi d'un document commercial par email, avec le PDF en pièce jointe.
 *
 * UN SEUL FORMULAIRE POUR DEUX PORTES. Le lecteur PDF et la rangée d'actions de
 * la page proposaient chacun leur envoi : celle de la page ouvrait en réalité
 * l'APERÇU complet (chargement du PDF compris), dans lequel il fallait retrouver
 * un second bouton « Envoyer par Email ». Deux clics et un document généré pour
 * une action qui n'en demande aucun. Le bouton de la page ouvre désormais ce
 * formulaire directement, et le lecteur ouvre le même.
 *
 * Sujet et message sont facultatifs : le service compose `Facture FAC-…` et un
 * corps par défaut quand ils restent vides (voir `sendDocumentByEmail`). Le
 * formulaire l'annonce au lieu de laisser croire qu'un sujet est obligatoire.
 */

export function PdfEmailDialog({
  endpoint,
  title,
  description,
  defaultTo = "",
  defaultSubject = "",
  onClose,
  onSent,
}) {
  const { request } = useAuth();
  const { showNotification, NotificationComponent } = useActionNotification();
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (!to || sending) return;

    setSending(true);
    setError(null);

    try {
      const result = await request(endpoint, {
        method: "POST",
        body: { to, subject, message, includePdf: true, language: "fr" },
      });

      /* La notification porte le verbe du serveur ET la redirection qu'il
         propose : c'est le contrat de `buildResponse`, et c'est ce qui permet de
         sauter directement sur le document concerné. */
      showNotification({
        message: result?.message ?? "Document envoyé par email.",
        redirectUrl: result?.redirectUrl,
        action: result?.action,
        duration: 8000,
      });

      onSent?.(result);
      onClose?.();
    } catch (caught) {
      /* L'erreur reste dans le formulaire : le refermer sur un échec ferait
         perdre à l'utilisateur ce qu'il vient d'écrire. */
      setError(caught?.message ?? "L'envoi par email a échoué.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {NotificationComponent}
      <Dialog
        as="form"
        onSubmit={submit}
        title={title}
        description={description}
        onClose={onClose}
        footer={
          <>
            <button type="button" className={secondaryButton} onClick={onClose} disabled={sending}>
              Annuler
            </button>
            <button type="submit" className={primaryButton} disabled={sending || !to}>
              {sending ? "Envoi…" : "Envoyer"}
            </button>
          </>
        }
      >
        <div className="sui-form">
          <Field id="pdf-email-to" label="Destinataire *">
            <input
              id="pdf-email-to"
              type="email"
              className={inputClass}
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="contact@client.dz"
              autoComplete="off"
              data-autofocus
              required
            />
          </Field>

          <Field
            id="pdf-email-subject"
            label="Sujet"
            hint={defaultSubject ? `Vide : « ${defaultSubject} »` : "Vide : sujet par défaut"}
          >
            <input
              id="pdf-email-subject"
              type="text"
              className={inputClass}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder={defaultSubject || undefined}
              maxLength={200}
            />
          </Field>

          <Field id="pdf-email-message" label="Message" hint="Vide : le serveur joint son message d'accompagnement.">
            <textarea
              id="pdf-email-message"
              className={textareaClass}
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={2000}
            />
          </Field>

          {error ? <Notice>{error}</Notice> : null}
        </div>
      </Dialog>
    </>
  );
}

export default PdfEmailDialog;
