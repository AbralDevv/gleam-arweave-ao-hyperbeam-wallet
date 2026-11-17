import type { Tag } from "../models/tag";
import { HARMLESS_TAGS, isHarmlessTag } from "./other-tags";

const ADDRESS_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INTEGER_PATTERN = /^\d+$/;

/**
 * A tag sorted under App tags. `unusual` marks a protocol tag name carrying
 * a value we don't expect, with the values we do: `expected` is `null` where
 * any whole number is expected.
 */
export type AppTag = Tag & { unusual?: { expected: string | null } };

/**
 * A signed item's tags sorted for reading. Every tag lands in exactly one
 * place, so nothing is dropped: the headline's tags, then addresses, app
 * tags and protocol tags, each in signing order.
 */
export interface TagTiers {
  /** `Action` (with `Quantity` beside it), or else a `Type` other than `Message`. */
  headline: { tag: Tag; quantity: Tag | null } | null;
  /** Tags whose value is an Arweave address or id. */
  addresses: Tag[];
  app: AppTag[];
  /** Protocol tags carrying the one value we expect. */
  protocol: Tag[];
}

function isProtocolTag(tag: Tag): boolean {
  if (tag.name.toLowerCase() === "reference") return INTEGER_PATTERN.test(tag.value);
  return isHarmlessTag(tag);
}

function isProtocolName(tag: Tag): boolean {
  const name = tag.name.toLowerCase();
  return name === "reference" || Object.hasOwn(HARMLESS_TAGS, name);
}

function expectedValue(tag: Tag): string | null {
  const name = tag.name.toLowerCase();
  return name === "reference" ? null : (HARMLESS_TAGS[name]?.join(" / ") ?? null);
}

/**
 * Sorts tags into the approval screen's tiers. `Action` is matched exactly,
 * as aos matches it; the first one heads the item and any other stays an
 * app tag. A protocol tag name with an unexpected value is never folded in
 * with the protocol tags: it is lifted into App tags and marked.
 */
export function tierTags(tags: readonly Tag[]): TagTiers {
  const action = tags.find((tag) => tag.name === "Action") ?? null;
  const type = action === null ? (tags.find((tag) => tag.name === "Type" && tag.value !== "Message") ?? null) : null;
  const quantity = action !== null ? (tags.find((tag) => tag.name === "Quantity") ?? null) : null;
  const headlineTag = action ?? type;

  const tiers: TagTiers = {
    headline: headlineTag === null ? null : { tag: headlineTag, quantity },
    addresses: [],
    app: [],
    protocol: [],
  };
  for (const tag of tags) {
    if (tag === headlineTag || tag === quantity) continue;
    if (isProtocolTag(tag)) tiers.protocol.push(tag);
    else if (isProtocolName(tag)) tiers.app.push({ ...tag, unusual: { expected: expectedValue(tag) } });
    else if (ADDRESS_PATTERN.test(tag.value)) tiers.addresses.push(tag);
    else tiers.app.push(tag);
  }
  return tiers;
}
