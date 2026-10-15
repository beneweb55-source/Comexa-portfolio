import {
  WhatsAppGatewayError,
  WHATSAPP_ERROR_CODES,
  type GatewayContact,
  type GatewayQrCode,
  type GatewaySendResult,
  type GatewaySessionStatus,
  type WhatsAppGateway,
  type WhatsAppGatewayDriver,
} from '../whatsapp.types.js';

/**
 * PASSERELLE DESACTIVEE — le comportement par defaut du backend.
 *
 * -------------------------------------------------------------------------
 * POURQUOI UNE CLASSE COMPLETE PLUTOT QU'UN DRAPEAU
 * -------------------------------------------------------------------------
 * `WHATSAPP_GATEWAY_DRIVER=none` est un etat PREVU : tant qu'aucune passerelle
 * n'est hebergee, les routes doivent repondre 503 `WHATSAPP_GATEWAY_NOT_CONFIGURED`
 * — un refus net, avec la variable a renseigner dans le message.
 *
 * L'alternative (un `if` dans chaque methode du service) aurait deux defauts. Le
 * premier est evident : neuf methodes, neuf occasions d'oublier la garde, et un
 * envoi qui partirait sans passerelle produirait une erreur de `fetch` sur une
 * URL vide — donc un message marque `FAILED` alors qu'il n'a jamais ete tente.
 * Le second est plus discret : un service qui teste la configuration ne se teste
 * qu'AVEC une configuration, donc jamais dans l'etat ou il tourne reellement
 * aujourd'hui.
 *
 * `configured: false` est lu par le contrat d'API et par les messages : un
 * appelant peut savoir l'etat de la fonctionnalite sans provoquer d'erreur.
 */
export class DisabledWhatsAppGateway implements WhatsAppGateway {
  readonly driver: WhatsAppGatewayDriver = 'none';
  readonly configured = false;

  async ensureSession(): Promise<void> {
    throw notConfigured();
  }

  async startSession(): Promise<void> {
    throw notConfigured();
  }

  async getStatus(): Promise<GatewaySessionStatus> {
    throw notConfigured();
  }

  async getQrCode(): Promise<GatewayQrCode> {
    throw notConfigured();
  }

  async logout(): Promise<void> {
    throw notConfigured();
  }

  async deleteSession(): Promise<void> {
    throw notConfigured();
  }

  async listContacts(): Promise<GatewayContact[]> {
    throw notConfigured();
  }

  async sendText(): Promise<GatewaySendResult> {
    throw notConfigured();
  }
}

function notConfigured(): WhatsAppGatewayError {
  return new WhatsAppGatewayError(
    WHATSAPP_ERROR_CODES.NOT_CONFIGURED,
    'Aucune passerelle WhatsApp n’est configuree. Renseigner ' +
      'WHATSAPP_GATEWAY_DRIVER=waha (ou evolution) avec WHATSAPP_GATEWAY_URL et ' +
      'WHATSAPP_GATEWAY_API_KEY, puis redeployer le backend. Voir ' +
      'docs/TELEGRAM-VOIX-WHATSAPP.md pour le deploiement de la passerelle.',
  );
}
