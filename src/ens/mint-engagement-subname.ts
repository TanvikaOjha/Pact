// src/ens/mint-engagement-subname.ts
//
// Creates an engagement subname owned by Pact:
//
//   eng-<first-6-hex-of-engagementId>.pact-hack.eth
//
// Example:
//
//   npx tsx src/ens/mint-engagement-subname.ts \
//     0xa3f9c1234567890...
//
// Result:
//
//   eng-a3f9c1.pact-hack.eth
//
// Ownership model:
//   Business name:
//      studio.pact-hack.eth -> Business owner
//
//   Engagement name:
//      eng-a3f9c1.pact-hack.eth -> Pact account
//
// The Pact account can therefore maintain the engagement's resolver
// and update the engagement's ENS text records as the engagement moves
// through proposed -> active -> completed/disputed/cancelled.
//
// ENSv2:
//   pact-hack.eth
//        |
//        +--> UserRegistry
//                |
//                +--> studio.pact-hack.eth
//                |
//                +--> eng-a3f9c1.pact-hack.eth
//
// The UserRegistry already exists at:
//   0x49f0907840Cf172987dD32A77586420d470A1F77
//
// IMPORTANT:
//   pact-hack.eth and the UserRegistry setup have already been completed.
//   This script does NOT create another UserRegistry.

import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseEventLogs,
  stringToHex,
  zeroAddress,
} from 'viem'

import { normalize } from 'viem/ens'

import {
  publicClient,
  walletClient,
  account,
} from '../config/viem'

import {
  ENSV2_SEPOLIA,
  ALL_ROLES,
  BUSINESS_REGISTRATION_ROLE_BITMAP,
} from '../config/ensv2.js'

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const PARENT_LABEL = 'pact-hack'
const PARENT_NAME = 'pact-hack.eth'

const EXPECTED_USER_REGISTRY =
  '0x49f0907840Cf172987dD32A77586420d470A1F77' as `0x${string}`

// --------------------------------------------------------------------------
// Minimal ABIs
// --------------------------------------------------------------------------

const verifiableFactoryAbi = parseAbi([
  'function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)',
  'event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)',
])

const resolverInitAbi = parseAbi([
  'function initialize(address admin, uint256 roleBitmap, bytes[] setters)',
])

const permissionedRegistryAbi = [
  {
    name: 'getSubregistry',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      {
        name: 'label',
        type: 'string',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'address',
      },
    ],
  },

  {
    name: 'getState',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      {
        name: 'anyId',
        type: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          {
            name: 'status',
            type: 'uint8',
          },
          {
            name: 'expiry',
            type: 'uint64',
          },
          {
            name: 'latestOwner',
            type: 'address',
          },
          {
            name: 'tokenId',
            type: 'uint256',
          },
          {
            name: 'resource',
            type: 'uint256',
          },
        ],
      },
    ],
  },

  {
    name: 'getResolver',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      {
        name: 'label',
        type: 'string',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'address',
      },
    ],
  },

  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'label',
        type: 'string',
      },
      {
        name: 'owner',
        type: 'address',
      },
      {
        name: 'registry',
        type: 'address',
      },
      {
        name: 'resolver',
        type: 'address',
      },
      {
        name: 'roleBitmap',
        type: 'uint256',
      },
      {
        name: 'expiry',
        type: 'uint64',
      },
    ],
    outputs: [
      {
        name: 'tokenId',
        type: 'uint256',
      },
    ],
  },
] as const

const STATUS = [
  'AVAILABLE',
  'RESERVED',
  'REGISTERED',
] as const

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function labelId(label: string): bigint {
  return BigInt(keccak256(stringToHex(label)))
}

function makeEngagementLabel(
  engagementId: string,
  suffix?: number,
): string {
  const clean = engagementId
    .replace(/^0x/, '')
    .toLowerCase()

  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(
      'engagementId must be a 32-byte hex value (64 hex characters).',
    )
  }

  const base = `eng-${clean.slice(0, 6)}`
  return suffix && suffix > 1
    ? `${base}-${suffix}`
    : base
}

async function findAvailableEngagementLabel(
  userRegistry: `0x${string}`,
  engagementId: string,
): Promise<string> {
  // The primary name is intentionally short (6 hex chars), so collisions
  // are possible. Try deterministic suffixes until an AVAILABLE label is
  // found. The same resolver salt still uses the full engagementId, so only
  // the ENS label needs the suffix.
  const maxAttempts = 100

  for (let suffix = 1; suffix <= maxAttempts; suffix += 1) {
    const label = makeEngagementLabel(
      engagementId,
      suffix,
    )

    const state =
      await publicClient.readContract({
        address: userRegistry,
        abi: permissionedRegistryAbi,
        functionName: 'getState',
        args: [labelId(label)],
      })

    const status = STATUS[state.status]

    if (status === 'AVAILABLE') {
      if (suffix === 1) {
        console.log(
          `✅ Engagement label available: ${label}.pact-hack.eth`,
        )
      } else {
        console.warn(
          `⚠️ Base engagement label is occupied. Using fallback: ${label}.pact-hack.eth`,
        )
      }

      return label
    }
  }

  throw new Error(
    `Could not find an available engagement label after ${maxAttempts} attempts.`,
  )
}

