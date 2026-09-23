"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-3 px-6">
      <h1 className="text-xl font-semibold tracking-tight">That page hit a snag</h1>
      <p className="text-sm text-ink-2">
        Nothing was lost — any locked USDC stays locked until the task resolves.
      </p>
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
