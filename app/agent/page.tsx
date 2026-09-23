"use client";

import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { CriteriaList } from "@/components/criteria-list";
import { DirectorPanel } from "@/components/director/panel";
import { EscrowTrail } from "@/components/escrow-trail";
import { StateChip } from "@/components/state-chip";
import { TxLink } from "@/components/tx-link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { LedgerEvent, Mission, Submission, Task, Verification } from "@/lib/db/schema";
import { formatDuration, formatUsdc, shortAddress } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ConsoleData {
  mission: Mission | null;
  locked: number;
  paid: number;
  provider: string;
  treasury: string;
  stats: { median_submit_to_paid_ms: number | null };
  events: LedgerEvent[];
}

interface Detail {
  task: Task;
  submission: Submission | null;
  verification: Verification | null;
}

export default function ConsolePage() {
  const { data: header, mutate: refreshHeader } = useSWR<ConsoleData>("/api/console", fetcher, {
    refreshInterval: 5000,
  });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  // The console drives progress for every task: tick-all every 2 s.
  useEffect(() => {
    let stop = false;
    async function cycle() {
      try {
        const res = await fetch("/api/tasks/tick-all", { method: "POST" });
        const d = await res.json();
        if (!stop && d.tasks) setTasks(d.tasks);
        if (!stop && selectedRef.current) {
          const dr = await fetch(`/api/tasks/${selectedRef.current}`);
          const dd = await dr.json();
          if (!stop && dd.task) setDetail(dd);
        }
      } catch {
        // transient — next cycle retries
      }
      if (!stop) timer = setTimeout(cycle, 2000);
    }
    let timer = setTimeout(cycle, 0);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    fetch(`/api/tasks/${id}`)
      .then((r) => r.json())
      .then((d) => d.task && setDetail(d));
  }, []);

  async function resolve(decision: "approve" | "reject") {
    if (!selectedId) return;
    await fetch(`/api/tasks/${selectedId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    select(selectedId);
  }

  async function runAgent() {
    if (!header?.mission) return;
    await fetch(`/api/missions/${header.mission.id}/run`, { method: "POST" });
    refreshHeader();
  }

  const mission = header?.mission ?? null;
  const remaining = mission ? mission.budget_usdc - (header?.locked ?? 0) - (header?.paid ?? 0) : 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-4 px-4 py-4 md:px-6">
      <header className="space-y-2 border-b border-line pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {mission ? mission.title : "Legwork console"}
          </h1>
          <div className="flex items-center gap-3">
            {mission && (
              <span className="font-mono text-sm tabular-nums">
                {formatUsdc(mission.budget_usdc)} USDC budget
              </span>
            )}
            <QrButton />
          </div>
        </div>
        {mission && header && (
          <>
            <BudgetBar
              budget={mission.budget_usdc}
              locked={header.locked}
              paid={header.paid}
            />
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
              <span>
                Escrow: {header.provider === "trustlesswork" ? "Soroban" : "account"}
              </span>
              <span>max {formatUsdc(mission.max_reward_usdc)}/task</span>
              <span>{formatUsdc(mission.daily_cap_usdc)}/day</span>
              <span>
                treasury <TxLink id={header.treasury} kind="account" className="text-xs" />
              </span>
              <span>
                median submit→paid{" "}
                {header.stats.median_submit_to_paid_ms
                  ? formatDuration(header.stats.median_submit_to_paid_ms)
                  : "—"}
              </span>
              <span className="font-mono tabular-nums">
                {formatUsdc(header.locked)} locked · {formatUsdc(header.paid)} paid ·{" "}
                {formatUsdc(remaining)} remaining
              </span>
            </p>
          </>
        )}
        {header && !mission && (
          <p className="text-sm text-ink-2">
            No mission yet. Create one and the agent will post its first tasks.
          </p>
        )}
        <div className="flex gap-2">
          <NewMissionDialog onPosted={refreshHeader} />
          {mission && (
            <Button variant="outline" size="sm" onClick={runAgent}>
              Run agent
            </Button>
          )}
        </div>
      </header>

      <div className="grid flex-1 gap-4 md:grid-cols-[38%_1fr]">
        <section className="space-y-1.5">
          <h2 className="text-sm font-medium text-ink-2">Dispatch ledger</h2>
          {tasks.map((t) => (
            <button
              key={t.id}
              onClick={() => select(t.id)}
              className={`flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left text-sm transition-colors duration-150 ${
                selectedId === t.id ? "border-ink" : "border-line"
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate">{t.title}</span>
                <span className="font-mono text-xs text-ink-2 tabular-nums">
                  {formatUsdc(t.reward_usdc)}
                  {t.worker_address ? ` · ${shortAddress(t.worker_address)}` : ""}
                </span>
              </span>
              <StateChip state={t.status} />
            </button>
          ))}
          {tasks.length === 0 && (
            <p className="text-sm text-ink-2">No tasks posted yet.</p>
          )}
        </section>

        <section className="min-w-0 space-y-4 border-line md:border-l md:pl-4">
          {detail ? (
            <DetailPane detail={detail} onResolve={resolve} />
          ) : (
            <p className="text-sm text-ink-2">Select a task to see its trail.</p>
          )}
        </section>
      </div>

      <footer className="border-t border-line pt-2">
        <h2 className="sr-only">Activity</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums">
          {(header?.events ?? []).map((e) => (
            <li key={e.id} className={eventColour(e.type)}>
              {new Date(e.created_at).toLocaleTimeString(undefined, { hour12: false })}{" "}
              {e.type} — {e.message}
              {e.tx_hash && (
                <>
                  {" "}
                  <TxLink id={e.tx_hash} className="text-xs" />
                </>
              )}
            </li>
          ))}
          {header && header.events.length === 0 && (
            <li className="text-ink-2">Nothing yet — activity lands here.</li>
          )}
        </ul>
        <p className="pt-1 text-[11px] text-ink-2">
          Budget policy runs in the app today; the roadmap swaps it for an OpenZeppelin
          smart-account spending limit on-chain.
        </p>
      </footer>
      <DirectorPanel />
    </main>
  );
}

