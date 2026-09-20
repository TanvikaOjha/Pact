import { createPublicClient, http, isAddress } from "viem";
import { sepolia } from "viem/chains";

import { log } from "../services/log.js";


/** Explicit view function returning the EscrowInfo struct (M2 funding fields included). */
const escrowInfoAbi = [
  {
    type: "function",
    name: "getEscrowInfo",
    stateMutability: "view",
    inputs: [{ name: "engagementId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "client", type: "address" },
          { name: "provider", type: "address" },
          { name: "totalAmount", type: "uint256" },
          { name: "milestoneCount", type: "uint8" },
          { name: "funded", type: "bool" },
          { name: "everDisputed", type: "bool" },
          { name: "completedEmitted", type: "bool" },
          { name: "fundedCount", type: "uint8" },
          { name: "fundedTotal", type: "uint256" },
          { name: "defaulted", type: "bool" },
        ],
      },
    ],
  },
] as const;
/** Auto-generated getter for `mapping(bytes32 => mapping(address => uint256)) public pendingShares`. */
const pendingSharesGetterAbi = [
  {
    type: "function",
    name: "pendingShares",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }, { name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** Auto-generated getter for `mapping(bytes32 => mapping(uint256 => Milestone))`. */
/* Appended M4 fields (evidenceHash, late) keep released/disputed positions. */
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
      { name: "evidenceHash", type: "bytes32" },
      { name: "late", type: "bool" },
    ],
  },
] as const;

const worldAttestedGetterAbi = [
  {
    type: "function",
    name: "worldAttested",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }, { name: "", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export interface FundingState {
  fundedCount: number;
  fundedTotal: number;
  defaulted: boolean;
}

export interface EscrowReader {
  isReleased(onChainId: string, index: number): Promise<boolean | null>;
  isDisputed(onChainId: string, index: number): Promise<boolean | null>;
  isWorldAttested(onChainId: string, index: number): Promise<boolean | null>;
  getPendingShare(onChainId: string, recipient: string): Promise<number | null>;
  /** M2: authoritative fundedCount/fundedTotal/defaulted, read from EscrowInfo. */
  getFundingState(onChainId: string): Promise<FundingState | null>;

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
  async function readMilestone(onChainId: string, index: number) {
    if (!BYTES32_PATTERN.test(onChainId)) return null;
    // SAFETY: regex enforces 0x + 64 hex chars, exactly the bytes32 address shape.
    const id = onChainId as `0x${string}`;
    return client.readContract({
      address: escrow,
      abi: milestonesGetterAbi,
      functionName: "milestones",
      args: [id, BigInt(index)],
    });
  }
  return {
        getFundingState: async (onChainId: string): Promise<FundingState | null> => {
      if (!BYTES32_PATTERN.test(onChainId)) return null;
      // SAFETY: regex enforces 0x + 64 hex chars, exactly the bytes32 shape.
      const id = onChainId as `0x${string}`;
      const info = await client.readContract({
        address: escrow,
        abi: escrowInfoAbi,
        functionName: "getEscrowInfo",
        args: [id],
      });
      return {
        fundedCount: Number(info.fundedCount),
        fundedTotal: Number(info.fundedTotal),
        defaulted: info.defaulted,
      };
    },
    getPendingShare: async (onChainId: string, recipient: string): Promise<number | null> => {
      if (!BYTES32_PATTERN.test(onChainId) || !isAddress(recipient)) return null;
      // SAFETY: regex enforces 0x + 64 hex chars, exactly the bytes32 shape.
      const id = onChainId as `0x${string}`;
      const amount = await client.readContract({
        address: escrow,
        abi: pendingSharesGetterAbi,
        functionName: "pendingShares",
        args: [id, recipient],
      });
      return Number(amount);
    },
    isReleased: async (onChainId: string, index: number): Promise<boolean | null> => {
      const milestone = await readMilestone(onChainId, index);
      if (milestone === null) return null;
      return milestone[4];
    },
    isDisputed: async (onChainId: string, index: number): Promise<boolean | null> => {
      const milestone = await readMilestone(onChainId, index);
      if (milestone === null) return null;
      return milestone[5];
    },
     isWorldAttested: async (onChainId: string, index: number): Promise<boolean | null> => {
      if (!BYTES32_PATTERN.test(onChainId)) return null;
      // SAFETY: regex enforces 0x + 64 hex chars, exactly the bytes32 address shape.
      const id = onChainId as `0x${string}`;
      return client.readContract({
        address: escrow,
        abi: worldAttestedGetterAbi,
        functionName: "worldAttested",
        args: [id, BigInt(index)],
      });
    },
  };
}
