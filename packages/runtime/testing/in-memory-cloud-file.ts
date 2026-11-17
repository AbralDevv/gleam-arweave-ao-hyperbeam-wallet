import type { CloudFilePort } from "@gleam/core";

type Bytes = Uint8Array<ArrayBuffer>;

/**
 * A cloud account in memory. Hand one account to two platforms to stand
 * for two devices signed in to it.
 */
export class InMemoryCloudAccount {
  file: { bytes: Bytes; updatedAt: number } | null = null;
  /** Whether a sign-in with no UI succeeds. */
  signedIn = true;
  /** Whether the person completes an interactive sign-in. */
  allowsSignIn = true;
  writes = 0;
  revoked = 0;
  /** Runs once at the start of the next read, for tests that interleave work with one. */
  beforeRead: (() => Promise<void>) | null = null;
  /** Runs once after the next write with the file it replaced, as another install writing just after. */
  afterWrite: ((replaced: { bytes: Bytes; updatedAt: number } | null) => void) | null = null;
}

export class InMemoryCloudFile implements CloudFilePort {
  readonly provider = "google";

  constructor(readonly account: InMemoryCloudAccount = new InMemoryCloudAccount()) {}

  async signIn(interactive: boolean): Promise<boolean> {
    if (!this.account.signedIn && interactive && this.account.allowsSignIn) this.account.signedIn = true;
    return this.account.signedIn;
  }

  async read(): Promise<{ bytes: Bytes; updatedAt: number } | null> {
    const hook = this.account.beforeRead;
    this.account.beforeRead = null;
    await hook?.();
    const { file } = this.account;
    return file ? { bytes: file.bytes.slice(), updatedAt: file.updatedAt } : null;
  }

  async write(bytes: Bytes): Promise<void> {
    const replaced = this.account.file;
    this.account.file = { bytes: bytes.slice(), updatedAt: Date.now() };
    this.account.writes += 1;
    const hook = this.account.afterWrite;
    this.account.afterWrite = null;
    hook?.(replaced);
  }

  async remove(): Promise<void> {
    this.account.file = null;
  }

  async revoke(): Promise<void> {
    this.account.signedIn = false;
    this.account.revoked += 1;
  }
}
