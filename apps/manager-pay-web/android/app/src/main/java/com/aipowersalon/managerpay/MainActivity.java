package com.aipowersalon.managerpay;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

// BUILD_PLAN Phase 13 D (Constitution 6 §130, §179): this app shows salon money (revenue, payouts, card payments). FLAG_SECURE
// keeps it out of screenshots, screen recordings and the recent-apps thumbnail (Android shows a blank card instead) —
// the platform-level half of the privacy screen; the web layer's AppLock cover handles iOS and the idle lock.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    }
}