// --------------------------------------------------------------------------
// Step 1:
// Confirm pact-hack.eth points to our existing UserRegistry.
// --------------------------------------------------------------------------

async function getBusinessUserRegistry(): Promise<`0x${string}`> {
  console.log('\n--- Checking Pact UserRegistry ---')

  const subregistry =
    await publicClient.readContract({
      address:
        ENSV2_SEPOLIA.ethRegistry as `0x${string}`,
      abi: permissionedRegistryAbi,
      functionName: 'getSubregistry',
      args: [PARENT_LABEL],
    })

  console.log(
    'pact-hack.eth subregistry:',
    subregistry,
  )

  if (
    subregistry ===
    zeroAddress
  ) {
    throw new Error(
      'pact-hack.eth has no subregistry. Business UserRegistry setup is incomplete.',
    )
  }

  if (
    subregistry.toLowerCase() !==
    EXPECTED_USER_REGISTRY.toLowerCase()
  ) {
    throw new Error(
      `Unexpected UserRegistry. Expected ${EXPECTED_USER_REGISTRY}, got ${subregistry}.`,
    )
  }

  console.log(
    '✅ Correct UserRegistry confirmed.',
  )

  return subregistry
}

// --------------------------------------------------------------------------
// Step 2:
// Deploy a Pact-controlled resolver for this engagement.
// --------------------------------------------------------------------------

async function deployEngagementResolver(
  engagementId: string,
): Promise<`0x${string}`> {
  console.log(
    '\n--- Deploying Pact-controlled engagement resolver ---',
  )

  // Include the engagement ID in the salt.
  //
  // This is important because Pact owns every engagement.
  // A salt based only on account.address would collide for
  // every future engagement.
  const resolverSalt = BigInt(
    keccak256(
      encodeAbiParameters(
        [
          {
            type: 'bytes32',
          },
          {
            type: 'address',
          },
        ],
        [
          keccak256(
            stringToHex(
              `PactEngagementResolver:${engagementId.toLowerCase()}`,
            ),
          ),
          account.address,
        ],
      ),
    ),
  )

  const resolverInitData =
    encodeFunctionData({
      abi: resolverInitAbi,
      functionName: 'initialize',
      args: [
        account.address,
        ALL_ROLES,
        [],
      ],
    })

  console.log(
    'Resolver admin:',
    account.address,
  )

  console.log(
    'Deploying resolver proxy...',
  )

  const deployTx =
    await walletClient.writeContract({
      address:
        ENSV2_SEPOLIA.verifiableFactory as `0x${string}`,
      abi: verifiableFactoryAbi,
      functionName: 'deployProxy',
      args: [
        ENSV2_SEPOLIA.permissionedResolverImpl as `0x${string}`,
        resolverSalt,
        resolverInitData,
      ],
    })

  console.log(
    'Resolver deploy tx:',
    deployTx,
  )

  const receipt =
    await publicClient.waitForTransactionReceipt({
      hash: deployTx,
    })

  const [log] =
    parseEventLogs({
      abi: verifiableFactoryAbi,
      eventName: 'ProxyDeployed',
      logs: receipt.logs,
    })

  const resolverAddress =
    log.args.proxyAddress

  console.log(
    '✅ Resolver deployed:',
    resolverAddress,
  )

  return resolverAddress
}

// --------------------------------------------------------------------------
// Step 3:
// Register engagement subname in UserRegistry.
// --------------------------------------------------------------------------

async function registerEngagement(
  userRegistry: `0x${string}`,
  label: string,
  resolver: `0x${string}`,
) {
  console.log(
    `\n--- Registering ${label}.pact-hack.eth ---`,
  )

  // Availability is checked before resolver deployment in main() so
  // a short-name collision can fall back to eng-<6hex>-2, -3, etc.
  // Five-year expiry.
  //
  // This is an absolute timestamp, as required by ENSv2.
  const expiry =
    BigInt(
      Math.floor(Date.now() / 1000) +
        5 * 365 * 24 * 60 * 60,
    )

  console.log(
    'Pact owner:',
    account.address,
  )

  console.log(
    'Resolver:',
    resolver,
  )

  console.log(
    'Expiry:',
    new Date(
      Number(expiry) * 1000,
    ).toISOString(),
  )

  // Direct UserRegistry registration.
  //
  // owner:
  //   Pact account
  //
  // registry:
  //   zeroAddress -> engagement has no child registry yet
  //
  // resolver:
  //   Pact-controlled PermissionedResolver
  //
  // roleBitmap:
  //   standard ENS registration roles
  const registerTx =
    await walletClient.writeContract({
      address: userRegistry,
      abi: permissionedRegistryAbi,
      functionName: 'register',
      args: [
        label,
        account.address,
        zeroAddress,
        resolver,
        BUSINESS_REGISTRATION_ROLE_BITMAP,
        expiry,
      ],
    })

  console.log(
    'Register tx:',
    registerTx,
  )

  const receipt =
    await publicClient.waitForTransactionReceipt({
      hash: registerTx,
    })

  console.log(
    '✅ Engagement registered.',
  )

  console.log(
    'Block:',
    receipt.blockNumber.toString(),
  )

  return {
    registerTx,
    expiry,
  }
}

