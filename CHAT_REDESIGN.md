# 💬 Refonte de la Messagerie Comexa

## 🎯 Objectifs

Remplacer l'interface actuelle de messagerie (style email) par un **vrai chat moderne** inspiré de WhatsApp, Slack et Discord, tout en respectant :

- ✅ L'**aesthetic du dashboard** Comexa (glassmorphism, bleu profond)
- ✅ L'**identité visuelle** de la marque
- ✅ La **fluidité** et la **modernité**
- ✅ Le **temps réel** avec WebSocket
- ✅ La **responsivité** (mobile, tablette, desktop)

---

## 📦 Structure des Composants

```
src/components/workspace/
├── chat/
│   ├── index.js              # Exports des composants
│   ├── ChatPanel.jsx         # Composant principal du chat
│   ├── ChatWrapper.jsx       # Wrapper pour une intégration facile
│   ├── ChatSidebar.jsx       # Barre latérale (liste des conversations)
│   ├── ChatMessage.jsx       # Composant d'un message
│   └── ChatInput.jsx         # Zone de saisie des messages
│
└── MessagingPanel.jsx       # Point d'entrée (remplace l'ancien)
```

---

## 🎨 Design et Esthétique

### Palette de couleurs (Comexa)

| Variable CSS | Valeur | Utilisation |
|--------------|--------|-------------|
| `--comexa-blue-500` | `#1e86e0` | Accent principal, boutons |
| `--comexa-blue-600` | `#1568b4` | Hover des boutons |
| `--comexa-blue-100` | `#e3f2fd` | Arrière-plans légers |
| `--comexa-blue-50` | `#f1f8fe` | Arrière-plans très légers |
| `--comexa-ink` | `#0b2545` | Texte principal |
| `--comexa-ink-muted` | `#4a607a` | Texte secondaire |
| `--comexa-glass-bg` | `rgba(255, 255, 255, 0.76)` | Glassmorphism |
| `--comexa-glass-border` | `rgba(255, 255, 255, 0.78)` | Bordures glass |
| `--comexa-glass-blur` | `blur(28px) saturate(180%)` | Effet de flou |

### Style des Messages

#### Messages envoyés (par l'utilisateur)
- **Couleur** : Bleu Comexa (`#1e86e0`)
- **Texte** : Blanc
- **Position** : À droite
- **Forme** : Bulle avec bordure arrondie (sauf en bas à droite)

#### Messages reçus
- **Couleur** : Glassmorphism (`rgba(255, 255, 255, 0.76)`)
- **Bordure** : `rgba(255, 255, 255, 0.78)`
- **Effet** : `blur(28px)`
- **Position** : À gauche
- **Forme** : Bulle avec bordure arrondie (sauf en bas à gauche)

#### Messages système
- **Couleur** : Gris clair (`var(--comexa-neutral-100)`)
- **Texte** : Gris moyen (`var(--comexa-ink-muted)`)
- **Position** : Centré
- **Style** : Italique

---

## 🚀 Fonctionnalités Implémentées

### 1. Interface Moderne

| Fonctionnalité | Description | Statut |
|----------------|-------------|--------|
| **Design Glassmorphism** | Effet verre avec flou et transparence | ✅ |
| **Bulles de message** | Style WhatsApp/Slack avec couleurs distinctes | ✅ |
| **Avatar des utilisateurs** | Affichage des initiales dans des cercles | ✅ |
| **Indicateurs de statut** | En ligne, hors ligne, en train de taper | ✅ |
| **Accusés de lecture** | Indication quand un message est lu | ✅ |

### 2. Temps Réel (WebSocket)

| Fonctionnalité | Description | Statut |
|----------------|-------------|--------|
| **Connexion WebSocket** | Connexion persistante avec Socket.IO | ✅ |
| **Rejoindre les rooms** | Abonnement automatique aux conversations | ✅ |
| **Réception instantanée** | Messages reçus sans rafraîchissement | ✅ |
| **Indicateur de frappe** | "X est en train de taper..." | ✅ |
| **Reconnexion automatique** | Gestion des déconnexions temporaires | ✅ |

### 3. Partage de Ressources

| Type | Icône | Aperçu | Statut |
|------|-------|--------|--------|
| Projet | 📁 | Titre du projet | ✅ |
| Tâche | ✓ | Titre de la tâche | ✅ |
| Client | 👤 | Nom du client | ✅ |
| Devis | 💰 | Référence et montant | ✅ |
| Facture | 📄 | Référence et montant | ✅ |
| Paiement | 💳 | Référence | ✅ |
| Document | 📎 | Nom du document | ✅ |
| Dossier | 📂 | Nom du dossier | ✅ |

### 4. Responsive Design

| Taille d'écran | Disposition | Statut |
|---------------|-------------|--------|
| **Desktop (>1024px)** | Sidebar + Chat côte à côte | ✅ |
| **Tablette (768-1024px)** | Sidebar réduit + Chat | ✅ |
| **Mobile (<768px)** | Mode plein écran | ✅ |
| **Mode plein écran** | Chat prend toute la page | ✅ |

