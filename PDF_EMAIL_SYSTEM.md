# 📄 Système d'Export PDF et Envoi par Email

## 🎯 Objectifs

Créer un système **simple, épuré et professionnel** pour :

1. **Exporter les factures et devis en PDF** avec l'identité visuelle Comexa
2. **Envoyer les documents par email** directement depuis la plateforme
3. **Respecter l'aesthetic du dashboard** (glassmorphism, bleu Comexa)

---

## ✅ Fonctionnalités Implémentées

### 1. Génération PDF

| Fonctionnalité | Description | Statut |
|---------------|-------------|--------|
| **Génération de PDF** | Factures et devis en PDF professionnel | ✅ |
| **Design Comexa** | Logo, couleurs, typographie Comexa | ✅ |
| **Informations complètes** | Entreprise, client, items, totaux | ✅ |
| **Multi-langues** | Français, Anglais, Arabe | ✅ |
| **Aperçu inline** | Visualisation avant téléchargement | ✅ |
| **Téléchargement** | Export direct du PDF | ✅ |

### 2. Envoi par Email

| Fonctionnalité | Description | Statut |
|---------------|-------------|--------|
| **Envoi SMTP** | Configuration flexible (Gmail, SendGrid, etc.) | ✅ |
| **Pièce jointe PDF** | Facture/devis joint au mail | ✅ |
| **Message personnalisé** | Sujet et contenu personnalisables | ✅ |
| **Notifications** | Confirmation d'envoi | ✅ |

### 3. Intégration Frontend

| Composant | Description | Statut |
|-----------|-------------|--------|
| `InvoicePdfPreview` | Modal de prévisualisation PDF | ✅ |
| `InvoicePdfActions` | Boutons d'actions (aperçu, télécharger, email) | ✅ |
| **Intégration facile** | Utilisation directe dans les listes | ✅ |

---

## 📁 Structure des Fichiers

```
backend/
├── src/
│   ├── modules/
│   │   ├── pdf/
│   │   │   ├── pdf.service.ts      # Service de génération PDF
│   │   │   ├── pdf.module.ts       # Module PDF
│   │   │   ├── pdf.controller.ts   # Contrôleur REST
│   │   │   ├── dto/
│   │   │   │   └── pdf.dto.ts      # DTOs
│   │   │   └── index.ts
│   │   │
│   │   └── email/
│   │       ├── email.service.ts    # Service d'email
│   │       ├── email.module.ts     # Module Email
│   │       ├── email.controller.ts # Contrôleur REST
│   │       └── index.ts
│
frontend/
└── src/
    └── components/
        └── workspace/
            └── invoices/
                ├── InvoicePdfPreview.jsx  # Modal de prévisualisation
                ├── InvoicePdfActions.jsx   # Boutons d'actions
                └── index.js
```

---

## 🎨 Design et Esthétique

### Template PDF

**Structure d'une facture PDF :**

```
┌─────────────────────────────────────────────────────────────┐
│  LOGO COMEXA                    FACTURE N°INV-001              │
│  Comexa Sarl                                             Date  │
│  Adresse: ...                          Échéance: ...              │
│  Tel: ...                              Statut: Payé               │
├─────────────────────────────────────────────────────────────┤
│                                                                 │
│  FACTURÉ À:                                                      │
│  Nom du Client                                                   │
│  Adresse du client                                                │
│                                                                 │
├─────────────────────────────────────────────────────────────┤
│  Description          Qté    P.U.       Montant                 │
├─────────────────────────────────────────────────────────────┤
│  Service 1            1      1000 DZD  1000 DZD                │
│  Service 2            2      500 DZD   1000 DZD                │
├─────────────────────────────────────────────────────────────┤
│                                                                 │
│                          Sous-total: 2000 DZD                   │
│                              TVA: 0 DZD                       │
│                           TOTAL: 2000 DZD                     │
├─────────────────────────────────────────────────────────────┤
│  PAIEMENTS:                                                     │
│  01/01/2026 - 1000 DZD                                          │
│  15/01/2026 - 1000 DZD                                          │
│                                                                 │
│  Total payé: 2000 DZD                                            │
│  Solde dû: 0 DZD                                                │
├─────────────────────────────────────────────────────────────┤
│  Conditions de paiement: Paiement à réception                    │
│                                                                 │
│  Signature: _______________________                             │
└─────────────────────────────────────────────────────────────┘
```

