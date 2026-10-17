# 🔗 Système de Redirection vers Comexa

## 🎯 Objectif

Permettre à **l'IA (Arena, n8n, ou toute autre intégration)** de **rediriger automatiquement vers Comexa** après une action, avec :

- ✅ **Liens cliquables** dans les réponses
- ✅ **Ouverture automatique** dans un nouvel onglet
- ✅ **Design parfait** avec l'aesthetic Comexa (glassmorphism, bleu profond)
- ✅ **Intégration transparente** avec l'existant

---

## 📦 Implémentation Backend

### **1. UrlBuilderService** (`backend/src/common/services/url-builder.service.ts`)

Service centralisé pour générer toutes les URLs du frontend Comexa.

**Fonctionnalités :**
- Construction d'URLs pour : factures, devis, projets, clients, paramètres, messagerie
- Méthode `buildResponse()` pour standardiser les réponses API avec URLs de redirection
- Méthode `buildErrorResponse()` pour les erreurs
- Utilisation de `FRONTEND_URL` depuis la configuration

**Exemple d'utilisation :**
```typescript
return this.urlBuilder.buildResponse(data, {
  message: 'Facture envoyée avec succès',
  redirectTo: 'detail',
  resourceType: 'invoice',
  resourceId: id,
  openInNewTab: true,
});
```

**Résultat :**
```json
{
  "success": true,
  "message": "Facture envoyée avec succès",
  "data": { ... },
  "redirectUrl": "https://comexa.dz/dashboard/invoices/123",
  "action": {
    "type": "open_tab",
    "url": "https://comexa.dz/dashboard/invoices/123",
    "target": "_blank"
  }
}
```

---

### **2. Contrôleurs Modifiés**

Tous les contrôleurs ont été mis à jour pour retourner des URLs de redirection :

| Contrôleur | Endpoint | URL de redirection |
|------------|----------|---------------------|
| `PdfController` | POST `/pdf/invoices/:id/email` | `/dashboard/invoices/:id` |
| `PdfController` | POST `/pdf/quotes/:id/email` | `/dashboard/quotes/:id` |
| `DistributionController` | POST `/distributions/projects/:id/calculate` | `/dashboard/projects/:id/distributions` |
| `DistributionController` | POST `/distributions/projects/:id/apply` | `/dashboard/projects/:id/distributions` |
| `CurrencyController` | POST `/currencies` | `/dashboard/settings/currencies` |
| `CurrencyController` | PATCH `/currencies/:id` | `/dashboard/settings/currencies` |
| `CurrencyController` | DELETE `/currencies/:id` | `/dashboard/settings/currencies` |
| `ExchangeRateController` | POST `/exchange-rates` | `/dashboard/settings/currencies` |
| `ExchangeRateController` | DELETE `/exchange-rates` | `/dashboard/settings/currencies` |
| `BalanceController` | POST `/balances/adjust` | `/dashboard/settings/currencies` |

---

### **3. Module UrlBuilder** (`backend/src/common/services/url-builder.module.ts`)

Module NestJS pour fournir le service UrlBuilderService.

**Importation dans les modules :**
```typescript
@Module({
  imports: [UrlBuilderModule],
  // ...
})
export class PdfModule {}
```

---

## 🖥️ Implémentation Frontend

### **1. useActionNotification Hook** (`src/lib/hooks/useRedirectAfterAction.js`)

Hook pour gérer les redirections et notifications.

**Fonctionnalités :**
- `redirectTo(url, options)` - Rediriger vers une URL
- `executeWithRedirect(action, options)` - Exécuter une action et rediriger après
- `isRedirecting` - État de redirection en cours
- `redirectError` - Erreur de redirection
- `RedirectMessage` - Composant de message avec lien cliquable

**Exemple d'utilisation :**
```jsx
const { executeWithRedirect } = useRedirectAfterAction();

const handleSend = async () => {
  await executeWithRedirect(
    async () => {
      const response = await fetch('/api/endpoint', { method: 'POST' });
      return response.json();
    },
    { openInNewTab: true }
  );
};
```

---

### **2. ActionNotification Composant** (`src/components/workspace/ui/ActionNotification.jsx`)

