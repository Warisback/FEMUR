"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const ACTIONS: Array<{ key: string; action: string; label: string }> = [
  { key: "s", action: "seed", label: "Seed London mission" },
  { key: "g", action: "simulate_good", label: "Simulate: good" },
  { key: "b", action: "simulate_blurry", label: "Simulate: blurry" },
  { key: "w", action: "simulate_wrong_subject", label: "Simulate: wrong subject" },
  { key: "i", action: "simulate_injection", label: "Simulate: injection" },
  { key: "p", action: "overspend_policy", label: "Overspend: policy" },
  { key: "n", action: "overspend_network", label: "Overspend: network" },
  { key: "t", action: "insert_test_task", label: "Post test-card task" },
  { key: "r", action: "reset", label: "Reset" },
];

/** Hidden demo director (BUILD_PLAN §6). ⌘⇧D toggles; ?director=1 opens it. */
export function DirectorPanel() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("director") === "1") setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function run(action: string) {
    setBusy(action);
    setResult(null);
    try {
      const res = await fetch("/api/director", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await res.json();
      setResult(res.ok ? d.message : d.error);
    } catch {
      setResult("director call failed");
    } finally {
      setBusy(null);
    }
  }

  if (!open) return null;
  return (
    <aside className="fixed right-4 bottom-4 z-50 w-72 space-y-2 rounded-lg border border-line bg-paper p-4 shadow-none">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Director</h2>
        <button className="text-xs text-ink-2" onClick={() => setOpen(false)}>
          close (⌘⇧D)
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {ACTIONS.map((a) => (
          <Button
            key={a.action}
            variant="outline"
            size="sm"
            className="justify-between"
            disabled={busy !== null}
            onClick={() => run(a.action)}
          >
            <span>{busy === a.action ? "Running…" : a.label}</span>
            <kbd className="font-mono text-xs text-ink-2">{a.key}</kbd>
          </Button>
        ))}
      </div>
      {result && <p className="text-xs text-ink-2">{result}</p>}
    </aside>
  );
}
