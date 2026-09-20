import { createPublicClient, createWalletClient, http,isAddress, type Hex} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { log } from "../services/log.js";

const scoreAbi = [
  {
    type: "function",
    name: "attestScore",
    stateMutability: "nonpayable",
    inputs: [
      { name: "subname", type: "string" },
      { name: "score", type: "uint16" },
      { name: "version", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getTier",
    stateMutability: "view",
    inputs: [{ name: "subname", type: "string" }],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "getScore",
    stateMutability: "view",
    inputs: [{ name: "subname", type: "string" }],
    outputs: [
      { name: "score", type: "uint16" },
      { name: "version", type: "uint8" },
      { name: "attestedAt", type: "uint64" },
    ],
  },
] as const;

export interface OnChainScore {
  score: number;
  version: number;
  attestedAt: number;
  tier: number;
}

export interface ScoreReader {
  /** Null when the subname has never been attested, or on chain-read failure. */
  getOnChainScore(subname: string): Promise<OnChainScore | null>;
}

/** Null when chain config is absent; callers treat on-chain score display as unavailable. */
export function getScoreReader(
  rpcUrl: string | undefined,
  address: string | undefined,
): ScoreReader | null {
  if (rpcUrl === undefined || rpcUrl === "" || address === undefined || address === "") {
    return null;
  }
  if (!isAddress(address)) {
    log.error("PACT_SCORE_ADDRESS is not a valid address; score reads disabled");
    return null;
  }
  const scoreContract = address;
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  return {
    getOnChainScore: async (subname: string): Promise<OnChainScore | null> => {
      const [score, version, attestedAt] = await client.readContract({
        address: scoreContract,
        abi: scoreAbi,
        functionName: "getScore",
        args: [subname],
      });
      if (attestedAt === 0n) return null;
      const tier = await client.readContract({
        address: scoreContract,
        abi: scoreAbi,
        functionName: "getTier",
        args: [subname],
      });
      return { score, version, attestedAt: Number(attestedAt), tier };
    },
  };
}

export interface ScoreAttestor {
  /**
   * Submits PactScore.attestScore(subname, score, version) from the
   * attestor's own wallet. Returns the tx hash, or null when the attestor
   * is unconfigured (no key) — callers treat null as "skip, don't fail".
   */
  attestScore(subname: string, score: number, version: number): Promise<`0x${string}` | null>;
}

/**
 * Null when either the contract address or the attestor private key is
 * absent. The private key belongs to whatever address PactScore.attestor
 * points at (see PactScore.sol's setAttestor) — anyone else's attestScore
 * call reverts NotAttestor, so misconfiguration fails loudly on submission
 * rather than silently mirroring an unattested score.
 */
export function getScoreAttestor(
  rpcUrl: string | undefined,
  address: string | undefined,
  attestorPrivateKey: string | undefined,
): ScoreAttestor | null {
  if (rpcUrl === undefined || rpcUrl === "") return null;
  if (address === undefined || address === "" || !isAddress(address)) return null;
  if (attestorPrivateKey === undefined || attestorPrivateKey === "") return null;
  const scoreContract = address;
  let key = attestorPrivateKey.trim();
  if (!key.startsWith("0x")) key = `0x${key}`;
  const account = privateKeyToAccount(key as Hex);
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
  return {
    attestScore: async (
      subname: string,
      score: number,
      version: number,
    ): Promise<`0x${string}` | null> => {
      const clampedScore = Math.max(0, Math.min(65_535, Math.round(score)));
      const clampedVersion = Math.max(0, Math.min(255, Math.round(version)));
      try {
        return await walletClient.writeContract({
          address: scoreContract,
          abi: scoreAbi,
          functionName: "attestScore",
          args: [subname, clampedScore, clampedVersion],
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        log.error(`attestScore failed for ${subname}: ${detail.slice(0, 300)}`);
        return null;
      }
    },
  };
}