Composant de notification avec :

**Design (Aesthetic Comexa) :**
- ✅ **Glassmorphism** : `backdrop-blur-[var(--comexa-glass-blur)] bg-[var(--comexa-glass-bg)]`
- ✅ **Bordure glass** : `border border-[var(--comexa-glass-border)]`
- ✅ **Ombres** : `shadow-lg` + `var(--comexa-shadow-md)`
- ✅ **Couleurs** : Bleu Comexa pour les boutons, vert/rouge pour les icônes
- ✅ **Animations** : `transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`

**Fonctionnalités :**
- Affichage automatique avec `useActionNotification()`
- Auto-fermeture après 5 secondes (configurable)
- Lien cliquable "Voir sur Comexa"
- Icônes adaptées (✅ succès, ❌ erreur, ℹ️ info)

**Exemple d'affichage :**
```jsx
<ActionNotification
  message="Facture envoyée avec succès !"
  redirectUrl="https://comexa.dz/dashboard/invoices/123"
  onClose={() => setNotification(null)}
  duration={5000}
/>
```

**Rendu :**
```
┌─────────────────────────────────────────────┐
│ ✅ Facture envoyée avec succès !    [Voir]  ✕ │
│                                             [Voir sur Comexa] │
└─────────────────────────────────────────────┘
  (Glassmorphism, bleu Comexa, ombres douces)
```

---

### **3. Composants Modifiés**

#### **InvoicePdfPreview** (`src/components/workspace/invoices/InvoicePdfPreview.jsx`)

- ✅ Utilise `useActionNotification` pour les notifications
- ✅ Affiche une notification après l'envoi par email
- ✅ Lien "Voir sur Comexa" vers la facture

**Exemple :**
```jsx
if (response.ok) {
  const result = await response.json();
  
  showNotification({
    message: 'Facture envoyée par email avec succès !',
    redirectUrl: result.redirectUrl,
    action: result.action,
    duration: 8000,
  });
}
```

#### **ChatPanel** (`src/components/workspace/chat/ChatPanel.jsx`)

- ✅ Utilise `useActionNotification` pour les notifications
- ✅ Affiche une notification après l'envoi d'un message (si redirectUrl présent)
- ✅ Affiche une notification après la création d'une conversation

#### **ChatInput** (`src/components/workspace/chat/ChatInput.jsx`)

- ✅ Utilise `useActionNotification` pour les notifications
- ✅ Affiche une notification après l'envoi d'un message

---

## 🎨 Aesthetic Comexa Respectée

### **Couleurs Utilisées**

| Élément | Variable CSS | Valeur | Utilisation |
|---------|--------------|--------|-------------|
| Fond | `--comexa-surface` | `#ffffff` | Arrière-plan des notifications |
| Fond Glass | `--comexa-glass-bg` | `rgba(255, 255, 255, 0.76)` | Effet verre |
| Bordure Glass | `--comexa-glass-border` | `rgba(255, 255, 255, 0.78)` | Bordures |
| Bleu | `--comexa-blue-500` | `#1e86e0` | Boutons, accents |
| Bleu Hover | `--comexa-blue-600` | `#1568b4` | Hover des boutons |
| Bleu Clair | `--comexa-blue-50` | `#e3f2fd` | Arrière-plans légers |
| Texte | `--comexa-ink` | `#0b2545` | Texte principal |
| Texte Muted | `--comexa-ink-muted` | `#4a607a` | Texte secondaire |
| Succès | `--comexa-success` | `#0d7a52` | Icônes de succès |
| Erreur | `--comexa-error` | `#b42318` | Icônes d'erreur |

### **Ombres Utilisées**

| Élément | Variable CSS | Valeur |
|---------|--------------|--------|
| Notification | `var(--comexa-shadow-md)` | `0 4px 8px -2px rgba(11, 37, 69, 0.05), 0 14px 32px -4px rgba(18, 56, 99, 0.095)` |
| Boutons | `var(--comexa-shadow-sm)` | `0 1px 2px rgba(11, 37, 69, 0.03), 0 4px 16px -2px rgba(11, 37, 69, 0.055)` |

### **Rayons Utilisés**