function eventColour(type: LedgerEvent["type"]): string {
  switch (type) {
    case "escrow_funded":
      return "text-locked";
    case "escrow_released":
      return "text-paid";
    case "policy_blocked":
    case "network_rejected":
    case "verify_failed":
      return "text-danger";
    default:
      return "text-ink-2";
  }
}

function BudgetBar({ budget, locked, paid }: { budget: number; locked: number; paid: number }) {
  const pct = (n: number) => `${Math.min(100, (n / budget) * 100)}%`;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-sm border border-line">
      <div className="bg-paid" style={{ width: pct(paid) }} />
      <div className="bg-locked" style={{ width: pct(locked) }} />
    </div>
  );
}

function DetailPane({
  detail,
  onResolve,
}: {
  detail: Detail;
  onResolve: (d: "approve" | "reject") => void;
}) {
  const { task, submission, verification } = detail;
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{task.title}</h2>
          <p className="text-sm text-ink-2">{task.instructions}</p>
        </div>
        <StateChip state={task.status} />
      </div>

      {submission?.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={submission.image_url}
          alt={`Submission for ${task.title}`}
          className="max-h-72 rounded-lg border border-line"
        />
      )}

      <CriteriaList criteria={task.criteria} results={verification?.criteria} />

      {verification && Object.keys(verification.extracted).length > 0 && (
        <p className="font-mono text-xs text-ink-2">
          Extracted: {JSON.stringify(verification.extracted)}
        </p>
      )}
      {verification && (
        <p className="text-xs text-ink-2">
          Model said {verification.verdict} at {Math.round(verification.confidence * 100)}%
          confidence in {formatDuration(verification.latency_ms)} — &ldquo;{verification.summary}
          &rdquo;
        </p>
      )}

      <div>
        <h3 className="pb-1 text-sm font-medium text-ink-2">Escrow trail</h3>
        <EscrowTrail task={task} />
        {task.escrow_ref && (
          <p className="pt-1 font-mono text-xs">
            escrow <TxLink id={task.escrow_ref} kind="account" className="text-xs" />
          </p>
        )}
      </div>

      {task.status === "needs_review" && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onResolve("approve")}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => onResolve("reject")}>
            Reject
          </Button>
        </div>
      )}
    </>
  );
}

function QrButton() {
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(`${window.location.origin}/work`), []);
  if (!url) return null;
  return (
    <Dialog>
      <DialogTrigger
        aria-label="Show the worker QR code"
        className="rounded-md border border-line p-1"
      >
        <QRCodeSVG value={url} size={40} bgColor="#f6f5f0" fgColor="#1c1e24" />
      </DialogTrigger>
      <DialogContent className="flex flex-col items-center gap-4 p-8">
        <DialogHeader>
          <DialogTitle>Work a task</DialogTitle>
        </DialogHeader>
        <QRCodeSVG value={url} size={320} bgColor="#f6f5f0" fgColor="#1c1e24" />
        <p className="font-mono text-sm">{url}</p>
      </DialogContent>
    </Dialog>
  );
}

interface Draft {
  title: string;
  reward_usdc: number;
  tasks: Array<{ title: string; instructions: string }>;
}

function NewMissionDialog({ onPosted }: { onPosted: () => void }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [budget, setBudget] = useState("20");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief, budget: Number(budget), ...body }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "the agent could not draft this mission");
      return d;
    } catch (err) {
      setError(err instanceof Error ? err.message : "something failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setDraft(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm">New mission</Button>} />
      <DialogContent className="max-w-lg space-y-3 p-6">
        <DialogHeader>
          <DialogTitle>New mission</DialogTitle>
        </DialogHeader>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="What should the agent get verified on the ground?"
          rows={3}
          className="w-full rounded-md border border-line bg-paper p-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          Budget
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            inputMode="decimal"
            className="w-24 rounded-md border border-line bg-paper p-2 font-mono text-sm tabular-nums"
          />
          USDC
        </label>
        {draft && (
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-line p-3">
            <p className="text-sm font-medium">
              {draft.title} — {formatUsdc(draft.reward_usdc)} USDC per task
            </p>
            <ul className="space-y-1 text-sm text-ink-2">
              {draft.tasks.map((t, i) => (
                <li key={i}>– {t.title}</li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button
            variant={draft ? "outline" : "default"}
            size="sm"
            disabled={busy || brief.length < 10}
            onClick={async () => {
              const d = await call({ dryRun: true });
              if (d?.draft) setDraft(d.draft);
            }}
          >
            {busy ? "Drafting…" : draft ? "Redraft" : "Draft tasks"}
          </Button>
          {draft && (
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                const d = await call({ draft });
                if (d?.mission) {
                  setOpen(false);
                  setDraft(null);
                  onPosted();
                }
              }}
            >
              Post tasks
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
