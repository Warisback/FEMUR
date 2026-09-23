import { nativeProvider } from "./native";
import type { EscrowProvider } from "./provider";
import { trustlessWorkProvider } from "./trustlesswork";

export type { EscrowChainStatus, EscrowProvider, EscrowTask } from "./provider";

export function getEscrowProvider(): EscrowProvider {
  const name = process.env.ESCROW_PROVIDER ?? "native";
  switch (name) {
    case "native":
      return nativeProvider;
    case "trustlesswork":
      return trustlessWorkProvider;
    default:
      throw new Error(`Unknown ESCROW_PROVIDER "${name}" — use trustlesswork or native`);
  }
}
