import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { workers } from "@/lib/db/schema";
import { loadAccount } from "@/lib/stellar/horizon";
import { buildOnboardingTx, submitOnboarding } from "@/lib/stellar/sponsor";

export const runtime = "nodejs";
export const maxDuration = 60;

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;

const bodySchema = z.object({
  address: z.string().regex(STELLAR_ADDRESS, "not a Stellar public key"),
  signedXdr: z.string().max(10_000).optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { address, signedXdr } = parsed.data;

  try {
    if (!signedXdr) {
      // Phase A: hand the phone a treasury-signed envelope to countersign.
      const exists = await loadAccount(address).then(
        () => true,
        () => false,
      );
      if (exists) {
        await ensureWorkerRow(address, null);
        return NextResponse.json({ alreadyOnboarded: true });
      }
      const { xdr } = await buildOnboardingTx(address);
      return NextResponse.json({ xdr });
    }

    // Phase B: verify the countersigned envelope is ours, then submit.
    const { hash } = await submitOnboarding(signedXdr, address);
    await ensureWorkerRow(address, hash);
    return NextResponse.json({ hash });
  } catch (err) {
    const message = err instanceof Error ? err.message : "onboarding failed";
    console.error(`onboard ${address.slice(0, 4)}…: ${message}`);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function ensureWorkerRow(address: string, sponsoredTx: string | null) {
  await db
    .insert(workers)
    .values({
      address,
      sponsored_tx: sponsoredTx,
      created_at: Date.now(),
    })
    .onConflictDoNothing();
}