// --------------------------------------------------------------------------
// Step 4:
// Verify directly against UserRegistry + Universal Resolver.
// --------------------------------------------------------------------------

async function verifyEngagement(
  userRegistry: `0x${string}`,
  fullName: string,
  label: string,
) {
  console.log(
    '\n--- Engagement Verification ---',
  )

  const state =
    await publicClient.readContract({
      address: userRegistry,
      abi: permissionedRegistryAbi,
      functionName: 'getState',
      args: [labelId(label)],
    })

  console.log(
    'Registry status:',
    STATUS[state.status],
  )

  console.log(
    'Registry owner:',
    state.latestOwner,
  )

  console.log(
    'Registry expiry:',
    new Date(
      Number(state.expiry) * 1000,
    ).toISOString(),
  )

  if (
    STATUS[state.status] !==
    'REGISTERED'
  ) {
    throw new Error(
      'Verification failed: engagement is not REGISTERED.',
    )
  }

  if (
    state.latestOwner.toLowerCase() !==
    account.address.toLowerCase()
  ) {
    throw new Error(
      'Verification failed: engagement owner is not the Pact account.',
    )
  }

  const registryResolver =
    await publicClient.readContract({
      address: userRegistry,
      abi: permissionedRegistryAbi,
      functionName: 'getResolver',
      args: [label],
    })

  console.log(
    'Registry resolver:',
    registryResolver,
  )

  // Ask Universal Resolver for the actual resolver.
  const universalResolver =
    await publicClient.getEnsResolver({
      name: normalize(fullName),
    })

  console.log(
    'Universal Resolver resolver:',
    universalResolver,
  )

  if (!universalResolver) {
    throw new Error(
      'Universal Resolver could not resolve the engagement resolver.',
    )
  }

  if (
    registryResolver.toLowerCase() !==
    universalResolver.toLowerCase()
  ) {
    throw new Error(
      'Registry resolver and Universal Resolver result do not match.',
    )
  }

  console.log(
    '\n✅ Engagement name is registered correctly.',
  )

  console.log(
    `✅ Owner: ${account.address}`,
  )

  console.log(
    `✅ Resolver: ${universalResolver}`,
  )

  console.log(
    `✅ ${fullName}`,
  )
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  const engagementId =
    process.argv[2]

  if (!engagementId) {
    console.error(
      'Usage:',
    )

    console.error(
      'npx tsx src/ens/mint-engagement-subname.ts <engagementId>',
    )

    console.error(
      '\nExample:',
    )

    console.error(
      'npx tsx src/ens/mint-engagement-subname.ts 0xa3f9c12345678901234567890123456789012345678901234567890123456789',
    )

    process.exit(1)
  }

  console.log(
    'Using Pact account:',
    account.address,
  )

  console.log(
    'Engagement ID:',
    engagementId,
  )

  // ------------------------------------------------------------------------
  // Derive engagement name.
  // ------------------------------------------------------------------------

  // ------------------------------------------------------------------------
  // Confirm parent hierarchy and choose an available deterministic label.
  // ------------------------------------------------------------------------

  const userRegistry =
    await getBusinessUserRegistry()

  const label =
    await findAvailableEngagementLabel(
      userRegistry,
      engagementId,
    )

  const fullName =
    normalize(
      `${label}.${PARENT_NAME}`,
    )

  console.log(
    'Engagement ENS name:',
    fullName,
  )

  // ------------------------------------------------------------------------
  // Create Pact-controlled resolver.
  // ------------------------------------------------------------------------

  const resolver =
    await deployEngagementResolver(
      engagementId,
    )

  // ------------------------------------------------------------------------
  // Register engagement.
  // ------------------------------------------------------------------------

  await registerEngagement(
    userRegistry,
    label,
    resolver,
  )

  // ------------------------------------------------------------------------
  // Verify.
  // ------------------------------------------------------------------------

  await verifyEngagement(
    userRegistry,
    fullName,
    label,
  )

  console.log(
    '\n🎉 Engagement subname setup complete.',
  )

  console.log(
    `ENS name: ${fullName}`,
  )

  console.log(
    `Owner: ${account.address}`,
  )

  console.log(
    `Resolver: ${resolver}`,
  )

  console.log(
    `UserRegistry: ${userRegistry}`,
  )
}

main().catch((error) => {
  console.error(
    '\nEngagement subname creation failed:\n',
  )

  console.error(error)

  process.exit(1)
})