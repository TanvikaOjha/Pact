import 'dotenv/config'
import {
  createPublicClient,
  createWalletClient,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const rpcUrl = process.env.SEPOLIA_RPC_URL
const privateKey = process.env.PACT_ETH_OWNER_PRIVATE_KEY

if (!rpcUrl) {
  throw new Error('SEPOLIA_RPC_URL is missing')
}

if (!privateKey) {
  throw new Error('PACT_ETH_OWNER_PRIVATE_KEY is missing')
}

const account = privateKeyToAccount(
  privateKey as `0x${string}`,
)

export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(rpcUrl),
})

export const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http(rpcUrl),
})

export { account }