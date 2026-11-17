import { describe, expect, it } from "vitest";
import { tierTags } from "./tag-tiers";

const WALLET = "ECvThiUQHWJj-8HsiyF6C8_mgFbr6seluRs2GKyXa7Y";
const PROCESS = "VvF0Z3xMswxr2CVdLFei2a1NwYffiQ8nIQiPJ1gxJKY";

const tag = (name: string, value: string) => ({ name, value });

describe("tierTags", () => {
  it("sorts a Credit-Notice into headline, addresses, app and protocol tags", () => {
    const tiers = tierTags([
      tag("SDK", "aoconnect"),
      tag("Data-Protocol", "ao"),
      tag("Action", "Credit-Notice"),
      tag("From-Process", PROCESS),
      tag("Quantity", "1"),
      tag("Recipient", WALLET),
      tag("App-Name", "PermaTell"),
      tag("Variant", "ao.TN.1"),
      tag("Type", "Message"),
    ]);
    expect(tiers.headline).toEqual({ tag: tag("Action", "Credit-Notice"), quantity: tag("Quantity", "1") });
    expect(tiers.addresses).toEqual([tag("From-Process", PROCESS), tag("Recipient", WALLET)]);
    expect(tiers.app).toEqual([tag("App-Name", "PermaTell")]);
    expect(tiers.protocol).toEqual([tag("SDK", "aoconnect"), tag("Data-Protocol", "ao"), tag("Variant", "ao.TN.1"), tag("Type", "Message")]);
  });

  it("heads a message with no Action by its Type, unless the Type is Message", () => {
    expect(tierTags([tag("Type", "Process"), tag("Name", "Cool")]).headline).toEqual({ tag: tag("Type", "Process"), quantity: null });
    expect(tierTags([tag("Type", "Message"), tag("Name", "Cool")]).headline).toBeNull();
  });

  it("leaves Quantity an app tag when the headline is a Type", () => {
    const tiers = tierTags([tag("Type", "Process"), tag("Quantity", "5")]);
    expect(tiers.app).toEqual([tag("Quantity", "5")]);
  });

  it("matches Action exactly and keeps a second Action as an app tag", () => {
    const tiers = tierTags([tag("action", "Transfer"), tag("Action", "Vote"), tag("Action", "Burn")]);
    expect(tiers.headline?.tag).toEqual(tag("Action", "Vote"));
    expect(tiers.app).toEqual([tag("action", "Transfer"), tag("Action", "Burn")]);
  });

  it("lifts a protocol tag with an unexpected value into app tags, marked", () => {
    const tiers = tierTags([tag("Action", "Vote"), tag("Variant", "ao.TN.2"), tag("Type", "Process"), tag("Reference", "7"), tag("Reference", "x")]);
    expect(tiers.protocol).toEqual([tag("Reference", "7")]);
    expect(tiers.app).toEqual([
      { ...tag("Variant", "ao.TN.2"), unusual: { expected: "ao.TN.1 / ao.N.1" } },
      { ...tag("Type", "Process"), unusual: { expected: "Message" } },
      { ...tag("Reference", "x"), unusual: { expected: null } },
    ]);
  });

  it("treats HyperBEAM's ao.N.1 variant as a protocol tag", () => {
    expect(tierTags([tag("Variant", "ao.N.1")]).protocol).toEqual([tag("Variant", "ao.N.1")]);
  });

  it("places every tag exactly once", () => {
    const tags = [tag("Action", "A"), tag("Quantity", "1"), tag("Target-Id", PROCESS), tag("SDK", "x"), tag("Note", "hi"), tag("Variant", "odd")];
    const tiers = tierTags(tags);
    const placed = [tiers.headline?.tag, tiers.headline?.quantity, ...tiers.addresses, ...tiers.app, ...tiers.protocol].filter(Boolean);
    expect(placed).toHaveLength(tags.length);
  });
});
