import { cn } from "cn";

export type TaskState =
  | "open"
  | "claimed"
  | "submitted"
  | "verifying"
  | "needs_review"
  | "approved"
  | "paid"
  | "rejected"
  | "expired"
  | "refunded"
  | "failed"
  | "blocked";

const STATES: Record<TaskState, { label: string; className: string }> = {
  open: { label: "Open", className: "text-ink-2 border-line" },
  claimed: { label: "Locked", className: "text-locked border-locked" },
  submitted: { label: "Submitted", className: "text-locked border-locked" },
  verifying: { label: "Verifying", className: "text-verifying border-verifying" },
  needs_review: { label: "Needs review", className: "text-verifying border-verifying" },
  approved: { label: "Verified", className: "text-paid border-paid" },
  paid: { label: "Paid", className: "text-paid border-paid" },
  rejected: { label: "Rejected", className: "text-danger border-danger" },
  expired: { label: "Expired", className: "text-ink-2 border-line" },
  refunded: { label: "Refunded", className: "text-ink-2 border-line" },
  failed: { label: "Failed", className: "text-danger border-danger" },
  blocked: { label: "Blocked", className: "text-danger border-danger" },
};

export function StateChip({
  state,
  label,
  className,
}: {
  state: TaskState;
  label?: string;
  className?: string;
}) {
  const s = STATES[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border bg-paper px-2 py-0.5 text-xs font-medium transition-colors duration-150",
        s.className,
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label ?? s.label}
    </span>
  );
}
