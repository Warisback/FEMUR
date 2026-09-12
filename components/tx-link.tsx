import { cn } from "cn";
import { shortHash } from "@/lib/format";
import { explorerUrl, type ExplorerKind } from "@/lib/stellar/explorer";

export function TxLink({
  id,
  kind = "tx",
  prefix,
  className,
}: {
  id: string;
  kind?: ExplorerKind;
  /** e.g. "tx" — rendered before the short hash, as in "tx 9f3a…c21e ↗" */
  prefix?: string;
  className?: string;
}) {
  return (
    <a
      href={explorerUrl(kind, id)}
      target="_blank"
      rel="noopener noreferrer"
      title={id}
      className={cn(
        "font-mono text-sm text-ink tabular-nums underline decoration-line underline-offset-2 hover:decoration-ink",
        className,
      )}
    >
      {prefix ? `${prefix} ` : ""}
      {shortHash(id)} ↗
    </a>
  );
}
