import { NextResponse } from "next/server";
import { getStats } from "@/lib/tasks/metrics";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getStats());
}
