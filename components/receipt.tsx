import { cn } from "cn";
import { formatDuration, formatUsdc, shortHash } from "@/lib/format";
import { explorerUrl } from "@/lib/stellar/explorer";

export interface ReceiptProps {
  taskTitle: string;
  amountUsdc: number | string;
  /** submitted → paid */
  durationMs: number;
  txHash: string;
  /** a Date is shown as local HH:MM:SS; a string is shown as given */
  paidAt: Date | string;
  feeXlm?: string;
  /** true plays the one print animation (top→bottom reveal, once, on paid) */
  print?: boolean;
  className?: string;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}

export function Receipt({
  taskTitle,
  amountUsdc,
  durationMs,
  txHash,
  paidAt,
  feeXlm,
  print = false,
  className,
}: ReceiptProps) {
  const paidAtLabel =
    typeof paidAt === "string"
      ? paidAt
      : paidAt.toLocaleTimeString(undefined, { hour12: false });

  return (
    <div
      className={cn(
        "w-full max-w-sm",
        print && "motion-safe:animate-receipt-print",
        className,
      )}
    >
      {/* perforated top edge */}
      <div
        aria-hidden
        className="h-2 w-full border-x border-line"
        style={{
          backgroundImage:
            "radial-gradient(circle at 6px 4px, var(--color-line) 2px, transparent 2.5px)",
          backgroundSize: "12px 8px",
          backgroundRepeat: "repeat-x",
        }}
      />
      <div className="border border-t-0 border-line bg-paper p-5 font-mono text-sm">
        <div className="flex items-baseline justify-between border-b border-line pb-3">
          <span className="font-sans font-medium">Legwork</span>
          <span className="text-xs text-ink-2">receipt</span>
        </div>

        <p className="pt-3 font-sans">{taskTitle}</p>

        <div className="flex items-center justify-between pt-2 pb-3">
          <span className="text-2xl font-medium tabular-nums">
            {formatUsdc(amountUsdc)}
            <span className="pl-1.5 text-sm font-normal">USDC</span>
          </span>
          <span className="-rotate-3 rounded-sm border-2 border-paid px-2 py-0.5 font-sans font-semibold text-paid">
            Paid
          </span>
        </div>

        <dl className="space-y-1.5 border-t border-line pt-3 text-xs">
          <Row label="Submit → paid">{formatDuration(durationMs)}</Row>
          <Row label="Network fee">{feeXlm ?? "—"}</Row>
          <Row label="Paid at">{paidAtLabel}</Row>
          <Row label="Transaction">
            <a
              href={explorerUrl("tx", txHash)}
              target="_blank"
              rel="noopener noreferrer"
              title={txHash}
              className="underline decoration-line underline-offset-2 hover:decoration-ink"
            >
              {shortHash(txHash)} ↗
            </a>
          </Row>
        </dl>
      </div>
    </div>
  );
}
