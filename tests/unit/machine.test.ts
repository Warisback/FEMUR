import { describe, expect, it } from "vitest";
import {
  isTerminal,
  MAX_ATTEMPTS,
  transition,
  type TaskEvent,
} from "@/lib/tasks/machine";
import type { TaskStatus } from "@/lib/db/schema";

const STATUSES: TaskStatus[] = [
  "open",
  "claimed",
  "submitted",
  "verifying",
  "needs_review",
  "approved",
  "paid",
  "expired",
  "refunded",
];

const EVENTS: TaskEvent[] = [
  "claim",
  "submit",
  "verify_start",
  "approve",
  "review",
  "reject",
  "pay",
  "expire",
  "refund",
];

/** Every legal (status, event) → status pair; everything else must be null. */
const LEGAL: Array<[TaskStatus, TaskEvent, TaskStatus]> = [
  ["open", "claim", "claimed"],
  ["claimed", "submit", "submitted"],
  ["claimed", "expire", "expired"],
  ["submitted", "verify_start", "verifying"],
  ["verifying", "approve", "approved"],
  ["verifying", "review", "needs_review"],
  ["verifying", "reject", "claimed"],
  ["needs_review", "approve", "approved"],
  ["needs_review", "reject", "claimed"],
  ["approved", "pay", "paid"],
  ["expired", "refund", "refunded"],
];

describe("transition", () => {
  it("covers the exact legal set and nothing else", () => {
    for (const status of STATUSES) {
      for (const event of EVENTS) {
        const expected = LEGAL.find(([s, e]) => s === status && e === event);
        const result = transition(status, event, { attempts: 0 });
        if (expected) {
          expect(result?.status, `${status} --${event}-->`).toBe(expected[2]);
        } else {
          expect(result, `${status} --${event}--> must be illegal`).toBeNull();
        }
      }
    }
  });

  it("reject returns the task to the same worker with attempts + 1", () => {
    expect(transition("verifying", "reject", { attempts: 0 })).toEqual({
      status: "claimed",
      attempts: 1,
    });
  });

  it(`the ${MAX_ATTEMPTS}nd reject expires the task`, () => {
    expect(transition("verifying", "reject", { attempts: MAX_ATTEMPTS - 1 })).toEqual({
      status: "expired",
      attempts: MAX_ATTEMPTS,
    });
    expect(transition("needs_review", "reject", { attempts: MAX_ATTEMPTS - 1 })?.status).toBe(
      "expired",
    );
  });

  it("non-reject events carry attempts through unchanged", () => {
    expect(transition("verifying", "approve", { attempts: 1 })).toEqual({
      status: "approved",
      attempts: 1,
    });
  });

  it("terminal statuses accept no events", () => {
    for (const status of ["paid", "refunded"] as TaskStatus[]) {
      expect(isTerminal(status)).toBe(true);
      for (const event of EVENTS) {
        expect(transition(status, event)).toBeNull();
      }
    }
  });
});
