package dz.comexa.android;

import android.net.Uri;

/**
 * Périmètre et adresse du service : le miroir Android de `desktop/config.js`.
 *
 * Une seule origine, HTTPS, et une liste fermée de chemins ouverts : le hub,
 * les quatre espaces et le parcours de connexion. Tout le reste — site public,
 * autres domaines, schémas exotiques — est refusé ou délégué au navigateur.
 */
public final class AppConfig {

    /** Chemins ouverts, comparés par segment : `/espaces` n'ouvre pas `/espaces-x`. */
    private static final String[] ALLOWED_PREFIXES = {
            "/espaces",
            "/espace-personnel",
            "/espace-equipe",
            "/espace-comexa",
            "/espace-client",
            "/connexion",
            "/inscription",
            "/mot-de-passe-oublie",
            "/reset-password",
            "/verify-email",
    };

    private AppConfig() {
    }

    public static String origin() {
        return BuildConfig.SERVICE_ORIGIN;
    }

    /** URL d'entrée : l'origine + le hub des espaces. */
    public static String startUrl() {
        return BuildConfig.SERVICE_ORIGIN + BuildConfig.START_PATH;
    }

    /** Même hôte, même port, et HTTPS uniquement. */
    public static boolean isSameOrigin(Uri url) {
        if (url == null || !"https".equalsIgnoreCase(url.getScheme())) {
            return false;
        }
        Uri origin = Uri.parse(origin());
        return origin.getHost() != null
                && origin.getHost().equalsIgnoreCase(url.getHost())
                && origin.getPort() == url.getPort();
    }

    public static boolean isAllowedPath(String path) {
        if (path == null || path.isEmpty()) {
            return false;
        }
        for (String prefix : ALLOWED_PREFIXES) {
            if (path.equals(prefix) || path.startsWith(prefix + "/")) {
                return true;
            }
        }
        return false;
    }
}
