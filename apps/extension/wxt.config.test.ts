import { describe, expect, it, vi } from "vitest";

// build-plugins.ts resolves paths from import.meta.url, which vitest's
// vite-node transform does not serve as a file: URL. The config only
// uses its two exports as Vite plugins, never inside manifest(), so a
// stub is enough to load the config under test.
vi.mock("./build-plugins", () => ({
  isolateKeyring: () => ({}),
  recordBundleModules: () => ({}),
}));

import config from "./wxt.config";

// The keys review verified that no web page can open the passkey window
// (passkey.html) or any other extension page, because the manifest's
// web_accessible_resources allowlist contains only provider.js, served
// from a per-session URL. If a later change added an extension page to
// the allowlist, a page could open the passkey setup/unlock window out
// of context, so this test pins the allowlist exactly.
describe("wxt.config manifest", () => {
  it("exposes only provider.js as a web-accessible resource, from a per-session URL", async () => {
    const manifestFn = config.manifest;
    if (typeof manifestFn !== "function") throw new Error("manifest is not a function");
    const manifest = await manifestFn({ command: "build", mode: "production", browser: "chrome", manifestVersion: 3 });
    expect(manifest.web_accessible_resources).toEqual([
      {
        resources: ["provider.js"],
        matches: ["http://*/*", "https://*/*"],
        use_dynamic_url: true,
      },
    ]);
  });
});