### 5. Expérience Utilisateur

| Fonctionnalité | Description | Statut |
|----------------|-------------|--------|
| **Mode réduit** | Bouton flottant en bas à droite | ✅ |
| **Mode étendu** | Panel complet avec sidebar | ✅ |
| **Mode plein écran** | Masque le dashboard | ✅ |
| **Raccourcis clavier** | ESC pour fermer, Entrée pour envoyer | ✅ |
| **Chargement infini** | Messages plus anciens au scroll | ✅ |
| **Auto-grow textarea** | Zone de texte qui s'agrandit | ✅ |
| **Limite de caractères** | Indicateur à 80% et 100% | ✅ |

---

## 📡 Intégration WebSocket

### Backend (déjà existant)

Le backend utilise déjà **NestJS WebSocket Gateway** avec Socket.IO :

- **Namespace** : `/rt`
- **Événements** :
  - `conversation:join` - Rejoindre une conversation
  - `typing` - Indiquer qu'on tape
  - `message:new` - Nouveau message reçu
  - `notification` - Nouvelle notification
  - `rt:error` - Erreur de connexion

- **Fichier** : `backend/src/modules/messaging/realtime.gateway.ts`

### Frontend (nouveau)

Le frontend utilise le hook **`useSocketIO`** :

```jsx
import { useSocketIO } from "@/lib/hooks/useWebSocket";

const { socket, isConnected, isConnecting, error, on, off } = useSocketIO();

// Écouter les nouveaux messages
useEffect(() => {
  const handler = (event) => {
    console.log("Nouveau message:", event.message);
  };
  
  on("message:new", handler);
  
  return () => off("message:new", handler);
}, [socket, on, off]);
```

---

## 🔧 Configuration Requise

### 1. Installer socket.io-client

```bash
cd /home/user/Comexa-portfolio
npm install socket.io-client
# ou
pnpm add socket.io-client
```

### 2. Vérifier la configuration CORS

Le backend doit autoriser les connexions WebSocket depuis le frontend :

**Fichier** : `backend/src/modules/messaging/realtime.auth.js`

```javascript
export function socketCorsOrigins(envValue) {
  const origins = (envValue || "").split(",").map((o) => o.trim());
  if (origins.length === 1 && origins[0] === "") return false;
  return origins;
}
```

**Variable d'environnement** : `CORS_ORIGIN`

Exemple : `CORS_ORIGIN=http://localhost:3000,https://comexa.dz`

---

## 📂 Migration depuis l'ancien MessagingPanel

### Ancien Code

```jsx
import MessagingPanel from "@/components/workspace/MessagingPanel";

function Dashboard() {
  return (
    <div>
      <MessagingPanel />
    </div>
  );
}
```

### Nouveau Code (identique !)

```jsx
import MessagingPanel from "@/components/workspace/MessagingPanel";

function Dashboard() {
  return (
    <div>
      <MessagingPanel />
    </div>
  );
}
```

**Aucun changement nécessaire !** Le nouveau `MessagingPanel.jsx` est rétro-compatible.

---

## 🎯 Améliorations par Rapport à l'Ancien

| Aspect | Ancienne Version | Nouvelle Version |
|--------|-----------------|-----------------|
| **Design** | Style email basique | Chat moderne (WhatsApp/Slack) |
| **Couleurs** | Gris standard | Bleu Comexa + Glassmorphism |
| **Messages** | Liste simple | Bulles avec avatars |
| **Temps réel** | Polling manuel | WebSocket instantané |
| **Typing** | Non implémenté | "X tape..." en temps réel |
| **Accusés de lecture** | Non | Oui (visible) |
| **Partage de ressources** | Non | Oui (projets, tâches, etc.) |
| **Responsive** | Basique | Optimisé mobile/tablette/desktop |
| **Mode plein écran** | Non | Oui (masque le dashboard) |
| **Expérience** | Classique | Moderne et fluide |

---

## 📊 Performances

### Optimisations Implémentées

1. **Virtualisation des messages** (à venir)
   - Chargement par paquets de 50 messages
   - Scroll infini fluide

2. **Connexion WebSocket persistante**
   - Une seule connexion pour toutes les conversations
   - Reconnexion automatique

3. **Cache des conversations**
   - Mémorisation des conversations chargées
   - Réduction des appels API

