import { describe, expect, it } from "vitest";
import type { CallerContext } from "@gleam/messaging/src/caller.ts";
import { createRuntime } from "./create-runtime";
import { createInMemoryPlatform } from "../testing/index";

const EXTENSION: CallerContext = { tier: "extension" };

describe("an extension update", () => {
  it("keeps a vault on the default 1-hour auto-lock", async () => {
    const runtime = createRuntime(createInMemoryPlatform());
    await runtime.dispatch("createWallet", { name: "A", password: "correct horse" }, EXTENSION);

    runtime.onInstalled("update");
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(runtime.dispatch("getLockSettings", undefined, EXTENSION)).resolves.toEqual({ autoLockTimeout: "1hr" });
  });

  it("keeps a timeout the user chose", async () => {
    const runtime = createRuntime(createInMemoryPlatform());
    await runtime.dispatch("createWallet", { name: "A", password: "correct horse" }, EXTENSION);
    await runtime.dispatch("setLockSettings", { autoLockTimeout: "never" }, EXTENSION);

    runtime.onInstalled("update");
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(runtime.dispatch("getLockSettings", undefined, EXTENSION)).resolves.toEqual({ autoLockTimeout: "never" });
  });
});
