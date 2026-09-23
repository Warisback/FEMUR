import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-3 px-6">
      <h1 className="text-xl font-semibold tracking-tight">No such page</h1>
      <p className="text-sm text-ink-2">The link may be old, or the task was cleared.</p>
      <Link href="/work" className="text-sm underline decoration-line underline-offset-2">
        See open tasks
      </Link>
    </main>
  );
}
