export async function register() {
  if (process.env.NETWORK !== "testnet") {
    throw new Error(
      `Legwork runs on Stellar testnet only. Set NETWORK=testnet in the environment (got "${process.env.NETWORK ?? "unset"}").`,
    );
  }
}
