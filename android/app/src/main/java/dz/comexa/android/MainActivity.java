package dz.comexa.android;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.HttpAuthHandler;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * Fenêtre unique de l'application Android Comexa : le pendant mobile du
 * processus Electron de `desktop/main.js`, avec les mêmes garde-fous.
 *
 * PRINCIPE. Aucune copie du site n'est embarquée : la WebView ouvre le
 * déploiement hébergé sur le hub `/espaces`. Les cookies de session (HttpOnly,
 * posés par `/api/auth`) sont ceux de la WebView, persistants : connexion,
 * déconnexion et temps réel fonctionnent comme dans un navigateur.
 *
 * SÉCURITÉ. HTTPS strict (tout certificat douteux est rejeté, le trafic clair
 * interdit) ; navigation limitée à l'origine configurée et aux chemins de
 * {@link AppConfig} ; aucune interface JavaScript native (pas de
 * `addJavascriptInterface` : le site n'a aucun pont vers Android) ; aucune
 * fenêtre supplémentaire ; les autres domaines partent dans le navigateur du
 * téléphone ; aucun accès aux fichiers locaux ni au contenu du fournisseur.
 */
public class MainActivity extends Activity {

    private static final String TAG = "Comexa";

    /** Noir de la coque (`--shell`) : les barres système le prolongent. */
    private static final String SHELL_COLOR = "#0b0a0f";

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        setContentView(web);

        applyEdgeToEdge();
        configureWebSettings();

        web.setWebViewClient(new LockedWebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                // Aucune fenêtre supplémentaire, jamais.
                return false;
            }
        });
        web.setDownloadListener(this::enqueueDownload);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        requestNotificationPermission();
        web.loadUrl(AppConfig.startUrl());
    }

    /**
     * Bord à bord : la fenêtre s'étire sous les barres système, assorties au
     * noir de la coque, et le contenu utile est rembourré par les insets — la
     * navbar du site arrive exactement sous l'horloge, sans marge blanche.
     */
    private void applyEdgeToEdge() {
        getWindow().setStatusBarColor(Color.parseColor(SHELL_COLOR));
        getWindow().setNavigationBarColor(Color.parseColor(SHELL_COLOR));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }

        web.setOnApplyWindowInsetsListener((view, insets) -> {
            int left;
            int top;
            int right;
            int bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                left = bars.left;
                top = bars.top;
                right = bars.right;
                bottom = bars.bottom;
            } else {
                left = insets.getSystemWindowInsetLeft();
                top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight();
                bottom = insets.getSystemWindowInsetBottom();
            }
            view.setPadding(left, top, right, bottom);
            return insets;
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebSettings() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);        // le site est une application React
        settings.setDomStorageEnabled(true);        // préférences et état local du site
        settings.setDatabaseEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setAllowFileAccess(false);         // aucun fichier local exposé au site
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        // Pas de addJavascriptInterface : aucune API native reachable depuis JS.
    }

    /** Verrou de navigation, miroir de `lockNavigation()` côté desktop. */
    private final class LockedWebViewClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return routeUrl(view, request.getUrl());
        }

        /**
         * Next.js navigue côté client (pushState) : aucun chargement complet ne
         * part, on contrôle donc l'URL observée — l'équivalent de
         * `did-navigate-in-page` — et on ramène au hub si besoin.
         */
        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            super.doUpdateVisitedHistory(view, url, isReload);
            Uri parsed = Uri.parse(url);
            if (AppConfig.isSameOrigin(parsed) && !AppConfig.isAllowedPath(parsed.getPath())) {
                Log.w(TAG, "Route hors périmètre via pushState : " + url);
                view.loadUrl(AppConfig.startUrl());
            }
        }

        /** HTTPS strict : un certificat douteux coupe le chargement. */
        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
        }

        /** Aucune invite d'authentification native : le site gère la connexion. */
        @Override
        public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
            handler.cancel();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                showOffline(error.getErrorCode(), String.valueOf(error.getDescription()));
            }
        }
    }

    /**
     * Décide du sort d'une URL : chargement interne, retour au hub, ou
     * navigateur du système pour ce qui vit hors du périmètre.
     */
    private boolean routeUrl(WebView view, Uri url) {
        String scheme = url.getScheme();

        if (scheme == null || !scheme.equalsIgnoreCase("https")) {
            // `http:` brut, `file:`, `intent:`… : refusé. `mailto:` et `tel:`
            // partent à l'application compétente du téléphone.
            if (scheme != null && (scheme.equalsIgnoreCase("mailto") || scheme.equalsIgnoreCase("tel"))) {
                openExternal(url);
            }
            return true;
        }
        if (!AppConfig.isSameOrigin(url)) {
            openExternal(url);
            return true;
        }
        if (AppConfig.isAllowedPath(url.getPath())) {
            return false;
        }
        Log.w(TAG, "Navigation refusée : " + url);
        view.loadUrl(AppConfig.startUrl());
        return true;
    }

    private void openExternal(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (Exception e) {
            Log.w(TAG, "Aucune application pour " + url);
        }
    }

    /**
     * Réseau coupé ou service injoignable : la page locale `offline.html`,
     * servie sans origine privilégiée (baseURL nulle). Le lien « Réessayer »
     * est une URL https absolue du service, donc reprise par le verrou.
     */
    private void showOffline(int code, String detail) {
        Log.w(TAG, "Chargement impossible (" + code + " " + detail + ")");
        String html = readAsset("offline.html");
        if (html == null) {
            web.loadUrl(AppConfig.startUrl());
            return;
        }
        String params = "retry=" + Uri.encode(AppConfig.startUrl())
                + "&code=" + Uri.encode(String.valueOf(code))
                + "&detail=" + Uri.encode(detail);
        String injected = "<script>window.__COMEXA_OFFLINE_PARAMS__=\"" + params + "\";</script></head>";
        web.loadDataWithBaseURL(null, html.replace("</head>", injected), "text/html", "utf-8", null);
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name);
             BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            StringBuilder out = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                out.append(line).append('\n');
            }
            return out.toString();
        } catch (IOException e) {
            return null;
        }
    }

    /**
     * Téléchargements (factures et devis PDF) : le DownloadManager du système,
     * avec le cookie de session recopié — l'API de téléchargement est protégée
     * par l'authentification. Le cookie de session reste ainsi dans le circuit
     * du téléchargement, sans passer par un navigateur tiers.
     */
    private void enqueueDownload(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
        Uri parsed = Uri.parse(url);
        if (!AppConfig.isSameOrigin(parsed)) {
            openExternal(parsed);
            return;
        }
        String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
        DownloadManager.Request request = new DownloadManager.Request(parsed);
        request.setMimeType(mimeType);
        request.addRequestHeader("User-Agent", userAgent);
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie != null) {
            request.addRequestHeader("Cookie", cookie);
        }
        request.setTitle(fileName);
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            request.setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, fileName);
        }
        DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        if (manager != null) {
            manager.enqueue(request);
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 41);
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        // Historique de la WebView d'abord (retour dans un espace), puis sortie.
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
        }
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.onPause();
        }
        // La session (cookie HttpOnly) doit survivre à une mise en arrière-plan.
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
        }
        super.onDestroy();
    }
}
