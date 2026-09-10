import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  stringToHex,
} from 'viem'
import { namehash } from 'viem/ens'

import {
  publicClient,
  account,
} from '../config/viem'

import {
  ENSV2_SEPOLIA,
} from '../config/ensv2.js'

const PARENT_NAME = 'pact-hack.eth'

const factoryAbi = parseAbi([
  'event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)',
])

async function main() {
  const version = 0n

  const registrySalt = BigInt(
    keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'bytes32' },
          { type: 'uint256' },
        ],
        [
          keccak256(stringToHex('UserRegistry')),
          namehash(PARENT_NAME),
          version,
        ],
      ),
    ),
  )

  console.log('Account:', account.address)
  console.log('Parent:', PARENT_NAME)
  console.log('Expected registry salt:', registrySalt.toString())
  console.log(
    'Factory:',
    ENSV2_SEPOLIA.verifiableFactory,
  )
  console.log(
    'Expected implementation:',
    ENSV2_SEPOLIA.userRegistryImpl,
  )

  const latestBlock = await publicClient.getBlockNumber()

const logs = await publicClient.getLogs({
  address: ENSV2_SEPOLIA.verifiableFactory as `0x${string}`,
  event: factoryAbi[0],
  args: {
    sender: account.address,
  },
  fromBlock: 11667023n,
  toBlock: latestBlock,
})

  console.log(`\nFound ${logs.length} ProxyDeployed event(s).`)

  let matchFound = false

  for (const log of logs) {
    const args = log.args

    if (!args.salt) continue

    console.log('\nProxy:')
    console.log('  address:', args.proxyAddress)
    console.log('  salt:', args.salt.toString())
    console.log('  implementation:', args.implementation)
    console.log('  block:', log.blockNumber?.toString())

    if (args.salt === registrySalt) {
      matchFound = true

      console.log('\n✅ MATCH FOUND')
      console.log(
        'This is the deterministic UserRegistry proxy for pact-hack.eth.',
      )

      if (
        args.implementation?.toLowerCase() ===
        ENSV2_SEPOLIA.userRegistryImpl.toLowerCase()
      ) {
        console.log(
          '✅ Implementation also matches current ENSv2 UserRegistryImpl.',
        )
      } else {
        console.log(
          '⚠️ Implementation does NOT match the current configured UserRegistryImpl.',
        )
      }
    }
  }

  if (!matchFound) {
    console.log(
      '\n❌ No previous UserRegistry deployment with this salt was found.',
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})