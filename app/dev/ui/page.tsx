import { Receipt } from "@/components/receipt";
import { StateChip, type TaskState } from "@/components/state-chip";
import { TxLink } from "@/components/tx-link";

// Dev-only component harness — deleted in phase 7.

const ALL_STATES: TaskState[] = [
  "open",
  "claimed",
  "submitted",
  "verifying",
  "needs_review",
  "approved",
  "paid",
  "rejected",
  "expired",
  "refunded",
  "failed",
  "blocked",
];

const SAMPLE_TX =
  "9f3ab21c64de0a9b7f5c83d12e46fa07b9d05c31a8e2f74d60b19c85e372c21e";
const SAMPLE_ADDRESS =
  "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";
const SAMPLE_CONTRACT =
  "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="border-b border-line pb-1 text-sm font-medium text-ink-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DevUiPage() {
  return (
    <main className="mx-auto max-w-[390px] space-y-10 px-4 py-8">
      <h1 className="text-xl font-semibold tracking-tight">
        Component harness
      </h1>

      <Section title="State chips">
        <div className="flex flex-wrap gap-2">
          {ALL_STATES.map((state) => (
            <StateChip key={state} state={state} />
          ))}
        </div>
      </Section>

      <Section title="Tx links">
        <div className="flex flex-col items-start gap-2">
          <TxLink id={SAMPLE_TX} prefix="tx" />
          <TxLink id={SAMPLE_ADDRESS} kind="account" />
          <TxLink id={SAMPLE_CONTRACT} kind="contract" />
        </div>
      </Section>

      <Section title="Receipt">
        <Receipt
          taskTitle="Photograph the bar price list"
          amountUsdc={0.5}
          durationMs={16400}
          txHash={SAMPLE_TX}
          paidAt="14:02:26"
          feeXlm="0.00001 XLM"
        />
      </Section>

      <Section title="Receipt, printing">
        <Receipt
          taskTitle="Photograph the front door sign"
          amountUsdc={0.5}
          durationMs={5800}
          txHash={SAMPLE_TX}
          paidAt="14:07:03"
          feeXlm="0.00001 XLM"
          print
        />
      </Section>
    </main>
  );
}
