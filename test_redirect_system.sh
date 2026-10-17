#!/bin/bash

# =============================================================================
# Test du Système de Redirection vers Comexa
# =============================================================================

set -e

echo "=========================================================================="
echo "🔗 Test du Système de Redirection vers Comexa"
echo "=========================================================================="
echo ""

# Couleurs
green='\033[0;32m'
red='\033[0;31m'
yellow='\033[1;33m'
nc='\033[0m' # No Color

# Compteur
passed=0
failed=0

# Fonction pour afficher les résultats
pass() {
    echo -e "${green}✓${nc} $1"
    ((passed++))
}

fail() {
    echo -e "${red}✗${nc} $1"
    ((failed++))
}

warn() {
    echo -e "${yellow}⚠${nc} $1"
}

# =============================================================================
# Tests Backend
# =============================================================================

echo "📦 Vérification des fichiers Backend..."
echo ""

# Vérifier UrlBuilderService
if [ -f "backend/src/common/services/url-builder.service.ts" ]; then
    pass "UrlBuilderService existe"
else
    fail "UrlBuilderService manquant"
fi

# Vérifier UrlBuilderModule
if [ -f "backend/src/common/services/url-builder.module.ts" ]; then
    pass "UrlBuilderModule existe"
else
    fail "UrlBuilderModule manquant"
fi

# Vérifier les imports dans les contrôleurs
for controller in pdf distribution currency exchange-rate balance; do
    controller_file="backend/src/modules/${controller}s/${controller}.controller.ts"
    if [ -f "$controller_file" ]; then
        if grep -q "UrlBuilderService" "$controller_file" && grep -q "urlBuilder" "$controller_file"; then
            pass "${controller^}Controller utilise UrlBuilderService"
        else
            fail "${controller^}Controller n'utilise pas UrlBuilderService"
        fi
    else
        fail "${controller^}Controller manquant"
    fi
done

# Vérifier les imports dans les modules
for module in pdf distribution currency exchange-rate balance; do
    module_file="backend/src/modules/${module}s/${module}.module.ts"
    if [ -f "$module_file" ]; then
        if grep -q "UrlBuilderModule" "$module_file"; then
            pass "${module^}Module importe UrlBuilderModule"
        else
            fail "${module^}Module n'importe pas UrlBuilderModule"
        fi
    else
        fail "${module^}Module manquant"
    fi
done

echo ""

# =============================================================================
# Tests Frontend
# =============================================================================

echo "🖥️  Vérification des fichiers Frontend..."
echo ""

# Vérifier useRedirectAfterAction hook
if [ -f "src/lib/hooks/useRedirectAfterAction.js" ]; then
    pass "useRedirectAfterAction hook existe"
else
    fail "useRedirectAfterAction hook manquant"
fi

# Vérifier ActionNotification composant
if [ -f "src/components/workspace/ui/ActionNotification.jsx" ]; then
    pass "ActionNotification composant existe"
else
    fail "ActionNotification composant manquant"
fi

# Vérifier l'index d'export
if [ -f "src/components/workspace/ui/index.js" ]; then
    pass "Index d'export pour ui existe"
else
    fail "Index d'export pour ui manquant"
fi

# Vérifier les imports dans les composants
for component in InvoicePdfPreview ChatInput ChatPanel; do
    component_file="src/components/workspace/${component,,}.jsx"
    if [ -f "$component_file" ]; then
        if grep -q "useActionNotification" "$component_file"; then
            pass "${component} utilise useActionNotification"
        else
            fail "${component} n'utilise pas useActionNotification"
        fi
    else
        fail "${component} manquant"
    fi
done

echo ""

# =============================================================================
# Tests de Contenu
# =============================================================================

echo "📝 Vérification du contenu des fichiers..."
echo ""

# Vérifier que UrlBuilderService a les bonnes méthodes
if grep -q "buildResponse" "backend/src/common/services/url-builder.service.ts" && \
   grep -q "buildErrorResponse" "backend/src/common/services/url-builder.service.ts" && \
   grep -q "buildUrl" "backend/src/common/services/url-builder.service.ts"; then
    pass "UrlBuilderService a toutes les méthodes nécessaires"
else
    fail "UrlBuilderService manque des méthodes"
fi

# Vérifier que useActionNotification a les bonnes fonctions
if grep -q "redirectTo" "src/lib/hooks/useRedirectAfterAction.js" && \
   grep -q "executeWithRedirect" "src/lib/hooks/useRedirectAfterAction.js" && \
   grep -q "useActionNotification" "src/lib/hooks/useRedirectAfterAction.js"; then
    pass "useActionNotification a toutes les fonctions nécessaires"
else
    fail "useActionNotification manque des fonctions"
fi

# Vérifier que ActionNotification utilise glassmorphism
if grep -q "glassmorphism\|glass-bg\|backdrop-blur" "src/components/workspace/ui/ActionNotification.jsx"; then
    pass "ActionNotification utilise l'aesthetic Comexa (glassmorphism)"
else
    fail "ActionNotification n'utilise pas glassmorphism"
fi

# Vérifier que les contrôleurs retournent redirectUrl
for controller in pdf distribution currency exchange-rate balance; do
    controller_file="backend/src/modules/${controller}s/${controller}.controller.ts"
    if grep -q "redirectUrl\|redirectTo" "$controller_file"; then
        pass "${controller^}Controller retourne redirectUrl"
    else
        warn "${controller^}Controller pourrait manquer redirectUrl"
    fi
done

echo ""

# =============================================================================
# Tests de Structure
# =============================================================================

echo "🏗️  Vérification de la structure des réponses..."
echo ""

# Vérifier que buildResponse retourne le bon format
if grep -q "success.*message.*data.*redirectUrl.*action" "backend/src/common/services/url-builder.service.ts"; then
    pass "UrlBuilderService retourne le bon format de réponse"
else
    fail "UrlBuilderService ne retourne pas le bon format"
fi

# Vérifier que les contrôleurs utilisent buildResponse
for controller in pdf distribution currency exchange-rate balance; do
    controller_file="backend/src/modules/${controller}s/${controller}.controller.ts"
    if grep -q "this.urlBuilder.buildResponse" "$controller_file"; then
        pass "${controller^}Controller utilise buildResponse"
    else
        warn "${controller^}Controller pourrait ne pas utiliser buildResponse"
    fi
done

echo ""

# =============================================================================
# Résumé
# =============================================================================

echo "=========================================================================="
echo "📊 Résumé des Tests"
echo "=========================================================================="
echo ""
echo -e "${green}Passés: $passed${nc}"
echo -e "${red}Échoués: $failed${nc}"
echo -e "${yellow}Avertissements: $((passed + failed))${nc}"
echo ""

if [ $failed -eq 0 ]; then
    echo -e "${green}✓ Tous les tests ont passé !${nc}"
    echo ""
    echo "Le système de redirection est prêt à être utilisé !"
    exit 0
else
    echo -e "${red}✗ Certains tests ont échoué${nc}"
    echo ""
    echo "Veuillez corriger les problèmes avant de continuer."
    exit 1
fi
