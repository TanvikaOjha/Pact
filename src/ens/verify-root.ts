// src/ens/verify-root.ts
//
// READ-ONLY. Run this BEFORE mint-business-subname.ts.
//
// Why this exists: the official ENS deployments table
// (https://docs.ens.domains/learn/deployments#sepolia-ensv2-beta) lists
// different ETHRegistry / ETHRegistrar / MockUSDC / PublicResolverV2
// addresses than the ones recorded in the project brief and used by
// register-root.ts. ENSv2 on Sepolia is explicitly "not yet final," so a
// redeploy between the pact-hack.eth registration and now is plausible.
//
// This script checks BOTH address sets, plus does a normal ENS resolution
// of "pact-hack.eth" through the standard viem client (which always talks
// to whatever ETHRegistry the current Universal Resolver actually walks).
// Whichever registry reports pact-hack.eth as REGISTERED and owned by our
// account is the one every subsequent script must use.

import { keccak256, toHex } from 'viem'
import { normalize } from 'viem/ens'
import { publicClient, account } from '../config/viem'
import {
  ENSV2_SEPOLIA,
  ENSV2_SEPOLIA_PROJECT_DOC_ADDRESSES,
} from '../config/ensv2.js'

const permissionedRegistryAbi = [
  {
    name: 'getState',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'anyId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'status', type: 'uint8' },
          { name: 'expiry', type: 'uint64' },
          { name: 'latestOwner', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'resource', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getSubregistry',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

const STATUS = ['AVAILABLE', 'RESERVED', 'REGISTERED'] as const

const LABEL = 'pact-hack'

async function checkRegistry(name: string, ethRegistry: `0x${string}`) {
  console.log(`\n--- Checking ${name} (${ethRegistry}) ---`)

  const labelId = BigInt(keccak256(toHex(LABEL)))

  try {
    const state = await publicClient.readContract({
      address: ethRegistry,
      abi: permissionedRegistryAbi,
      functionName: 'getState',
      args: [labelId],
    })

    console.log('  status:', STATUS[state.status])
    console.log('  latestOwner:', state.latestOwner)
    console.log('  expiry:', new Date(Number(state.expiry) * 1000).toISOString())
    console.log('  tokenId:', state.tokenId.toString())

    const isOurs =
      state.status === 2 &&
      state.latestOwner.toLowerCase() === account.address.toLowerCase()

    if (isOurs) {
      console.log('  ✅ REGISTERED to our account on this registry')
    } else if (state.status === 2) {
      console.log('  ⚠️  REGISTERED, but to a different address than our account')
    } else {
      console.log('  ❌ Not registered on this registry')
    }

    // If registered, also check whether a subregistry is already set
    // (relevant so mint-business-subname.ts knows whether setup already ran).
    try {
      const subregistry = await publicClient.readContract({
        address: ethRegistry,
        abi: permissionedRegistryAbi,
        functionName: 'getSubregistry',
        args: [LABEL],
      })
      console.log(
        '  subregistry for "pact-hack":',
        subregistry === '0x0000000000000000000000000000000000000000'
          ? '(none set yet)'
          : subregistry,
      )
    } catch (e) {
      console.log('  (could not read subregistry -- name may be expired/unregistered)')
    }

    return isOurs
  } catch (error) {
    console.log('  ⚠️  Call reverted or failed:', (error as Error).message.split('\n')[0])
    return false
  }
}

async function main() {
  console.log('Account:', account.address)
  console.log('Checking label:', LABEL)

  const officialMatch = await checkRegistry('OFFICIAL ENS DOCS ETHRegistry', ENSV2_SEPOLIA.ethRegistry as `0x${string}`)
  const legacyMatch = await checkRegistry(
    'PROJECT-DOC ETHRegistry (from register-root.ts)',
    ENSV2_SEPOLIA_PROJECT_DOC_ADDRESSES.ethRegistry as `0x${string}`,
  )

  console.log('\n--- Standard ENS resolution (Universal Resolver) ---')
  try {
    const resolvedAddress = await publicClient.getEnsAddress({
      name: normalize('pact-hack.eth'),
    })
    console.log('  pact-hack.eth resolves to address:', resolvedAddress ?? '(null — no address record set, this can be normal)')
  } catch (error) {
    console.log('  ⚠️  Resolution failed:', (error as Error).message.split('\n')[0])
  }

  try {
    const resolver = await publicClient.getEnsResolver({
      name: normalize('pact-hack.eth'),
    })
    console.log('  pact-hack.eth resolver:', resolver ?? '(none)')
  } catch (error) {
    console.log('  ⚠️  getEnsResolver failed:', (error as Error).message.split('\n')[0])
  }

  console.log('\n=== VERDICT ===')
  if (officialMatch && !legacyMatch) {
    console.log('Use ENSV2_SEPOLIA (official docs addresses) everywhere. This is the default in src/config/ensv2.ts — no changes needed.')
  } else if (legacyMatch && !officialMatch) {
    console.log('⚠️  pact-hack.eth is registered on the PROJECT-DOC addresses, not the current official ones.')
    console.log('    This likely means the ENSv2 Sepolia beta was redeployed after your registration ran.')
    console.log('    Before minting subnames, you need to either:')
    console.log('      (a) re-register pact-hack.eth against the current official ETHRegistry, or')
    console.log('      (b) confirm with ENS (Discord/GitHub issues) whether the old deployment is still supported.')
    console.log('    Do NOT run mint-business-subname.ts against the official addresses until this is resolved.')
  } else if (officialMatch && legacyMatch) {
    console.log('Both registries report pact-hack.eth as registered to us — unexpected, investigate manually.')
  } else {
    console.log('❌ pact-hack.eth was not found as REGISTERED-to-us on either registry.')
    console.log('   Something is off: check the account being used, or whether the name has expired')
    console.log(`   (min duration was ~28 days per your registration log, so check the expiry timestamps above).`)
  }
}

main().catch((error) => {
  console.error('\nVerification failed:\n')
  console.error(error)
  process.exit(1)
})