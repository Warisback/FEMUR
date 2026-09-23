import type { Task } from "@/lib/db/schema";
import { formatDuration } from "@/lib/format";
import { TxLink } from "@/components/tx-link";

function time(ms: number | null): string {
  return ms ? new Date(ms).toLocaleTimeString(undefined, { hour12: false }) : "—";
}

/** Timestamps, deltas and tx links for the money's journey through a task. */
export function EscrowTrail({ task }: { task: Task }) {
  const rows: Array<{ label: string; at: number | null; delta?: string; tx?: string | null }> = [
    { label: "Locked", at: task.claimed_at, tx: task.fund_tx },
    {
      label: "Verified",
      at: task.verified_at,
      delta:
        task.verified_at && task.submitted_at
          ? formatDuration(task.verified_at - task.submitted_at)
          : undefined,
    },
    {
      label: "Released",
      at: task.paid_at,
      delta:
        task.paid_at && task.submitted_at
          ? formatDuration(task.paid_at - task.submitted_at)
          : undefined,
      tx: task.release_tx,
    },
  ];
  if (task.refund_tx) {
    rows.push({ label: "Refunded", at: null, tx: task.refund_tx });
  }

  return (
    <dl className="space-y-1 font-mono text-xs tabular-nums">
      {rows
        .filter((r) => r.at || r.tx)
        .map((r) => (
          <div key={r.label} className="flex items-baseline gap-2">
            <dt className="w-16 shrink-0 text-ink-2">{r.label}</dt>
            <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span>{time(r.at)}</span>
              {r.delta && <span className="text-ink-2">({r.delta})</span>}
              {r.tx && <TxLink id={r.tx} prefix="tx" className="text-xs" />}
            </dd>
          </div>
        ))}
    </dl>
  );
}
