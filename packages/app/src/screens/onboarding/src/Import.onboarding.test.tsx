import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { fakeAppPlatform, renderWithPlatform } from "../../../app-platform/testing";
import { Import } from "./Import";

afterEach(cleanup);

describe("Import", () => {
  it("keeps the screen out of captures while it is open", () => {
    const release = vi.fn();
    const protect = vi.fn(() => release);
    const { unmount } = renderWithPlatform(<Import onBack={vi.fn()} onValidJWK={vi.fn()} />, fakeAppPlatform({ secureScreen: { protect } }));
    expect(protect).toHaveBeenCalledTimes(1);
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
