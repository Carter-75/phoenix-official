package com.phoenix.fall;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;
import com.codetrixstudio.capacitor.GoogleAuth.GoogleAuth;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Capacitor requires custom plugins to be registered before super.onCreate.
        this.registerPlugin(GoogleAuth.class);
        super.onCreate(savedInstanceState);
        // Build type marker read by monetization.config.ts: release builds
        // get production ad units, every debug build stays on test ads.
        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebSettings settings = this.bridge.getWebView().getSettings();
            String marker = BuildConfig.DEBUG ? " PhoenixBuild/debug" : " PhoenixBuild/release";
            settings.setUserAgentString(settings.getUserAgentString() + marker);
        }
    }
}