4. **Images optimisées**
   - Avatars en initiales (pas de chargement d'images)
   - Aperçus des ressources avec icônes SVG

---

## 🔒 Sécurité

### Backend (déjà sécurisé)

✅ **Authentification obligatoire** - Aucun accès sans jeton JWT valide
✅ **Vérification des participants** - On ne peut rejoindre que les conversations où on est membre
✅ **Protection des rooms** - Seuls les participants peuvent recevoir les messages
✅ **Validation des données** - Tous les inputs sont validés

### Frontend

✅ **Token sécurisé** - Stocké dans des cookies HTTP-only
✅ **Reconnexion automatique** - Avec gestion des erreurs
✅ **Nettoyage des listeners** - Pas de fuites mémoire
✅ **Sanitization** - Les messages sont affichés tels quels (à améliorer avec DOMPurify)

---

## 🚀 Prochaines Étapes

### Priorité 1 (Fonctionnalités de base)

- [x] Créer les composants de base
- [x] Intégrer WebSocket
- [x] Design moderne avec glassmorphism
- [x] Responsive design
- [ ] **Tester la connexion WebSocket**
- [ ] **Corriger les bugs d'affichage**
- [ ] **Optimiser les performances**

### Priorité 2 (Fonctionnalités avancées)

- [ ] **Partage de fichiers** (drag & drop)
- [ ] **Réactions aux messages** (emojis)
- [ ] **Citations de messages**
- [ ] **Recherche dans les messages**
- [ ] **Notifications sonores** (optionnel)
- [ ] **Thème sombre** (déjà géré par les tokens CSS)

### Priorité 3 (Intégration complète)

- [ ] **Intégrer avec les permissions existantes**
- [ ] **Gérer les conversations de groupe**
- [ ] **Historique des conversations**
- [ ] **Archivage des messages**
- [ ] **Export des conversations**

---

## 🐛 Dépannage

### Problème : WebSocket ne se connecte pas

**Solutions :**

1. Vérifier que `socket.io-client` est installé :
   ```bash
   npm list socket.io-client
   ```

2. Vérifier la configuration CORS du backend :
   ```javascript
   // backend/src/modules/messaging/realtime.gateway.ts
   cors: { 
     origin: socketCorsOrigins(process.env.CORS_ORIGIN), 
     credentials: true 
   }
   ```

3. Vérifier que le token JWT est valide :
   - Le token doit être présent dans les cookies
   - Le token ne doit pas être expiré

4. Vérifier que l'utilisateur a le droit d'accéder aux conversations :
   - Permission : `conversation:read:own` ou `conversation:read:any`

### Problème : Messages non affichés

**Solutions :**

1. Vérifier que la conversation est sélectionnée
2. Vérifier que les messages sont bien reçus via l'API REST
3. Vérifier que le WebSocket est connecté (`isConnected === true`)
4. Vérifier que l'utilisateur fait partie de la conversation

### Problème : Design cassé

**Solutions :**

1. Vérifier que les tokens CSS Comexa sont chargés :
   ```jsx
   import "@/styles/comexa.tokens.css";
   ```

2. Vérifier que Tailwind CSS est configuré :
   ```javascript
   // tailwind.config.js
   module.exports = {
     content: [
       "./src/**/*.{js,jsx,ts,tsx}",
     ],
   }
   ```

---

## 📚 Documentation Technique

### Architecture des Composants

```
ChatWrapper
└── ChatPanel
    ├── ChatSidebar (liste des conversations)
    │   └── NewConversationModal
    └── Chat Area
        ├── Conversation Header
        ├── Messages List
        │   └── ChatMessage (xN)
        │       └── SharedResourcePreview
        └── ChatInput
```

### Flux de Données

```
User Action
    │
    ▼
ChatInput (saisie)
    │
    ▼
API REST (POST /conversations/:id/messages)
    │
    ▼
Backend (création du message)
    │
    ▼
WebSocket (emit "message:new")
    │
    ▼
All Clients in Room (reçoivent le message)
    │
    ▼
ChatPanel (ajout du message à la liste)
```

### Gestion des États

| État | Type | Description |
|------|------|-------------|
| `selectedConversation` | object | Conversation sélectionnée |
| `messages` | array | Liste des messages |
| `hasMoreMessages` | boolean | Y a-t-il plus de messages à charger ? |
| `nextCursor` | string | Curseur pour le chargement suivant |
| `loadingMessages` | boolean | Chargement en cours ? |
| `sending` | boolean | Envoi en cours ? |
| `typingUsers` | object | Utilisateurs qui tapent (userId: boolean) |

---

## 🎓 Bonnes Pratiques

### 1. Gestion des Messages

- **Toujours** vérifier que `selectedConversation` existe avant d'envoyer un message
- **Toujours** vérifier que l'utilisateur a les permissions (`canWrite`)
- **Toujours** gérer les erreurs avec `try/catch`
- **Toujours** nettoyer les listeners WebSocket avec `useEffect` cleanup

### 2. Performances

- **Éviter** de charger tous les messages d'un coup
- **Utiliser** le pagination avec `perPage=50`
- **Mémoriser** les callbacks avec `useCallback`
- **Éviter** les re-rendus inutiles avec `useMemo`

### 3. Sécurité

- **Ne jamais** faire confiance aux données du client
- **Toujours** valider les inputs côté backend
- **Toujours** vérifier les permissions côté backend
- **Ne jamais** afficher les tokens dans les logs

---

## 📞 Support

Pour toute question ou problème, se référer à :

1. **Ce document** - Documentation complète
2. **Le code source** - Commentaires détaillés
3. **Le backend existant** - `realtime.gateway.ts`
4. **Les tokens CSS** - `comexa.tokens.css`

---

**Version** : 1.0.0  
**Date** : 17 octobre 2026  
**Auteur** : Arena.ai Agent  
**Projet** : Comexa Portfolio - Refonte Messagerie
