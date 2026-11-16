import { createContext, useContext, useState } from "react";
import { ChevronIcon } from "@gleam/ui/src/primitives/chevron-icon.tsx";
import { useT } from "../i18n";
import { UntrustedText } from "./UntrustedText";

/**
 * Reads the whole text of data the preview shows only the start of;
 * `index` picks a data item, and no index the request's own payload.
 */
export type LoadSignedData = (index?: number) => Promise<string | null>;

const LoadSignedDataContext = createContext<LoadSignedData | null>(null);

export const LoadSignedDataProvider = LoadSignedDataContext.Provider;

interface SignedDataTextProps {
  /** The preview's text: the start of the data when `truncated`. */
  text: string;
  /** The signed data's length in bytes. */
  size?: number;
  truncated?: boolean;
  /** Which data item this is, when the request signs items. */
  index?: number;
  /** The box's own look; the height comes from the open state. */
  boxClassName: string;
  collapsedClassName: string;
}

/**
 * The text a request signs. When the preview holds only its start, the
 * size sits under it and "Show all" swaps in the whole text, so the user
 * can read what they approve and see how much of it there is.
 */
export function SignedDataText({ text, size, truncated, index, boxClassName, collapsedClassName }: SignedDataTextProps) {
  const t = useT();
  const load = useContext(LoadSignedDataContext);
  const [full, setFull] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (full === null && load) {
      setBusy(true);
      try {
        setFull(await load(index));
      } catch {
        // The preview text stays; the button is offered again.
        return;
      } finally {
        setBusy(false);
      }
    }
    setOpen(true);
  };

  const shown = open && full !== null ? full : text;
  return (
    <>
      <div className={`${boxClassName} ${open ? "max-h-64" : collapsedClassName}`}>
        <UntrustedText text={shown} />
      </div>
      {truncated && size !== undefined ? (
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-caption tabular-nums text-muted">{t("approval.bytes", { size: String(size) })}</span>
          {load ? (
            <button
              type="button"
              aria-expanded={open}
              disabled={busy}
              onClick={() => void toggle()}
              className="flex min-h-6 items-center gap-1.5 text-label font-medium text-foreground underline underline-offset-[3px] disabled:opacity-60 phone:hit-target"
            >
              {open ? t("approval.showLessData") : t("approval.showAllData")}
              <ChevronIcon open={open} />
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
