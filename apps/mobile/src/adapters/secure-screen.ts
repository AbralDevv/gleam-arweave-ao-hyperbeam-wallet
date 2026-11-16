import { registerPlugin } from "@capacitor/core";
import type { PrivacyScreenPlugin } from "@capacitor-community/privacy-screen";
import type { SecureScreenPort } from "@gleam/app/src/app-platform/types.ts";

/**
 * The privacy screen, on only while a screen that shows a secret holds it.
 * On Android that is `FLAG_SECURE`: no screenshots and a blank recents card.
 * On iOS it covers the app switcher; screenshots stay allowed, since
 * blocking them needs the window-layer hack `capacitor.config.ts` keeps off.
 *
 * Registered by name, as `store-review.ts` does, so the package's web
 * fallback stays out of the bundle; only its types are imported.
 */
export function createSecureScreen(plugin = registerPlugin<PrivacyScreenPlugin>("PrivacyScreen")): SecureScreenPort {
  let holders = 0;
  const report = (error: unknown) => console.error("Couldn't change the privacy screen.", error);
  return {
    protect() {
      holders += 1;
      if (holders === 1) plugin.enable().catch(report);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0) plugin.disable().catch(report);
      };
    },
  };
}
