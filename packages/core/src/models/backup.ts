export type BackupProvider = "google" | "icloud";

/** What Settings shows about the vault backup. */
export interface BackupStatus {
  /** Where this device can keep a backup, or null when it can't. */
  provider: BackupProvider | null;
  enabled: boolean;
  /** When the backup was last written from this device. */
  lastBackupAt: number | null;
  /**
   * Why background writes have stopped: the account wants a sign-in, the
   * file was removed from the account's side, or another vault's backup,
   * made under a different password, took its place.
   */
  problem: "signIn" | "missing" | "otherPassword" | null;
}
