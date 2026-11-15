import { describe, expect, it } from "vitest";
import type { StoragePort } from "@gleam/core";
import {
  BrowserSitesHandler,
  BROWSER_RECENT_SITES_KEY,
  BROWSER_SITE_ICONS_KEY,
  MAX_RECENT_SITES,
  MAX_SITE_ICON_LENGTH,
  isValidSiteIcon,
} from "./browser-sites";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const SVG = "data:image/svg+xml;base64,PHN2Zy8+";

function createFakeStorage(): StoragePort {
  const store = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      store.set(key, value);
    },
    async setMany(entries: Record<string, unknown>) {
      for (const [key, value] of Object.entries(entries)) store.set(key, value);
    },
    async remove(key: string) {
      store.delete(key);
    },
    watch() {
      return () => {};
    },
  };
}

describe("BrowserSitesHandler", () => {
  it("keeps both sites when two saves run at once", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    await Promise.all([
      handler.saveBrowserSite({ url: "https://a.example" }),
      handler.saveBrowserSite({ url: "https://b.example" }),
    ]);
    expect((await handler.listBrowserSites()).saved.sort()).toEqual(["https://a.example", "https://b.example"]);
  });

  it("starts empty", async () => {
    expect(await new BrowserSitesHandler(createFakeStorage()).listBrowserSites()).toEqual({ saved: [], recent: [], icons: {} });
  });

  it("saves the origin of a page, newest first, without duplicates", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    await handler.saveBrowserSite({ url: "https://a.example/path?q=1" });
    await handler.saveBrowserSite({ url: "https://b.example/" });
    await handler.saveBrowserSite({ url: "https://a.example/other" });
    expect((await handler.listBrowserSites()).saved).toEqual(["https://a.example", "https://b.example"]);
  });

  it("removes a saved site", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    await handler.saveBrowserSite({ url: "https://a.example/" });
    await handler.removeBrowserSite({ origin: "https://a.example" });
    expect((await handler.listBrowserSites()).saved).toEqual([]);
  });

  it("rejects anything that isn't an http(s) URL", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    await expect(handler.saveBrowserSite({ url: "javascript:alert(1)" })).rejects.toThrow();
    await expect(handler.recordRecentSite({ url: "not a url" })).rejects.toThrow();
    expect(await handler.listBrowserSites()).toEqual({ saved: [], recent: [], icons: {} });
  });

  it("keeps ten recent origins, most recent first, one per origin", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    for (let index = 0; index < MAX_RECENT_SITES + 2; index += 1) {
      await handler.recordRecentSite({ url: `https://site${index}.example/` });
    }
    await handler.recordRecentSite({ url: "https://site5.example/page" });
    const { recent } = await handler.listBrowserSites();
    expect(recent).toHaveLength(MAX_RECENT_SITES);
    expect(recent[0]).toBe("https://site5.example");
    expect(recent.filter((origin) => origin === "https://site5.example")).toHaveLength(1);
  });

  it("clears only the recent list", async () => {
    const storage = createFakeStorage();
    const handler = new BrowserSitesHandler(storage);
    await handler.saveBrowserSite({ url: "https://a.example/" });
    await handler.recordRecentSite({ url: "https://b.example/" });
    await handler.clearRecentSites();
    expect(await handler.listBrowserSites()).toEqual({ saved: ["https://a.example"], recent: [], icons: {} });
    expect(await storage.get(BROWSER_RECENT_SITES_KEY)).toBeNull();
  });

  it("keeps a saved site's icon by origin, and drops it with the site", async () => {
    const storage = createFakeStorage();
    const handler = new BrowserSitesHandler(storage);
    await handler.saveBrowserSite({ url: "https://a.example/page", icon: PNG });
    await handler.saveBrowserSite({ url: "https://b.example/", icon: SVG });
    expect((await handler.listBrowserSites()).icons).toEqual({ "https://a.example": PNG, "https://b.example": SVG });

    await handler.removeBrowserSite({ origin: "https://a.example" });
    expect((await handler.listBrowserSites()).icons).toEqual({ "https://b.example": SVG });
    expect(await storage.get(BROWSER_SITE_ICONS_KEY)).toEqual({ "https://b.example": SVG });
  });

  it("saves the site without an icon that isn't a small image data URL", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    for (const icon of ["https://a.example/favicon.ico", "data:text/html;base64,PGI+", `data:image/png;base64,${"A".repeat(MAX_SITE_ICON_LENGTH)}`]) {
      await handler.saveBrowserSite({ url: "https://a.example/", icon });
    }
    expect(await handler.listBrowserSites()).toEqual({ saved: ["https://a.example"], recent: [], icons: {} });
  });

  it("lists icons only for sites still saved, and skips stored values that fail the guard", async () => {
    const storage = createFakeStorage();
    await storage.set("local:browserSavedSites", ["https://a.example"]);
    await storage.set(BROWSER_SITE_ICONS_KEY, { "https://a.example": "javascript:1", "https://gone.example": PNG });
    expect((await new BrowserSitesHandler(storage).listBrowserSites()).icons).toEqual({});
  });
});

describe("isValidSiteIcon", () => {
  it("accepts base64 image data URLs only", () => {
    expect(isValidSiteIcon(PNG)).toBe(true);
    expect(isValidSiteIcon("data:image/png,raw")).toBe(false);
    expect(isValidSiteIcon("data:image/png;base64,abc\"><script>")).toBe(false);
    expect(isValidSiteIcon(42)).toBe(false);
  });
});
