"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Receipt } from "@/components/receipt";
import { Button } from "@/components/ui/button";
import { PhotoInput } from "@/components/worker/photo-input";
import { ProgressSteps } from "@/components/worker/progress-steps";
import { TxLink } from "@/components/tx-link";
import type { Task, Verification } from "@/lib/db/schema";
import { formatUsdc } from "@/lib/format";
import { ensureWallet } from "@/lib/wallet/browser";

const TERMINAL = ["paid", "refunded", "expired"];
const PROGRESS_INDEX: Record<string, number> = {
  submitted: 0,
  verifying: 1,
  needs_review: 1,
  approved: 2,
  paid: 3,
};

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const [address, setAddress] = useState<string | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justPaid, setJustPaid] = useState(false);
  const prevStatus = useRef<string | null>(null);

  useEffect(() => setAddress(ensureWallet()), []);

  const applyTask = useCallback((t: Task, v?: Verification | null) => {
    if (prevStatus.current && prevStatus.current !== "paid" && t.status === "paid") {
      setJustPaid(true); // the one orchestrated moment: the receipt prints
    }
    prevStatus.current = t.status;
    setTask(t);
    if (v !== undefined) setVerification(v);
  }, []);

  // Initial load.
  useEffect(() => {
    fetch(`/api/tasks/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.task) applyTask(d.task, d.verification);
        else setError(d.error ?? "task not found");
      })
      .catch(() => setError("could not load the task"));
  }, [id, applyTask]);

  const mine = task?.worker_address === address;

  // Poll tick every 2 s while the task is ours and in flight — progress
  // continues even if this page is the only client alive.
  useEffect(() => {
    if (!task || !mine || TERMINAL.includes(task.status)) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks/${id}/tick`, { method: "POST" });
        const d = await res.json();
        if (d.task) applyTask(d.task, d.verification);
      } catch {
        // transient — next tick retries
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [id, task, mine, applyTask]);

  async function claim() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${id}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worker: address }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "could not start the task");
      applyTask(d.task);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not start the task");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!address || !photo) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("worker", address);
      form.set("photo", photo, "photo.jpg");
      const res = await fetch(`/api/tasks/${id}/submit`, { method: "POST", body: form });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "could not submit the photo");
      setPhoto(null);
      applyTask(d.task);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not submit the photo");
    } finally {
      setBusy(false);
    }
  }

  if (error && !task) {
    return (
      <Shell>
        <p className="text-sm text-danger">{error}</p>
        <BackHome />
      </Shell>
    );
  }
  if (!task) {
    return (
      <Shell>
        <p className="text-sm text-ink-2">Loading…</p>
      </Shell>
    );
  }

  const funded = task.escrow_status === "funded";
  const retrying = task.status === "claimed" && task.attempts > 0;

  return (
    <Shell>
      <header className="space-y-1 border-b border-line pb-3">
        <h1 className="text-lg leading-snug font-semibold tracking-tight">{task.title}</h1>
        <p className="font-mono text-sm text-ink-2 tabular-nums">
          {formatUsdc(task.reward_usdc)} USDC
        </p>
      </header>

      {task.status === "open" && (
        <>
          <p className="text-sm">{task.instructions}</p>
          <Criteria task={task} />
          <div className="mt-auto pt-4">
            <Button className="h-12 w-full" onClick={claim} disabled={busy || !address}>
              {busy ? "Starting…" : "Start task"}
            </Button>
            <p className="pt-2 text-center text-xs text-ink-2">
              {formatUsdc(task.reward_usdc)} USDC is locked for you the moment you start.
            </p>
          </div>
        </>
      )}

      {task.status === "claimed" && !mine && (
        <p className="text-sm text-ink-2">Someone&rsquo;s already on this task.</p>
      )}

      {task.status === "claimed" && mine && (
        <>
          {retrying && verification && (
            <p className="rounded-lg border border-danger p-3 text-sm text-danger">
              {verification.summary}
            </p>
          )}
          <p className="text-sm">{task.instructions}</p>
          <Criteria task={task} />
          <p className="text-sm">
            {funded ? (
              <span className="text-locked">
                {formatUsdc(task.reward_usdc)} USDC locked{" "}
                {task.fund_tx && <TxLink id={task.fund_tx} className="text-xs" />}
              </span>
            ) : (
              <span className="text-ink-2">
                Locking {formatUsdc(task.reward_usdc)} USDC for you…
              </span>
            )}
          </p>
          <PhotoInput onSelect={(blob) => setPhoto(blob)} disabled={busy} />
          <div className="mt-auto pt-4">
            <Button
              className="h-12 w-full"
              onClick={submit}
              disabled={!photo || !funded || busy}
            >
              {busy ? "Submitting…" : retrying ? "Try again" : "Submit photo"}
            </Button>
            {!funded && (
              <p className="pt-2 text-center text-xs text-ink-2">
                Submit unlocks when your reward is secured.
              </p>
            )}
          </div>
        </>
      )}

      {["submitted", "verifying", "approved", "needs_review"].includes(task.status) && (
        <>
          <ProgressSteps current={PROGRESS_INDEX[task.status]} />
          {task.status === "needs_review" ? (
            <p className="text-center text-sm text-verifying">
              Sent for a human check — keep this page open.
            </p>
          ) : (
            <p className="text-center text-sm text-ink-2">
              {task.status === "approved"
                ? "Verified. Releasing your USDC…"
                : "Checking your photo…"}
            </p>
          )}
        </>
      )}

      {task.status === "paid" && (
        <>
          <ProgressSteps current={3} />
          <Receipt
            taskTitle={task.title}
            amountUsdc={task.reward_usdc}
            durationMs={(task.paid_at ?? 0) - (task.submitted_at ?? 0)}
            txHash={task.release_tx ?? ""}
            paidAt={task.paid_at ? new Date(task.paid_at) : ""}
            feeXlm="0.00001 XLM"
            print={justPaid}
            className="mx-auto"
          />
          {task.release_tx && (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${task.release_tx}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-center text-sm underline decoration-line underline-offset-2"
            >
              See it on Stellar ↗
            </a>
          )}
          <BackHome label="Find another task" />
        </>
      )}

      {["expired", "refunded"].includes(task.status) && (
        <>
          <p className="text-sm text-ink-2">
            This task expired{mine ? " — the locked USDC went back to the agent." : "."}
          </p>
          <BackHome />
        </>
      )}

      {error && task && <p className="text-sm text-danger">{error}</p>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-6">
      <Link href="/work" className="text-xs text-ink-2">
        ← All tasks
      </Link>
      {children}
    </main>
  );
}

function BackHome({ label = "Back to tasks" }: { label?: string }) {
  return (
    <Link
      href="/work"
      className="mx-auto pt-2 text-sm underline decoration-line underline-offset-2"
    >
      {label}
    </Link>
  );
}

function Criteria({ task }: { task: Task }) {
  return (
    <ul className="space-y-1 text-sm text-ink-2">
      {task.criteria.map((c) => (
        <li key={c.id} className="flex gap-2">
          <span aria-hidden>–</span>
          {c.text}
        </li>
      ))}
    </ul>
  );
}
