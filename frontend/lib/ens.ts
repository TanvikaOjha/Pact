import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";

const rpcUrl =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ||
  "https://ethereum-sepolia-rpc.publicnode.com";

export const ensClient = createPublicClient({
  chain: sepolia,
  transport: http(rpcUrl),
});

export async function resolveEnsResolver(name: string): Promise<Address | null> {
  return ensClient.getEnsResolver({ name: normalize(name) });
}

export async function readEnsText(name: string, key: string): Promise<string | null> {
  return ensClient.getEnsText({
    name: normalize(name),
    key,
  });
}

export async function readEnsProfile(name: string, keys: readonly string[]) {
  const normalized = normalize(name);
  const resolver = await ensClient.getEnsResolver({ name: normalized });

  const entries = await Promise.all(
    keys.map(async (key) => [key, await ensClient.getEnsText({ name: normalized, key })] as const)
  );

  return {
    name: normalized,
    resolver,
    records: Object.fromEntries(entries) as Record<string, string | null>,
  };
}
