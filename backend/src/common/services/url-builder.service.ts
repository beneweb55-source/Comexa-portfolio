import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * SERVICE DE CONSTRUCTION D'URLS POUR COMEXA
 *
 * Ce service centralise la génération de toutes les URLs du frontend
 * pour permettre aux réponses API de fournir des liens de redirection.
 *
 * RÈGLES:
 * - Utilise FRONTEND_URL depuis la configuration
 * - Toutes les URLs sont construites de manière cohérente
 * - Permet une maintenance facile si les routes changent
 */

@Injectable()
export class UrlBuilderService {
  private readonly frontendUrl: string;

  constructor(private readonly config: ConfigService) {
    this.frontendUrl = this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
  }

  // ---------------------------------------------------------------------------
  // Factures
  // ---------------------------------------------------------------------------

  /**
   * URL vers la liste des factures
   */
  invoicesList(): string {
    return `${this.frontendUrl}/dashboard/invoices`;
  }

  /**
   * URL vers une facture spécifique
   */
  invoice(id: string): string {
    return `${this.frontendUrl}/dashboard/invoices/${id}`;
  }

  /**
   * URL vers le PDF d'une facture
   */
  invoicePdf(id: string): string {
    return `${this.frontendUrl}/dashboard/invoices/${id}/pdf`;
  }

  // ---------------------------------------------------------------------------
  // Devis
  // ---------------------------------------------------------------------------

  /**
   * URL vers la liste des devis
   */
  quotesList(): string {
    return `${this.frontendUrl}/dashboard/quotes`;
  }

  /**
   * URL vers un devis spécifique
   */
  quote(id: string): string {
    return `${this.frontendUrl}/dashboard/quotes/${id}`;
  }

  /**
   * URL vers le PDF d'un devis
   */
  quotePdf(id: string): string {
    return `${this.frontendUrl}/dashboard/quotes/${id}/pdf`;
  }

  // ---------------------------------------------------------------------------
  // Projets
  // ---------------------------------------------------------------------------

  /**
   * URL vers la liste des projets
   */
  projectsList(): string {
    return `${this.frontendUrl}/dashboard/projects`;
  }

  /**
   * URL vers un projet spécifique
   */
  project(id: string): string {
    return `${this.frontendUrl}/dashboard/projects/${id}`;
  }

  /**
   * URL vers les répartitions d'un projet
   */
  projectDistributions(id: string): string {
    return `${this.frontendUrl}/dashboard/projects/${id}/distributions`;
  }

  // ---------------------------------------------------------------------------
  // Clients
  // ---------------------------------------------------------------------------

  /**
   * URL vers la liste des clients
   */
  clientsList(): string {
    return `${this.frontendUrl}/dashboard/clients`;
  }

  /**
   * URL vers un client spécifique
   */
  client(id: string): string {
    return `${this.frontendUrl}/dashboard/clients/${id}`;
  }

  // ---------------------------------------------------------------------------
  // Paramètres
  // ---------------------------------------------------------------------------

  /**
   * URL vers les paramètres généraux
   */
  settings(): string {
    return `${this.frontendUrl}/dashboard/settings`;
  }

  /**
   * URL vers la gestion des devises
   */
  settingsCurrencies(): string {
    return `${this.frontendUrl}/dashboard/settings/currencies`;
  }

  /**
   * URL vers la gestion des répartitions
   */
  settingsDistributions(): string {
    return `${this.frontendUrl}/dashboard/settings/distributions`;
  }

  /**
   * URL vers la gestion des taux de change
   */
  settingsExchangeRates(): string {
    return `${this.frontendUrl}/dashboard/settings/exchange-rates`;
  }

  // ---------------------------------------------------------------------------
  // Messagerie
  // ---------------------------------------------------------------------------

  /**
   * URL vers la messagerie
   */
  messages(): string {
    return `${this.frontendUrl}/dashboard/messages`;
  }

  /**
   * URL vers une conversation spécifique
   */
  conversation(id: string): string {
    return `${this.frontendUrl}/dashboard/messages/${id}`;
  }

  // ---------------------------------------------------------------------------
  // Tableau de bord
  // ---------------------------------------------------------------------------

  /**
   * URL vers le tableau de bord
   */
  dashboard(): string {
    return `${this.frontendUrl}/dashboard`;
  }

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------

  /**
   * Construire une réponse avec URL de redirection
   */
  buildResponse<T>(
    data: T,
    options: {
      message: string;
      redirectTo?: 'list' | 'detail' | 'settings' | 'dashboard' | string;
      resourceType: 'invoice' | 'quote' | 'project' | 'client' | 'currency' | 'distribution' | 'conversation';
      resourceId?: string;
      openInNewTab?: boolean;
    },
  ): {
    success: true;
    message: string;
    data: T;
    redirectUrl?: string;
    action?: {
      type: 'open_tab' | 'redirect' | 'refresh';
      url: string;
      target: '_blank' | '_self';
    };
  } {
    const { message, redirectTo, resourceType, resourceId, openInNewTab = true } = options;

    let url: string | undefined;
    let action: {
      type: 'open_tab' | 'redirect' | 'refresh';
      url: string;
      target: '_blank' | '_self';
    } | undefined;

    // Construire l'URL en fonction du type
    if (redirectTo && resourceId) {
      switch (resourceType) {
        case 'invoice':
          url = redirectTo === 'list' ? this.invoicesList() : this.invoice(resourceId);
          break;
        case 'quote':
          url = redirectTo === 'list' ? this.quotesList() : this.quote(resourceId);
          break;
        case 'project':
          url = redirectTo === 'list' ? this.projectsList() : this.project(resourceId);
          break;
        case 'client':
          url = redirectTo === 'list' ? this.clientsList() : this.client(resourceId);
          break;
        case 'currency':
          url = this.settingsCurrencies();
          break;
        case 'distribution':
          url = resourceId ? this.projectDistributions(resourceId) : this.settingsDistributions();
          break;
        case 'conversation':
          url = redirectTo === 'list' ? this.messages() : this.conversation(resourceId);
          break;
        default:
          url = this.dashboard();
      }
    } else if (redirectTo) {
      switch (redirectTo) {
        case 'list':
          url = this.dashboard();
          break;
        case 'settings':
          url = this.settings();
          break;
        case 'messages':
          url = this.messages();
          break;
        default:
          url = this.dashboard();
      }
    }

    if (url) {
      action = {
        type: openInNewTab ? 'open_tab' : 'redirect',
        url,
        target: openInNewTab ? '_blank' : '_self',
      };
    }

    return {
      success: true,
      message,
      data,
      redirectUrl: url,
      action,
    };
  }

  /**
   * Construire une réponse d'erreur
   */
  buildErrorResponse(
    error: string,
    options?: {
      code?: string;
      details?: any;
    },
  ): {
    success: false;
    error: string;
    code?: string;
    details?: any;
  } {
    return {
      success: false,
      error,
      code: options?.code,
      details: options?.details,
    };
  }
}