### Couleurs PDF

| Élément | Couleur | Variable CSS |
|---------|---------|--------------|
| Texte principal | Bleu profond | `--comexa-blue-900` (#0b2545) |
| Accent | Bleu Comexa | `--comexa-blue-500` (#1e86e0) |
| Arrière-plan | Blanc | `--comexa-white` (#ffffff) |
| Bordures | Gris clair | `--comexa-border-soft` |

---

## 🚀 API REST

### Endpoints PDF

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| GET | `/api/pdf/invoices/:id` | Télécharger PDF facture | ✅ |
| GET | `/api/pdf/invoices/:id/preview` | Aperçu inline facture | ✅ |
| GET | `/api/pdf/quotes/:id` | Télécharger PDF devis | ✅ |
| GET | `/api/pdf/quotes/:id/preview` | Aperçu inline devis | ✅ |

### Endpoints Email

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| GET | `/api/email/test` | Tester la configuration | 🔐 |
| POST | `/api/email/invoices/send` | Envoyer facture par email | ✅ |
| POST | `/api/email/quotes/send` | Envoyer devis par email | ✅ |
| POST | `/api/email/send` | Envoyer email personnalisé | 🔐 |

---

## 🔧 Configuration

### Variables d'Environnement

**Pour le PDF :**

```bash
# Chemin vers le logo (optionnel)
PDF_LOGO_PATH=public/images/comexa-logo.png

# Informations de l'entreprise
PDF_COMPANY_NAME=Comexa
PDF_COMPANY_ADDRESS=Adresse de l'entreprise
PDF_COMPANY_CITY=Algiers
PDF_COMPANY_POSTAL=16000
PDF_COMPANY_COUNTRY=Algérie
PDF_COMPANY_PHONE=+213 123 456 789
PDF_COMPANY_EMAIL=contact@comexa.dz
PDF_COMPANY_WEBSITE=https://comexa.dz
PDF_COMPANY_TAX_ID=TAX123456
PDF_COMPANY_REGISTRATION=REG123456
```

**Pour l'email :**

```bash
# Configuration SMTP
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=votre@email.com
EMAIL_PASSWORD=votre-mot-de-passe
EMAIL_FROM=noreply@comexa.dz
```

---

## 📦 Dépendances Requises

### Backend (Node.js)

```bash
npm install canvas
```

Le package `canvas` est utilisé pour générer les PDF côté serveur. Il nécessite des dépendances système :

**Sur Ubuntu/Debian :**
```bash
sudo apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

**Sur CentOS/RHEL :**
```bash
sudo yum install -y cairo pango-devel libjpeg-turbo-devel giflib-devel librsvg2-devel
```

**Sur macOS :**
```bash
brew install pkg-config cairo pango libpng jpeg giflib librsvg
```

### Frontend (React)

Aucune dépendance supplémentaire nécessaire. Les PDF sont générés côté serveur.

---

## 💡 Utilisation

### 1. Générer un PDF en Backend

```typescript
// backend/src/modules/pdf/pdf.service.ts

// Générer une facture
const pdfBuffer = await this.pdfService.generateInvoicePdf(invoiceId, {
  includeSignature: true,
  includeTerms: true,
  language: 'fr',
});

// Sauvegarder ou envoyer
fs.writeFileSync(`facture-${invoiceId}.pdf`, pdfBuffer);
```

### 2. Télécharger un PDF depuis le Frontend

```jsx
// Téléchargement direct
const downloadPdf = async (invoiceId) => {
  const response = await fetch(`/api/pdf/invoices/${invoiceId}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `facture-${invoiceId}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
};
```

### 3. Utiliser le composant InvoicePdfActions

```jsx
import { InvoicePdfActions } from "@/components/workspace/invoices";

function InvoiceRow({ invoice }) {
  return (
    <tr>
      <td>{invoice.reference}</td>
      <td>{invoice.client.name}</td>
      <td>{invoice.total}</td>
      <td>
        <InvoicePdfActions
          invoiceId={invoice.id}
          reference={invoice.reference}
          size="sm"
        />
      </td>
    </tr>
  );
}
```

### 4. Ouvrir la prévisualisation

```jsx
import { InvoicePdfPreview } from "@/components/workspace/invoices";

function InvoiceDetail({ invoice }) {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div>
      <button onClick={() => setShowPreview(true)}>
        Aperçu PDF
      </button>
      
      {showPreview && (
        <InvoicePdfPreview
          invoiceId={invoice.id}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}
```

---

## 📧 Exemple d'Email

### Email de facture

**Sujet :** Facture INV-001

**Contenu :**
```html
<p>Bonjour John Doe,</p>
<p>Veuillez trouver ci-joint la facture <strong>INV-001</strong> d'un montant de <strong>2000 DZD</strong>.</p>
<p>Date d'échéance: 31/12/2026</p>
<p>Cordialement,<br/>L'équipe Comexa</p>
```

**Pièce jointe :** facture-INV-001.pdf

---

## 🎯 Intégration avec l'Aesthetic du Dashboard

### Design des Composants Frontend

**InvoicePdfActions :**
- Boutons avec icônes SVG
- Couleurs Comexa (bleu #1e86e0)
- Glassmorphism pour les modals
- Ombres douces
- Transitions fluides

**InvoicePdfPreview :**
- Modal avec fond semi-transparent
- Aperçu PDF dans un iframe
- Boutons d'action en haut à droite
- Design épuré

### Exemple de Style

```css
/* Boutons d'action */
.button {
  background: var(--comexa-blue-500);
  color: white;
  border-radius: var(--comexa-radius-md);
  transition: all 240ms var(--comexa-ease-spring);
  box-shadow: var(--comexa-shadow-sm);
}

.button:hover {
  background: var(--comexa-blue-600);
  box-shadow: var(--comexa-shadow-md);
}

/* Modal */
.modal {
  background: var(--comexa-surface);
  border-radius: var(--comexa-radius-lg);
  box-shadow: var(--comexa-shadow-xl);
  backdrop-filter: blur(8px);
}
```

---

## 🔒 Sécurité

### Backend

✅ **Authentification obligatoire** - Tous les endpoints nécessitent un token JWT valide
✅ **Vérification des permissions** - `invoice:read` pour consulter, `email:send` pour envoyer
✅ **Validation des données** - Vérification que la facture/devis existe et appartient à l'utilisateur
✅ **Protection contre les injections** - Pas de HTML brut dans les emails (à améliorer avec sanitization)

### Frontend

✅ **Accès contrôlé** - Les boutons ne s'affichent que si l'utilisateur a les permissions
✅ **Téléchargement sécurisé** - Le PDF est généré côté serveur, pas de manipulation client
✅ **Protection des données** - Aucune donnée sensible n'est exposée dans les URLs

---

## 🐛 Dépannage

### Problème : PDF non généré

**Solutions :**

1. Vérifier que le package `canvas` est installé :
   ```bash
   npm list canvas
   ```

2. Vérifier les dépendances système :
   ```bash
   # Ubuntu
   sudo apt-get install -y libcairo2-dev libpango1.0-dev
   ```

3. Vérifier que le logo existe :
   ```bash
   ls public/images/comexa-logo.png
   ```

4. Vérifier les permissions :
   ```javascript
   // L'utilisateur doit avoir la permission 'invoice:read'
   can(user, 'invoice', 'read')
   ```

### Problème : Email non envoyé

**Solutions :**

1. Vérifier la configuration SMTP :
   ```bash
   echo $EMAIL_HOST
   echo $EMAIL_USER
   ```

2. Tester la configuration :
   ```bash
   curl -X GET http://localhost:3000/api/email/test \
     -H "Authorization: Bearer <TOKEN>"
   ```

3. Vérifier les logs :
   ```bash
   # Voir les erreurs de connexion SMTP
   journalctl -u your-app-service
   ```

4. Vérifier les permissions :
   ```javascript
   // L'utilisateur doit avoir la permission 'email:send'
   can(user, 'email', 'send')
   ```

### Problème : Design cassé

**Solutions :**

1. Vérifier que les tokens CSS sont chargés :
   ```jsx
   import "@/styles/comexa.tokens.css";
   ```

2. Vérifier que Tailwind est configuré :
   ```javascript
   // tailwind.config.js
   module.exports = {
     content: ["./src/**/*.{js,jsx}"],
   }
   ```

3. Vérifier les classes CSS :
   ```css
   /* Doit utiliser les variables Comexa */
   background: var(--comexa-surface);
   color: var(--comexa-ink);
   ```

---

## 📊 Performances

### Optimisations

1. **Génération côté serveur** - Pas de charge sur le client
2. **Cache des PDF** - Possibilité de cache côté serveur (à implémenter)
3. **Streaming** - Envoi du PDF en streaming pour les gros fichiers
4. **Compression** - PDF optimisés pour le web

### Benchmark

| Action | Temps estimé |
|--------|--------------|
| Génération PDF (facture simple) | < 500ms |
| Génération PDF (facture complexe) | < 1s |
| Envoi email | < 2s (dépend du serveur SMTP) |
| Téléchargement | Instantané (streaming) |

---

## 🚀 Prochaines Étapes

### Priorité 1 (À faire immédiatement)

- [ ] Installer les dépendances système pour `canvas`
- [ ] Configurer les variables d'environnement (logo, entreprise, SMTP)
- [ ] Tester la génération PDF
- [ ] Tester l'envoi par email

### Priorité 2 (Améliorations)

- [ ] Ajouter le cache des PDF générés
- [ ] Implémenter la signature électronique
- [ ] Ajouter des templates personnalisables
- [ ] Supporter plus de langues
- [ ] Ajouter des options de personnalisation (couleurs, logo, etc.)

### Priorité 3 (Fonctionnalités avancées)

- [ ] Génération de PDF par lot
- [ ] Export en Excel/CSV
- [ ] Historique des envois
- [ ] Notifications de lecture
- [ ] Suivi des emails envoyés

---

## 📚 Documentation Technique

### Architecture

```
Frontend → API REST → PDF Service → Canvas → PDF Buffer → Response
                          ↓
                    Email Service → SMTP → Email
```

### Flux de Génération PDF

```
1. Requête API: GET /api/pdf/invoices/:id
2. Récupération de la facture en base de données
3. Génération du canvas avec les informations
4. Dessin du logo, texte, tableau, totaux
5. Conversion en buffer PDF
6. Retour du PDF au client
```

### Flux d'Envoi par Email

```
1. Requête API: POST /api/email/invoices/send
2. Validation des permissions
3. Génération du PDF (optionnelle)
4. Préparation de l'email (sujet, contenu, pièce jointe)
5. Envoi via SMTP
6. Retour de la confirmation
```

---

## 🎓 Bonnes Pratiques

### Backend

1. **Toujours** valider les permissions avant de générer un PDF
2. **Toujours** vérifier que le document existe et n'est pas supprimé
3. **Ne jamais** inclure de données sensibles dans les métadonnées du PDF
4. **Toujours** nettoyer les ressources (canvas, buffers) après utilisation
5. **Utiliser** des transactions pour les opérations critiques

### Frontend

1. **Toujours** vérifier les permissions avant d'afficher les boutons
2. **Toujours** gérer les erreurs avec des messages clairs
3. **Ne jamais** afficher les tokens ou informations sensibles
4. **Utiliser** des states pour gérer le chargement et les erreurs
5. **Nettoyer** les URLs des blobs après utilisation

---

## 📞 Support

Pour toute question ou problème, se référer à :

1. **Ce document** - Documentation complète
2. **Le code source** - Commentaires détaillés
3. **Les tests** - Exemples d'utilisation
4. **La documentation NestJS** - Pour la configuration avancée

---

**Version** : 1.0.0  
**Date** : 17 octobre 2026  
**Auteur** : Arena.ai Agent  
**Projet** : Comexa Portfolio - Système PDF + Email
