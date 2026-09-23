"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { StateChip } from "@/components/state-chip";
import { TxLink } from "@/components/tx-link";
import type { Task } from "@/lib/db/schema";
import { formatUsdc, shortAddress } from "@/lib/format";
import { ensureWallet, signXdr } from "@/lib/wallet/browser";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type OnboardState = "starting" | "created" | "returning" | "error";

export default function WorkerHome() {
  const [address, setAddress] = useState<string | null>(null);
  const [onboard, setOnboard] = useState<OnboardState>("starting");
  const [onboardError, setOnboardError] = useState<string | null>(null);

  useEffect(() => {
    const addr = ensureWallet();
    setAddress(addr);
    (async () => {
      try {
        const res = await fetch("/api/worker/onboard", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: addr }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "onboarding failed");
        if (body.alreadyOnboarded) {
          setOnboard("returning");
          return;
        }
        const signed = signXdr(body.xdr);
        const submit = await fetch("/api/worker/onboard", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: addr, signedXdr: signed }),
        });
        const submitBody = await submit.json();
        if (!submit.ok) throw new Error(submitBody.error ?? "onboarding failed");
        setOnboard("created");
      } catch (err) {
        setOnboard("error");
        setOnboardError(err instanceof Error ? err.message : "onboarding failed");
      }
    })();
  }, []);

  const { data: openData } = useSWR<{ tasks: Task[] }>("/api/tasks?status=open", fetcher, {
    refreshInterval: 5000,
  });
  const { data: mineData } = useSWR<{ tasks: Task[] }>(
    address ? `/api/tasks?worker=${address}` : null,
    fetcher,
    { refreshInterval: 5000 },
  );

  const mine = mineData?.tasks ?? [];
  const active = mine.filter((t) => !["paid", "refunded", "expired"].includes(t.status));
  const paid = mine.filter((t) => t.status === "paid");
  const earned = paid.reduce((s, t) => s + t.reward_usdc, 0);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-6">
      <header className="flex items-baseline justify-between border-b border-line pb-3">
        <h1 className="text-xl font-semibold tracking-tight">Legwork</h1>
        {address && (
          <span className="font-mono text-xs text-ink-2">
            <TxLink id={address} kind="account" className="text-xs" />
          </span>
        )}
      </header>

      {onboard === "starting" && (
        <p className="text-sm text-ink-2">Setting up your wallet…</p>
      )}
      {onboard === "created" && (
        <p className="rounded-lg border border-line bg-paper p-3 text-sm">
          Your wallet is ready. Legwork paid the setup, you&rsquo;ll never need to.
        </p>
      )}
      {onboard === "error" && (
        <p className="rounded-lg border border-danger p-3 text-sm text-danger">
          Wallet setup did not finish: {onboardError}. Reload to try again.
        </p>
      )}

      {paid.length > 0 && (
        <section className="flex items-baseline justify-between rounded-lg border border-line p-3">
          <span className="text-sm text-ink-2">
            {paid.length} task{paid.length === 1 ? "" : "s"} completed
          </span>
          <span className="font-mono text-lg font-medium tabular-nums">
            {formatUsdc(earned)} <span className="text-sm font-normal">USDC</span>
          </span>
        </section>
      )}

      {active.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-ink-2">Your tasks</h2>
          {active.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-ink-2">Available tasks</h2>
        {(openData?.tasks ?? []).map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
        {openData && openData.tasks.length === 0 && (
          <p className="text-sm text-ink-2">
            Nothing open right now. New tasks appear here when the agent posts them.
          </p>
        )}
      </section>

      <p className="mt-auto pt-4 text-xs text-ink-2">
        You are {address ? shortAddress(address) : "…"} on Stellar testnet. Your key never
        leaves this phone.
      </p>
    </main>
  );
}

function TaskRow({ task }: { task: Task }) {
  return (
    <Link
      href={`/work/tasks/${task.id}`}
      className="flex items-center justify-between gap-3 rounded-lg border border-line p-3"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{task.title}</p>
        <p className="font-mono text-xs text-ink-2 tabular-nums">
          {formatUsdc(task.reward_usdc)} USDC
        </p>
      </div>
      <StateChip state={task.status} />
    </Link>
  );
}