| Élément | Variable CSS | Valeur |
|---------|--------------|--------|
| Notification | `var(--comexa-radius-lg)` | `20px` |
| Boutons | `var(--comexa-radius-md)` | `14px` |

### **Animations Utilisées**

| Élément | Propriété | Valeur |
|---------|-----------|--------|
| Notification | `transition` | `all 0.3s cubic-bezier(0.4, 0, 0.2, 1)` |
| Boutons | `transition` | `all 240ms var(--comexa-ease-spring)` |

---

## 📡 Utilisation par l'IA

### **Format des Réponses API**

Toutes les réponses API incluent maintenant :

```json
{
  "success": true,
  "message": "Action terminée avec succès",
  "data": { ... },
  "redirectUrl": "https://comexa.dz/dashboard/...",
  "action": {
    "type": "open_tab",
    "url": "https://comexa.dz/dashboard/...",
    "target": "_blank"
  }
}
```

### **Comment l'IA peut utiliser ces réponses**

#### **1. Afficher un lien cliquable**

```markdown
✅ **Action terminée avec succès !**

[Voir le résultat sur Comexa](https://comexa.dz/dashboard/invoices/123)
```

#### **2. Ouvrir automatiquement dans un nouvel onglet**

```javascript
// Dans un environnement browser
if (response.redirectUrl) {
  window.open(response.redirectUrl, '_blank');
}
```

#### **3. Rediriger la page actuelle**

```javascript
// Dans un environnement browser
if (response.redirectUrl) {
  window.location.href = response.redirectUrl;
}
```

#### **4. Utiliser avec n8n**

Dans un workflow n8n :

1. **Appeler l'API Comexa** (HTTP Request node)
2. **Extraire `redirectUrl`** de la réponse
3. **Envoyer un message** avec le lien (Slack, Email, etc.)
4. **Ou ouvrir le lien** dans le navigateur (si n8n le permet)

**Exemple de workflow n8n :**
```
[Start] → [HTTP Request: POST /api/pdf/invoices/123/email] 
          → [Set: Extract redirectUrl from response]
          → [Slack: Send message with link]
          → [End]
```

---

## 📁 Fichiers Créés/Modifiés

### **Backend (5 fichiers)**

| Fichier | Action | Statut |
|---------|--------|--------|
| `common/services/url-builder.service.ts` | **Créé** | ✅ |
| `common/services/url-builder.module.ts` | **Créé** | ✅ |
| `modules/pdf/pdf.controller.ts` | **Modifié** | ✅ |
| `modules/pdf/pdf.module.ts` | **Modifié** | ✅ |
| `modules/distributions/distribution.controller.ts` | **Modifié** | ✅ |
| `modules/distributions/distribution.module.ts` | **Modifié** | ✅ |
| `modules/currencies/currency.controller.ts` | **Modifié** | ✅ |
| `modules/currencies/currency.module.ts` | **Modifié** | ✅ |
| `modules/exchange-rates/exchange-rate.controller.ts` | **Modifié** | ✅ |
| `modules/exchange-rates/exchange-rate.module.ts` | **Modifié** | ✅ |
| `modules/balances/balance.controller.ts` | **Modifié** | ✅ |
| `modules/balances/balance.module.ts` | **Modifié** | ✅ |

### **Frontend (4 fichiers)**

| Fichier | Action | Statut |
|---------|--------|--------|
| `lib/hooks/useRedirectAfterAction.js` | **Créé** | ✅ |
| `components/workspace/ui/ActionNotification.jsx` | **Créé** | ✅ |
| `components/workspace/ui/index.js` | **Créé** | ✅ |
| `components/workspace/invoices/InvoicePdfPreview.jsx` | **Modifié** | ✅ |
| `components/workspace/chat/ChatPanel.jsx` | **Modifié** | ✅ |
| `components/workspace/chat/ChatInput.jsx` | **Modifié** | ✅ |

---

## 🚀 Exemples Complets

### **Exemple 1 : Envoi de facture par email**

**Requête API :**
```bash
POST /api/pdf/invoices/123/email
{
  "to": "client@example.com",
  "subject": "Votre facture INV-001",
  "message": "Bonjour, voici votre facture."
}
```

