import aoIcon from "../icons/ao.svg?url";
import bazarIcon from "../icons/bazar.svg?url";
import permatellIcon from "../icons/permatell.svg?url";

/**
 * The built-in dApps' own icons, shipped with the app so the start screen
 * draws them without asking the sites. Keyed by the entry in `BUILT_IN_SITES`.
 */
export const BUILT_IN_ICONS: Readonly<Record<string, string>> = {
  "https://ao.arweave.net/": aoIcon,
  "https://bazar.arweave.net/": bazarIcon,
  "https://www.permatell.xyz/": permatellIcon,
};
