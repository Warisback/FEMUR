import { cn } from "cn";
import type { Criterion, CriterionResult } from "@/lib/db/schema";

/** Verification checklist: task criteria against the model's results. */
export function CriteriaList({
  criteria,
  results,
}: {
  criteria: Criterion[];
  results?: CriterionResult[] | null;
}) {
  return (
    <ul className="space-y-1.5">
      {criteria.map((c) => {
        const result = results?.find((r) => r.id === c.id);
        const mark = result ? (result.met ? "✓" : "✕") : "–";
        const colour = result ? (result.met ? "text-paid" : "text-danger") : "text-ink-2";
        return (
          <li key={c.id} className="flex gap-2 text-sm">
            <span aria-hidden className={cn("w-4 shrink-0 text-center font-medium", colour)}>
              {mark}
            </span>
            <span className="min-w-0">
              {c.text}
              {!c.required && <span className="text-ink-2"> (optional)</span>}
              {result?.note && <span className="block text-xs text-ink-2">{result.note}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
