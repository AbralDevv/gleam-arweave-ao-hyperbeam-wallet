import { describe, expect, it } from "vitest";
import { collectibleKind, collectibleSendRefusal } from "./collectible";

describe("collectibleKind", () => {
  it("names the kind from the content type, ignoring case and parameters", () => {
    expect(collectibleKind("image/png")).toBe("image");
    expect(collectibleKind("Video/MP4")).toBe("video");
    expect(collectibleKind("audio/mpeg")).toBe("audio");
    expect(collectibleKind("text/html; charset=utf-8")).toBe("web");
    expect(collectibleKind("application/x.arweave-manifest+json")).toBe("web");
    expect(collectibleKind("text/plain")).toBe("document");
    expect(collectibleKind("application/pdf")).toBe("document");
    expect(collectibleKind("model/gltf-binary")).toBe("file");
    expect(collectibleKind(undefined)).toBe("file");
  });
});

const SENDER = "sEnDeR_AdDrEsS-0123456789abcdefghijklmnopqr";
const RECIPIENT = "rEcIpIeNt_AdDrEsS-0123456789abcdefghijklmno";
const ASSET = "aSsEt_PrOcEsS-0123456789abcdefghijklmnopqrs";

describe("collectibleSendRefusal", () => {
  it("allows a send to another wallet", () => {
    expect(collectibleSendRefusal({ sender: SENDER, recipient: RECIPIENT, assetId: ASSET })).toBeNull();
  });

  it("refuses the sender's own address", () => {
    expect(collectibleSendRefusal({ sender: SENDER, recipient: SENDER, assetId: ASSET })).toMatch(/this wallet's own address/);
  });

  it("refuses the collectible's own process id", () => {
    expect(collectibleSendRefusal({ sender: SENDER, recipient: ASSET, assetId: ASSET })).toBe(
      "That's the collectible's own address. Enter the recipient's wallet address.",
    );
  });

  it("refuses a malformed recipient or asset id", () => {
    expect(collectibleSendRefusal({ sender: SENDER, recipient: "short", assetId: ASSET })).toMatch(/full Arweave address/);
    expect(collectibleSendRefusal({ sender: SENDER, recipient: RECIPIENT, assetId: "bad id" })).toMatch(/valid Arweave id/);
  });
});
