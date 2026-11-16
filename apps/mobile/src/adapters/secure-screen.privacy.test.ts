import { describe, expect, it, vi } from "vitest";
import type { PrivacyScreenPlugin } from "@capacitor-community/privacy-screen";
import { createSecureScreen } from "./secure-screen";

function fakePlugin() {
  return {
    enable: vi.fn(async () => {}),
    disable: vi.fn(async () => {}),
  } as unknown as PrivacyScreenPlugin & { enable: ReturnType<typeof vi.fn>; disable: ReturnType<typeof vi.fn> };
}

describe("createSecureScreen", () => {
  it("turns the privacy screen on for the first holder and off after the last release", () => {
    const plugin = fakePlugin();
    const screen = createSecureScreen(plugin);

    const first = screen.protect();
    const second = screen.protect();
    expect(plugin.enable).toHaveBeenCalledTimes(1);

    first();
    expect(plugin.disable).not.toHaveBeenCalled();
    second();
    expect(plugin.disable).toHaveBeenCalledTimes(1);
  });

  it("counts a repeated release once", () => {
    const plugin = fakePlugin();
    const screen = createSecureScreen(plugin);

    const first = screen.protect();
    const second = screen.protect();
    first();
    first();
    expect(plugin.disable).not.toHaveBeenCalled();
    second();
    expect(plugin.disable).toHaveBeenCalledTimes(1);
  });
});
