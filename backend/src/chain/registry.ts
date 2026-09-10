import { createPublicClient, http, isAddress } from "viem";
import { sepolia } from "viem/chains";

import { log } from "../services/log.js";

/** Minimal read ABI — backend never sends registry transactions. */
const registryReadAbi = [
  {
    type: "function",
    name: "isBusinessActive",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export interface RegistryReader {
  isActive(walletAddress: string): Promise<boolean>;
}

/**
 * Null when chain config is absent; callers treat chain checks as unavailable
 * (fail open with a log — the contract itself reverts duplicate registration).
 */
export function getRegistryReader(
  rpcUrl: string | undefined,
  address: string | undefined,
): RegistryReader | null {
  if (rpcUrl === undefined || rpcUrl === "" || address === undefined || address === "") {
    return null;
  }
  if (!isAddress(address)) {
    log.error("PACT_REGISTRY_ADDRESS is not a valid address; chain checks disabled");
    return null;
  }
  const registry = address;
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  return {
    isActive: async (walletAddress: string): Promise<boolean> => {
      if (!isAddress(walletAddress)) return false;
      return client.readContract({
        address: registry,
        abi: registryReadAbi,
        functionName: "isBusinessActive",
        args: [walletAddress],
      });
    },
  };
}
