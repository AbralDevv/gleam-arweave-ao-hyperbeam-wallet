import type { StoragePort } from "@gleam/core";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { updateStored } from "../storage-update";

/**
 * Background-side implementation of the dApp browser's saved and recent
 * site lists. Both hold bare origins (`https://host`), so a saved site opens
 * the site, not the page the user was on.
 *
 * Storage schema this handler owns:
 * - `local:browserSavedSites` — `string[]`, most recently saved first.
 * - `local:browserRecentSites` — `string[]`, most recently opened first,
 *   at most `MAX_RECENT_SITES`.
 * - `local:browserSiteIcons` — `Record<origin, data URL>`, a saved site's
 *   icon as the page had it when saved, so the start screen draws it
 *   without asking the site. Not backed up: a restored site shows a letter.
 *
 * Browsing data: wiped with the vault (`wallet-lifecycle.ts`'s reset).
 */
export const BROWSER_SAVED_SITES_KEY = "local:browserSavedSites";
export const BROWSER_RECENT_SITES_KEY = "local:browserRecentSites";
export const BROWSER_SITE_ICONS_KEY = "local:browserSiteIcons";
export const MAX_RECENT_SITES = 10;
/** The longest icon data URL kept, about 64 KB of image. */
export const MAX_SITE_ICON_LENGTH = 90_000;

export interface BrowserSites {
  saved: string[];
  recent: string[];
  /** By origin; only saved sites have one. */
  icons: Record<string, string>;
}

/** Raster and SVG images only; an `<img>` never runs an SVG's script. */
const SITE_ICON = /^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isValidSiteIcon(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_SITE_ICON_LENGTH && SITE_ICON.test(value);
}

/** The origin of an http(s) URL, or throws. */
function webOrigin(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(userErrorMessage("enterWebAddress"));
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(userErrorMessage("enterWebAddress"));
  return parsed.origin;
}

function origins(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
}

function icons(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => isValidSiteIcon(entry[1])));
}

export class BrowserSitesHandler {
  constructor(private readonly storage: StoragePort) {}

  private async load(key: string): Promise<string[]> {
    return origins(await this.storage.get<unknown>(key));
  }

  async listBrowserSites(): Promise<BrowserSites> {
    const [saved, recent, storedIcons] = await Promise.all([
      this.load(BROWSER_SAVED_SITES_KEY),
      this.load(BROWSER_RECENT_SITES_KEY),
      this.storage.get<unknown>(BROWSER_SITE_ICONS_KEY),
    ]);
    // A site removed on another device and merged back out leaves its icon behind.
    const all = icons(storedIcons);
    return { saved, recent, icons: Object.fromEntries(saved.flatMap((origin) => (all[origin] ? [[origin, all[origin]]] : []))) };
  }

  /** An `icon` that isn't a small image data URL is dropped, and the site is saved without one. */
  async saveBrowserSite(req: { url: string; icon?: string }): Promise<void> {
    const origin = webOrigin(req.url);
    await updateStored(this.storage, BROWSER_SAVED_SITES_KEY, (raw) => [
      origin,
      ...origins(raw).filter((entry) => entry !== origin),
    ]);
    const icon = req.icon;
    if (isValidSiteIcon(icon)) {
      await updateStored(this.storage, BROWSER_SITE_ICONS_KEY, (raw) => ({ ...icons(raw), [origin]: icon }));
    }
  }

  async removeBrowserSite(req: { origin: string }): Promise<void> {
    await updateStored(this.storage, BROWSER_SAVED_SITES_KEY, (raw) => {
      const saved = origins(raw);
      const next = saved.filter((entry) => entry !== req.origin);
      return next.length !== saved.length ? next : undefined;
    });
    await updateStored(this.storage, BROWSER_SITE_ICONS_KEY, (raw) => {
      const all = icons(raw);
      if (!(req.origin in all)) return undefined;
      return Object.fromEntries(Object.entries(all).filter(([origin]) => origin !== req.origin));
    });
  }

  async recordRecentSite(req: { url: string }): Promise<void> {
    const origin = webOrigin(req.url);
    await updateStored(this.storage, BROWSER_RECENT_SITES_KEY, (raw) =>
      [origin, ...origins(raw).filter((entry) => entry !== origin)].slice(0, MAX_RECENT_SITES),
    );
  }

  async clearRecentSites(): Promise<void> {
    await this.storage.remove(BROWSER_RECENT_SITES_KEY);
  }
}
