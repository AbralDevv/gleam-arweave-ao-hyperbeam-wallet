import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalletSummary } from "@gleam/core";
import type { CallerContext } from "@gleam/messaging/src/caller.ts";
import { createRuntime } from "./create-runtime";
import { createInMemoryPlatform } from "../testing/index";

const ORIGIN = "https://dapp.example";
const EXTENSION: CallerContext = { tier: "extension" };
const CONTENT_SCRIPT: CallerContext = { tier: "contentScript", origin: ORIGIN, tabId: 7 };
const TRANSACTION = { target: "r".repeat(43), quantity: "123", reward: "1", last_tx: "b".repeat(64) };

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function setupPendingSign() {
  globalThis.fetch = vi.fn(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
  const platform = createInMemoryPlatform();
  const runtime = createRuntime(platform);
  const present = vi.spyOn(platform.approvalPresenter, "present");
  const dismiss = vi.spyOn(platform.approvalPresenter, "dismiss");
  const wallet = (await runtime.dispatch("createWallet", { name: "A", password: "correct horse" }, EXTENSION)) as WalletSummary;
  await platform.storage.set("local:grants", [
    {
      origin: ORIGIN,
      walletId: wallet.id,
      permissions: ["ACCESS_ADDRESS", "SIGN_TRANSACTION"],
      createdAt: Date.now(),
      expiresAt: null,
      budget: null,
    },
  ]);

  const pending = runtime.dispatch("providerCall", { method: "sign", params: { transaction: TRANSACTION } }, CONTENT_SCRIPT) as Promise<unknown>;
  void pending.catch(() => {});
  await vi.waitFor(() => expect(present).toHaveBeenCalledTimes(1));
  const requestId = present.mock.calls[0]![0];
  return { runtime, dismiss, pending, requestId };
}

describe("ending a site's access with a signing request pending", () => {
  const paths: [string, (runtime: ReturnType<typeof createRuntime>) => unknown][] = [
    ["the site's own disconnect()", (runtime) => runtime.dispatch("providerCall", { method: "disconnect", params: {} }, CONTENT_SCRIPT)],
    ["Connected Apps' revoke", (runtime) => runtime.dispatch("revokeGrant", { origin: ORIGIN }, EXTENSION)],
    ["stopping Gleam on the site", (runtime) => runtime.dispatch("stopGleamOnSite", { origin: ORIGIN }, EXTENSION)],
  ];

  for (const [name, end] of paths) {
    it(`rejects the request and closes its window: ${name}`, async () => {
      const { runtime, dismiss, pending, requestId } = await setupPendingSign();

      await end(runtime);

      await expect(pending).rejects.toThrow("The site was disconnected.");
      expect(dismiss).toHaveBeenCalledWith(requestId);
      await expect(runtime.dispatch("resolveApproval", { requestId, approved: true }, EXTENSION)).rejects.toThrow(
        /No pending approval/,
      );
    });
  }
});

describe("ending a site's access with a read in flight", () => {
  async function setupRead() {
    const platform = createInMemoryPlatform();
    const runtime = createRuntime(platform);
    const wallet = (await runtime.dispatch("createWallet", { name: "A", password: "correct horse" }, EXTENSION)) as WalletSummary;
    await platform.storage.set("local:grants", [
      {
        origin: ORIGIN,
        walletId: wallet.id,
        permissions: ["ACCESS_ADDRESS", "ACCESS_TOKENS"],
        createdAt: Date.now(),
        expiresAt: null,
        budget: null,
      },
    ]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchStub = vi.fn(async () => {
      await gate;
      return new Response("4242", { status: 200 });
    });
    globalThis.fetch = fetchStub as unknown as typeof fetch;
    const read = runtime.dispatch("providerCall", { method: "getBalances", params: {} }, CONTENT_SCRIPT) as Promise<unknown>;
    void read.catch(() => {});
    await vi.waitFor(() => expect(fetchStub).toHaveBeenCalled());
    return { runtime, wallet, read, release };
  }

  it("withholds the result after a revoke", async () => {
    const { runtime, read, release } = await setupRead();
    await runtime.dispatch("revokeGrant", { origin: ORIGIN }, EXTENSION);
    release();
    await expect(read).rejects.toThrow("is not connected");
  });

  it("withholds the result after the wallet is deleted", async () => {
    const { runtime, wallet, read, release } = await setupRead();
    await runtime.dispatch("deleteWallet", { walletId: wallet.id }, EXTENSION);
    release();
    await expect(read).rejects.toThrow("is not connected");
  });

  it("still answers a site that stays connected", async () => {
    const { read, release } = await setupRead();
    release();
    await expect(read).resolves.toEqual({ ar: "4242" });
  });
});
