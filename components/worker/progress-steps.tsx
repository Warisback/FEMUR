import { cn } from "cn";

const STEPS = ["Submitted", "Verifying", "Verified", "Paid"] as const;
// Colour encodes escrow state: locked → verifying → paid.
const STEP_COLOURS = ["text-locked", "text-verifying", "text-paid", "text-paid"] as const;

export function ProgressSteps({ current }: { current: number }) {
  return (
    <ol className="flex items-center justify-between gap-2">
      {STEPS.map((label, i) => {
        const reached = i <= current;
        return (
          <li key={label} className="flex flex-1 flex-col items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "size-2.5 rounded-full border transition-colors duration-150",
                reached ? `border-current bg-current ${STEP_COLOURS[i]}` : "border-line",
              )}
            />
            <span
              className={cn(
                "text-xs transition-colors duration-150",
                reached ? `font-medium ${STEP_COLOURS[i]}` : "text-ink-2",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
