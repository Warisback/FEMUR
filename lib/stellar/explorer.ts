const EXPLORER_BASE = "https://stellar.expert/explorer/testnet";

export type ExplorerKind = "tx" | "account" | "contract";

export function explorerUrl(kind: ExplorerKind, id: string): string {
  return `${EXPLORER_BASE}/${kind}/${id}`;
}