**Réponse API :**
```json
{
  "success": true,
  "message": "Facture envoyée par email avec succès",
  "data": {
    "invoiceId": "123",
    "email": "client@example.com",
    "messageId": "msg_456",
    "pdfGenerated": true
  },
  "redirectUrl": "https://comexa.dz/dashboard/invoices/123",
  "action": {
    "type": "open_tab",
    "url": "https://comexa.dz/dashboard/invoices/123",
    "target": "_blank"
  }
}
```

**Affichage IA :**
```markdown
✅ **Facture INV-001 envoyée avec succès !**

📧 **Envoyée à : client@example.com**
💰 **PDF généré et joint**

🔗 [Voir la facture sur Comexa](https://comexa.dz/dashboard/invoices/123)
```

**Frontend :**
- Notification avec bouton "Voir sur Comexa"
- Ouverture automatique dans un nouvel onglet

---

### **Exemple 2 : Calcul de répartition**

**Requête API :**
```bash
POST /api/distributions/projects/456/calculate
```

**Réponse API :**
```json
{
  "success": true,
  "message": "Répartition calculée avec succès",
  "data": {
    "id": "dist_789",
    "projectId": "456",
    "baseAmount": 10000,
    "status": "CALCULATED"
  },
  "redirectUrl": "https://comexa.dz/dashboard/projects/456/distributions",
  "action": {
    "type": "open_tab",
    "url": "https://comexa.dz/dashboard/projects/456/distributions",
    "target": "_blank"
  }
}
```

**Affichage IA :**
```markdown
✅ **Répartition calculée pour le projet PRJ-001 !**

💰 **Montant de base : 10 000 DZD**
📊 **Statut : CALCULATED**

🔗 [Voir les répartitions sur Comexa](https://comexa.dz/dashboard/projects/456/distributions)
```

---

### **Exemple 3 : Création de devise**

**Requête API :**
```bash
POST /api/currencies
{
  "code": "USD",
  "name": "Dollar Américain",
  "symbol": "$"
}
```

**Réponse API :**
```json
{
  "success": true,
  "message": "Devise USD créée avec succès",
  "data": {
    "id": "cur_123",
    "code": "USD",
    "name": "Dollar Américain",
    "symbol": "$",
    "isActive": true,
    "isDefault": false
  },
  "redirectUrl": "https://comexa.dz/dashboard/settings/currencies",
  "action": {
    "type": "open_tab",
    "url": "https://comexa.dz/dashboard/settings/currencies",
    "target": "_blank"
  }
}
```

**Affichage IA :**
```markdown
✅ **Devise USD créée avec succès !**

💱 **Code : USD | Symbole : $**
📝 **Statut : Active**

🔗 [Voir les devises sur Comexa](https://comexa.dz/dashboard/settings/currencies)
```

---

## 🎯 Résumé

### **Ce qui a été implémenté :**

✅ **Backend :**
- UrlBuilderService pour générer les URLs
- UrlBuilderModule pour l'injection de dépendances
- Tous les contrôleurs modifiés pour retourner `redirectUrl` et `action`

✅ **Frontend :**
- useRedirectAfterAction hook pour gérer les redirections
- ActionNotification composant avec aesthetic Comexa parfaite
- Intégration dans InvoicePdfPreview, ChatPanel, ChatInput

✅ **Design :**
- Glassmorphism respecté
- Couleurs Comexa (bleu #1e86e0)
- Ombres et rayons cohérents
- Animations fluides

### **Ce que l'IA peut faire maintenant :**

1. **Recevoir une réponse API** avec `redirectUrl`
2. **Afficher un lien cliquable** vers Comexa
3. **Ouvrir automatiquement** le lien dans un nouvel onglet
4. **Intégrer avec n8n** ou tout autre outil

### **Prochaines étapes :**

- [ ] Tester les endpoints modifiés
- [ ] Vérifier que les URLs sont correctes
- [ ] Tester les notifications dans le frontend
- [ ] Intégrer avec n8n (si nécessaire)

---

**Date :** 17 octobre 2026  
**Version :** 1.0.0  
**Auteur :** Arena.ai Agent  
**Projet :** Comexa - Système de Redirection
