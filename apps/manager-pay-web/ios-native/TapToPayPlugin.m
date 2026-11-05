#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registers the Swift `TapToPayPlugin` with Capacitor under the JS name "TapToPay" (matches
// registerPlugin<TapToPayPlugin>('TapToPay') in src/native/tapToPay.ts), exposing the `capture` method.
CAP_PLUGIN(TapToPayPlugin, "TapToPay",
    CAP_PLUGIN_METHOD(capture, CAPPluginReturnPromise);
)
