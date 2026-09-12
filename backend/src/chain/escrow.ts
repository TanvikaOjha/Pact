import { createPublicClient, http, isAddress } from "viem";
import { sepolia } from "viem/chains";

import { log } from "../services/log.js";

/** Auto-generated getter for `mapping(bytes32 => mapping(uint256 => Milestone))`. */
const milestonesGetterAbi = [
  {
    type: "function",
    name: "milestones",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }, { name: "", type: "uint256" }],
    outputs: [
      { name: "amount", type: "uint256" },
      { name: "submitted", type: "bool" },
      { name: "submittedAt", type: "uint256" },
      { name: "releaseAfter", type: "uint256" },
      { name: "released", type: "bool" },
      { name: "disputed", type: "bool" },
    ],
  },
] as const;

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export interface EscrowReader {
  /** Null when the engagement isn't on-chain-trackable; boolean from chain otherwise. */
  isReleased(onChainId: string, index: number): Promise<boolean | null>;
}

/** Null when chain config is absent; callers degrade explicitly. */
export function getEscrowReader(
  rpcUrl: string | undefined,
  address: string | undefined,
): EscrowReader | null {
  if (rpcUrl === undefined || rpcUrl === "" || address === undefined || address === "") {
    return null;
  }
  if (!isAddress(address)) {
    log.error("PACT_ESCROW_ADDRESS is not a valid address; escrow checks disabled");
    return null;
  }
  const escrow = address;
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  return {
    isReleased: async (onChainId: string, index: number): Promise<boolean | null> => {
      if (!BYTES32_PATTERN.test(onChainId)) return null;
      // SAFETY: regex enforces 0x + 64 hex chars, exactly the bytes32 address shape.
      const id = onChainId as `0x${string}`;
      const milestone = await client.readContract({
        address: escrow,
        abi: milestonesGetterAbi,
        functionName: "milestones",
        args: [id, BigInt(index)],
      });
      return milestone[4];
    },
  };
}
