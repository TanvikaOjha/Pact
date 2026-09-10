// ENSv2 Sepolia ("beta") contract addresses.
//
// Source of truth: https://docs.ens.domains/learn/deployments#sepolia-ensv2-beta
// Verified against that page on 2026-09-10.
//
// IMPORTANT: ENS's own docs mark these contracts "not yet final" pre-mainnet.
// That means addresses can change if ENS Labs redeploys the beta. Don't trust
// this file blindly forever -- re-check the deployments page if anything
// here starts reverting unexpectedly.
export const ENSV2_SEPOLIA = {
  ethRegistrar: '0xa88553f454b77203b0d036a05c894d555eaaa2cc',
  ethRegistry: '0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2',
  mockUsdc: '0x768f42455a2d082e23ceef7d51e5787c82d67a39',
  publicResolverV2: '0xe7b9a25607e02da8145e4eb1836ca539e53f11f7',
  permissionedResolverImpl: '0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e',
  userRegistryImpl: '0x624a25d67b59d587752ebec8dded8827dae52050',
  verifiableFactory: '0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef',
  universalResolverV2: '0x4a1817d13e9cf196f471725176355c1234b63c70',
} as const

// The addresses previously recorded in the project brief / register-root.ts.
// As of writing, these DO NOT match the official deployments table above.
// They are kept here only so verify-root.ts can check both sets and tell us
// which one actually holds the pact-hack.eth registration. Do not build new
// transactions against this object -- it exists purely for diagnosis.
export const ENSV2_SEPOLIA_PROJECT_DOC_ADDRESSES = {
  ethRegistrar: '0xa4449a0dd2b83007553d9b1d28b583a46a805a30',
  ethRegistry: '0x67b728a792e789a8978b30cf1b3b641f19354b43',
  mockUsdc: '0xd3322b29a7bdee707d1684676f149bf41aa3422f',
  publicResolverV2: '0xd25f66dd4ff61486c2c5c1e6201a23576698d3df',
} as const

// --- Enhanced Access Control (EAC) role bitmap constants ---
// https://docs.ens.domains/ensv2/enhanced-access-control
// https://docs.ens.domains/ensv2/permissioned-registry#eac-integration
export const ROOT_RESOURCE = 0n

export const ROLE_REGISTRAR = 1n << 0n
export const ROLE_REGISTER_RESERVED = 1n << 4n
export const ROLE_SET_PARENT = 1n << 8n
export const ROLE_UNREGISTER = 1n << 12n
export const ROLE_RENEW = 1n << 16n
export const ROLE_SET_SUBREGISTRY = 1n << 20n
export const ROLE_SET_RESOLVER = 1n << 24n
export const ROLE_SET_URI = 1n << 36n
export const ROLE_UPGRADE = 1n << 124n
// ROLE_CAN_TRANSFER_ADMIN has no non-admin counterpart.
export const ROLE_CAN_TRANSFER_ADMIN = (1n << 28n) << 128n

const ADMIN_SHIFT = 128n
export const ROLE_REGISTRAR_ADMIN = ROLE_REGISTRAR << ADMIN_SHIFT
export const ROLE_REGISTER_RESERVED_ADMIN = ROLE_REGISTER_RESERVED << ADMIN_SHIFT
export const ROLE_SET_PARENT_ADMIN = ROLE_SET_PARENT << ADMIN_SHIFT
export const ROLE_UNREGISTER_ADMIN = ROLE_UNREGISTER << ADMIN_SHIFT
export const ROLE_RENEW_ADMIN = ROLE_RENEW << ADMIN_SHIFT
export const ROLE_SET_SUBREGISTRY_ADMIN = ROLE_SET_SUBREGISTRY << ADMIN_SHIFT
export const ROLE_SET_RESOLVER_ADMIN = ROLE_SET_RESOLVER << ADMIN_SHIFT
export const ROLE_SET_URI_ADMIN = ROLE_SET_URI << ADMIN_SHIFT
export const ROLE_UPGRADE_ADMIN = ROLE_UPGRADE << ADMIN_SHIFT

// "Everything" bitmap used only for the deployer's own bootstrap step
// (initialize()), so it can configure and then lock down the registry.
// From the ENS docs' Verifiable Factory examples.
export const ALL_ROLES =
  0x1111111111111111111111111111111111111111111111111111111111111111n

// Roles a business owner receives on THEIR OWN subname at registration.
// Matches ETH Registrar's REGISTRATION_ROLE_BITMAP:
// https://docs.ens.domains/ensv2/tutorial-contract-developers#imports-and-role-bitmap
// Lets the owner: point their name at a resolver they control, create their
// own child registry for sub-subnames later, and transfer the name.
export const BUSINESS_REGISTRATION_ROLE_BITMAP =
  ROLE_SET_SUBREGISTRY |
  ROLE_SET_SUBREGISTRY_ADMIN |
  ROLE_SET_RESOLVER |
  ROLE_SET_RESOLVER_ADMIN |
  ROLE_CAN_TRANSFER_ADMIN

// Roles Pact keeps on the business-subname UserRegistry's ROOT_RESOURCE
// after setup. Only ROLE_REGISTRAR/RENEW (+ their admins) remain, which the
// ENS docs classify as "non-dangerous": they can only register names that
// are still AVAILABLE, or extend an expiry, never touch an existing owner's
// resolver/subregistry or delete their name. Everything "dangerous" --
// ROLE_SET_RESOLVER, ROLE_SET_SUBREGISTRY, ROLE_UNREGISTER, ROLE_CAN_TRANSFER_ADMIN,
// ROLE_UPGRADE, ROLE_SET_PARENT (+ admin variants) -- gets revoked from Pact's
// own account on ROOT_RESOURCE, which is what "emancipates" the registry per
// https://docs.ens.domains/ensv2/permissioned-registry#emancipation
export const DANGEROUS_ROOT_ROLES_TO_REVOKE =
  ROLE_SET_RESOLVER |
  ROLE_SET_RESOLVER_ADMIN |
  ROLE_SET_SUBREGISTRY |
  ROLE_SET_SUBREGISTRY_ADMIN |
  ROLE_UNREGISTER |
  ROLE_UNREGISTER_ADMIN |
  ROLE_CAN_TRANSFER_ADMIN |
  ROLE_UPGRADE |
  ROLE_UPGRADE_ADMIN |
  ROLE_SET_PARENT |
  ROLE_SET_PARENT_ADMIN

// Roles Pact retains at ROOT_RESOURCE so it can still mint/renew future
// business subnames after emancipation.
export const RETAINED_ROOT_ROLES =
  ROLE_REGISTRAR | ROLE_REGISTRAR_ADMIN | ROLE_RENEW | ROLE_RENEW_ADMIN
