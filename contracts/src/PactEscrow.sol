// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {PactRegistry} from "./PactRegistry.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Minimal score-tier read. PactScore lands later; escrow only needs the tier.
interface IPactScore {
    function getTier(string calldata subname) external view returns (uint8);
}

/// @title PactEscrow
/// @notice Holds USDC per engagement and releases it on milestone acceptance.
/// Core design goal (the "FilePizza mechanic"): releaseMilestone() and autoRelease()
/// are callable directly by the accepting party's wallet — Pact's backend is never
/// in the critical path of fund release. The backend only handles notifications,
/// off-chain World-proof verification (relayed via attestWorldVerification), and
/// scheduling the autoRelease call for recurring templates via a Privy session signer.
contract PactEscrow {
    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct EscrowInfo {
        address client;          // payer — funds the escrow
        address provider;        // payee — receives milestone releases
        uint256 totalAmount;     // sum of all milestone amounts, USDC 6 decimals
        uint8 milestoneCount;
        bool funded;
        bool everDisputed;       // sticky flag for the reputation record — true if ANY milestone was ever disputed
        bool completedEmitted;   // guards against emitting PactCompleted twice
        uint8 fundedCount;       // M2: number of leading funded milestones (prefix length)
        uint256 fundedTotal;     // M2: sum of funded milestone amounts actually escrowed
        bool defaulted;          // M2: true once recordDefault fires for the first unfunded tranche
    }

    /// @notice M4 executable terms committed per milestone at funding.
    /// Kernel scope only: no auto-discount, no arbiters, no streaming/chaining/sealed.
    struct MilestoneTerms {
        uint256 deadline;               // unix time; 0 = no deadline
        uint256 graceSeconds;           // lateness grace before the late flag sets
        bool evidenceRequired;          // submitCompletion must carry evidenceHash
        uint256 acceptanceWindowSeconds;
        uint16 defaultProviderBps;      // fallback split on challenge (5000 = 50/50)
        uint256 challengeWindowSeconds;
        uint8 visibility;               // 0 = public, 1 = commit (2 = sealed is v2.1)
    }

    struct Milestone {
        uint256 amount;
        bool submitted;
        uint256 submittedAt;
        uint256 releaseAfter;    // timestamp after which autoRelease is allowed
        bool released;
        bool disputed;           // true while an active dispute is open on this milestone
        bytes32 evidenceHash;    // M4: content fingerprint committed at submitCompletion
        bool late;               // M4: true if submitted past deadline + grace
    }

    /// @notice M1 bilateral fidelity bond state per engagement.
    struct Bond {
        uint256 amount;
        address bonder;
        bool posted;
        bool frozen;
        bool settled;
        uint256 burned;
    }

    /// @notice M3 optimistic dispute state per milestone.
    struct DisputeState {
        bool active;
        uint256 providerAmount;
        uint256 clientRefund;
        address proposer;
        uint256 challengeDeadline;
        bool challenged;
    }

    /// @notice M6 record-only attestation per milestone.
    struct Attestation {
        address attestor;
        bytes32 evidenceHash;
        bool verdict;
        uint256 at;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;
    PactRegistry public immutable registry;
    address public admin;
    address public worldVerifier; // trusted backend signer that relays World Selfie Check results on-chain

    /// @notice Milestones at or above this USDC amount (6 decimals) require a World
    /// Selfie Check attestation before release. Default $5,000 = 5_000_000_000 (6 decimals).
    uint256 public highValueThreshold = 5_000 * 1e6;

    mapping(bytes32 => EscrowInfo) public escrows;
    mapping(bytes32 => mapping(uint256 => Milestone)) public milestones;
    mapping(bytes32 => mapping(uint256 => MilestoneTerms)) public milestoneTerms;
    mapping(bytes32 => mapping(uint256 => bool)) public worldAttested;
    mapping(bytes32 => Bond) public bonds;
    mapping(bytes32 => mapping(uint256 => DisputeState)) public disputeStates;
    /// @notice M5 pull-payment fallback: engagementId => recipient => claimable amount.
    mapping(bytes32 => mapping(address => uint256)) public pendingShares;
    /// @notice M6 record-only attestations: engagementId => milestoneIndex => records.
    mapping(bytes32 => mapping(uint256 => Attestation[])) private _attestations;

    /// @notice M1 bond size by score tier: 10% / 7% / 5% / 2% (bps).
    /// Array constants are not supported by Solidity, so this pure getter
    /// exposes the same curve: index = tier, value = bps.
    function BOND_BPS_BY_TIER(uint256 tier) public pure returns (uint16) {
        if (tier == 1) return 700;
        if (tier == 2) return 500;
        if (tier >= 3) return 200;
        return 1000;
    }

    /// @notice M2 PactScore contract (tier source). Zero = no score yet, tier 0.
    address public scoreContract;

    /// @dev Burn sink for slashed bonds.
    address internal constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// @dev dispute co-signature bookkeeping: engagementId => milestoneIndex => party => proposal hash
    mapping(bytes32 => mapping(uint256 => mapping(address => bytes32))) private _disputeVote;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event EngagementFunded(bytes32 indexed engagementId, address indexed client, address indexed provider, uint256 totalAmount, uint256 milestoneCount);
    event TermsCommitted(bytes32 indexed engagementId, uint256 milestoneIndex);
    event MilestoneSubmitted(bytes32 indexed engagementId, uint256 milestoneIndex, uint256 releaseAfter, bytes32 evidenceHash, bool late);
    event MilestoneReleased(bytes32 indexed engagementId, uint256 milestoneIndex, uint256 amount);
    event MilestoneDisputed(bytes32 indexed engagementId, uint256 milestoneIndex);
    event DisputeResolved(bytes32 indexed engagementId, uint256 milestoneIndex, uint256 providerAmount, uint256 clientRefund);
    event WorldVerified(bytes32 indexed engagementId, uint256 milestoneIndex);
    event HighValueThresholdUpdated(uint256 newThreshold);
    event WorldVerifierUpdated(address newVerifier);
    event BondPosted(bytes32 indexed engagementId, address indexed bonder, uint256 amount);
    event BondReturned(bytes32 indexed engagementId, address indexed provider, uint256 amount);
    event BondSlashed(bytes32 indexed engagementId, uint256 amount);
    event BondFrozen(bytes32 indexed engagementId);
    event ResolutionProposed(
        bytes32 indexed engagementId, uint256 milestoneIndex, uint256 providerAmount, uint256 clientRefund, address proposer
    );
    event ResolutionChallenged(bytes32 indexed engagementId, uint256 milestoneIndex, address challenger);
    event ResolutionExecuted(
        bytes32 indexed engagementId, uint256 milestoneIndex, uint256 providerAmount, uint256 clientRefund, bool challenged
    );
    event TopUpFunded(bytes32 indexed engagementId, uint256 startIndex, uint256 count);
    event DefaultRecorded(bytes32 indexed engagementId);
    event SplitReleased(bytes32 indexed engagementId, uint256 total);
    event ShareClaimed(bytes32 indexed engagementId, address indexed recipient, uint256 amount);
    event CompletionAttested(
        bytes32 indexed engagementId, uint256 milestoneIndex, address indexed attestor, bytes32 evidenceHash, bool verdict
    );

    /// @notice The reputation record. Anyone can filter this event by subname to
    /// reproduce a business's track record with zero trust in Pact's backend.
    event PactCompleted(
        bytes32 indexed engagementId,
        address indexed partyA,
        string subnameA,
        address indexed partyB,
        string subnameB,
        uint8 templateType,
        uint256 totalValue,
        bool onTime,
        bool disputed
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error NotActive();
    error AlreadyFunded();
    error NotFunded();
    error NotAParty();
    error NotClient();
    error NotProvider();
    error AmountsMismatch();
    error MilestoneAlreadySubmitted();
    error MilestoneNotSubmitted();
    error MilestoneAlreadyReleased();
    error MilestoneDisputedErr();
    error MilestoneNotDisputed();
    error WindowNotClosed();
    error WorldVerificationRequired();
    error NotWorldVerifier();
    error OnlyAdmin();
    error BadShare();
    error TermsMismatch();
    error BadVisibility();
    error EvidenceRequired();
    error TransferFailed();
    error ZeroAddress();
    error BondNotPosted();
    error BondAlreadyPosted();
    error NotProposer();
    error CannotChallengeOwnProposal();
    error InsufficientFunding();
    error MilestoneUnfunded();
    error NothingToClaim();
    error AlreadyDefaulted();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    constructor(address usdcAddress, address registryAddress) {
        if (usdcAddress == address(0) || registryAddress == address(0)) revert ZeroAddress();
        usdc = IERC20(usdcAddress);
        registry = PactRegistry(registryAddress);
        admin = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    function setWorldVerifier(address v) external onlyAdmin {
        if (v == address(0)) revert ZeroAddress();
        worldVerifier = v;
        emit WorldVerifierUpdated(v);
    }

    function setHighValueThreshold(uint256 newThreshold) external onlyAdmin {
        highValueThreshold = newThreshold;
        emit HighValueThresholdUpdated(newThreshold);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
    }

    /// @notice Wire the PactScore contract (M2 lands later). Zero disables tier reads (tier 0).
    function setScoreContract(address newScoreContract) external onlyAdmin {
        scoreContract = newScoreContract;
    }

    /// @notice Score tier of a wallet. 0 when no score contract is wired.
    function _tierOf(address wallet) internal view returns (uint8) {
        if (scoreContract == address(0)) return 0;
        return IPactScore(scoreContract).getTier(registry.getBusiness(wallet).ensSubname);
    }

    /// @notice Backwards-compatible alias kept for the M1 bond path.
    function _providerTier(address wallet) internal view returns (uint8) {
        return _tierOf(wallet);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Funding
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Called by whichever party is paying, immediately after both parties
    /// have signed in PactRegistry (status == ACTIVE). Caller must have approved
    /// this contract for `sum(milestoneAmounts)` USDC beforehand.
    /// @param milestoneAmounts Per-milestone USDC amounts (6 decimals). A Fixed
    /// Delivery template passes a single-element array; Milestone/T&M/Recurring
    /// pass one element per period/phase; Split Delivery passes a single element
    /// representing the whole engagement (released via splitRelease, not releaseMilestone).
    /// @param terms M4 executable terms per milestone (must match milestoneAmounts length).
    function fundEngagement(
        bytes32 engagementId,
        uint256[] calldata milestoneAmounts,
        MilestoneTerms[] calldata terms
    ) external {
        PactRegistry.Engagement memory e = registry.getEngagement(engagementId);
        if (e.status != PactRegistry.EngagementStatus.ACTIVE) revert NotActive();
        if (escrows[engagementId].funded) revert AlreadyFunded();
        if (msg.sender != e.partyA && msg.sender != e.partyB) revert NotAParty();
        if (terms.length != milestoneAmounts.length) revert TermsMismatch();

        for (uint256 i = 0; i < terms.length; i++) {
            if (terms[i].defaultProviderBps > 10_000) revert BadShare();
            if (terms[i].visibility > 1) revert BadVisibility();
        }

        // M2: amounts must be a nonzero PREFIX of the milestone schedule.
        (uint256 fundedCount, uint256 prefixSum) = _fundingPrefix(milestoneAmounts, e.totalAmount);

        {
            uint8 clientTier = _tierOf(msg.sender);
            uint256 floor = (e.totalAmount * (clientTier >= 2 ? 5000 : 10_000)) / 10_000;
            if (prefixSum < floor) revert InsufficientFunding();
        }

        address provider = msg.sender == e.partyA ? e.partyB : e.partyA;

        // M1: provider must stake the fidelity bond before the client funds.
        Bond storage existingBond = bonds[engagementId];
        if (!existingBond.posted || existingBond.bonder != provider) revert BondNotPosted();

        EscrowInfo storage info = escrows[engagementId];
        info.client = msg.sender;
        info.provider = provider;
        info.totalAmount = e.totalAmount;
        info.milestoneCount = uint8(milestoneAmounts.length);
        info.funded = true;
        info.everDisputed = false;
        info.completedEmitted = false;
        info.fundedCount = uint8(fundedCount);
        info.fundedTotal = prefixSum;
        info.defaulted = false;

        _storeMilestones(engagementId, milestoneAmounts, terms);

        bool ok = usdc.transferFrom(msg.sender, address(this), prefixSum);
        if (!ok) revert TransferFailed();

        emit EngagementFunded(engagementId, msg.sender, provider, prefixSum, milestoneAmounts.length);
    }

    /// @dev M2 prefix validation: k >= 1 leading nonzero entries, rest zero.
    function _fundingPrefix(uint256[] calldata amounts, uint256 totalAmount)
        internal
        pure
        returns (uint256 fundedCount, uint256 prefixSum)
    {
        bool seenZero = false;
        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 amt = amounts[i];
            if (amt > 0) {
                if (seenZero) revert AmountsMismatch();
                fundedCount += 1;
                prefixSum += amt;
            } else {
                seenZero = true;
            }
        }
        if (fundedCount == 0) revert AmountsMismatch();
        if (prefixSum > totalAmount) revert AmountsMismatch();
    }

    /// @dev Writes milestone slots + terms without holding struct literals on the caller stack.
    function _storeMilestones(
        bytes32 engagementId,
        uint256[] calldata amounts,
        MilestoneTerms[] calldata terms
    ) internal {
        for (uint256 i = 0; i < amounts.length; i++) {
            Milestone storage ms = milestones[engagementId][i];
            ms.amount = amounts[i];
            ms.submitted = false;
            ms.submittedAt = 0;
            ms.releaseAfter = 0;
            ms.released = false;
            ms.disputed = false;
            ms.evidenceHash = bytes32(0);
            ms.late = false;
            milestoneTerms[engagementId][i] = terms[i];
            emit TermsCommitted(engagementId, i);
        }
    }

    /// @notice M2 top-up for the next unfunded tranches. `startIndex` must equal
    /// the current fundedCount; every amount must be nonzero; the new funded
    /// total may not exceed the engagement total.
    function topUp(bytes32 engagementId, uint256 startIndex, uint256[] calldata amounts) external {
        EscrowInfo storage info = escrows[engagementId];
        if (!info.funded) revert NotFunded();
        if (startIndex != info.fundedCount) revert AmountsMismatch();
        if (amounts.length == 0) revert AmountsMismatch();
        if (startIndex + amounts.length > info.milestoneCount) revert AmountsMismatch();

        uint256 sum;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] == 0) revert AmountsMismatch();
            sum += amounts[i];
        }
        uint256 newFundedTotal = info.fundedTotal + sum;
        if (newFundedTotal > info.totalAmount) revert AmountsMismatch();

        bool ok = usdc.transferFrom(msg.sender, address(this), sum);
        if (!ok) revert TransferFailed();

        for (uint256 i = 0; i < amounts.length; i++) {
            milestones[engagementId][startIndex + i].amount = amounts[i];
        }
        info.fundedCount = uint8(uint256(info.fundedCount) + amounts.length);
        info.fundedTotal = newFundedTotal;

        emit TopUpFunded(engagementId, startIndex, amounts.length);
    }

    /// @notice M2 default flag for an unfunded tranche past its deadline+grace.
    /// Callable by anyone; record-only (never taints provider onTime).
    function recordDefault(bytes32 engagementId) external {
        EscrowInfo storage info = escrows[engagementId];
        if (!info.funded) revert NotFunded();
        if (info.defaulted) revert AlreadyDefaulted();
        if (uint256(info.fundedCount) >= uint256(info.milestoneCount)) revert MilestoneUnfunded();

        MilestoneTerms storage t = milestoneTerms[engagementId][info.fundedCount];
        if (t.deadline == 0 || block.timestamp <= t.deadline + t.graceSeconds) revert WindowNotClosed();

        info.defaulted = true;
        emit DefaultRecorded(engagementId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // M1 bilateral fidelity bonds
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Provider stakes a fidelity bond (score-scaled, 10% at tier 0).
    /// Caller must be a registry party of the engagement. Required before fundEngagement.
    function postBond(bytes32 engagementId) external {
        PactRegistry.Engagement memory e = registry.getEngagement(engagementId);
        if (msg.sender != e.partyA && msg.sender != e.partyB) revert NotAParty();
        Bond storage b = bonds[engagementId];
        if (b.posted) revert BondAlreadyPosted();

        uint8 tier = _providerTier(msg.sender);
        uint256 bps = BOND_BPS_BY_TIER(tier);
        uint256 amount = (e.totalAmount * bps) / 10_000;

        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();

        b.amount = amount;
        b.bonder = msg.sender;
        b.posted = true;
        b.frozen = false;
        b.settled = false;
        b.burned = 0;

        emit BondPosted(engagementId, msg.sender, amount);
    }

    /// @notice Settles the bond slice for one milestone release/resolution:
    /// burns amount/milestoneCount if the milestone was late, and returns the
    /// remainder to the provider once every milestone has released.
    function _settleBond(bytes32 engagementId, EscrowInfo storage info, uint256 milestoneIndex) internal {
        Bond storage b = bonds[engagementId];
        if (!b.posted || b.settled) return;
        b.frozen = false;

        Milestone storage m = milestones[engagementId][milestoneIndex];
        if (m.late && info.milestoneCount > 0) {
            uint256 share = b.amount / info.milestoneCount;
            if (share > 0) {
                b.burned += share;
                bool ok = usdc.transfer(BURN_ADDRESS, share);
                if (!ok) revert TransferFailed();
                emit BondSlashed(engagementId, share);
            }
        }

        for (uint256 i = 0; i < info.fundedCount; i++) {
            if (!milestones[engagementId][i].released) return;
        }

        uint256 returned = b.amount - b.burned;
        b.settled = true;
        if (returned > 0) {
            bool ok = usdc.transfer(info.provider, returned);
            if (!ok) revert TransferFailed();
        }
        emit BondReturned(engagementId, info.provider, returned);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Completion / acceptance
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Provider marks a milestone complete. Starts the per-milestone
    /// acceptance window committed at funding.
    function submitCompletion(bytes32 engagementId, uint256 milestoneIndex, bytes32 evidenceHash) external {
        EscrowInfo storage info = escrows[engagementId];
        if (!info.funded) revert NotFunded();
        if (msg.sender != info.provider) revert NotProvider();
        if (milestoneIndex >= info.fundedCount) revert MilestoneUnfunded();

        Milestone storage m = milestones[engagementId][milestoneIndex];
        if (m.submitted) revert MilestoneAlreadySubmitted();
        if (m.disputed) revert MilestoneDisputedErr();

        MilestoneTerms storage t = milestoneTerms[engagementId][milestoneIndex];
        if (t.evidenceRequired && evidenceHash == bytes32(0)) revert EvidenceRequired();

        m.evidenceHash = evidenceHash;
        if (t.deadline != 0 && block.timestamp > t.deadline + t.graceSeconds) {
            m.late = true;
        }

        m.submitted = true;
        m.submittedAt = block.timestamp;
        m.releaseAfter = block.timestamp + t.acceptanceWindowSeconds;

        emit MilestoneSubmitted(engagementId, milestoneIndex, m.releaseAfter, evidenceHash, m.late);
    }

    /// @notice The client (accepting party) calls this directly — no Pact backend
    /// involved. For milestones at/above `highValueThreshold`, a World Selfie Check
    /// attestation (see attestWorldVerification) must already be on record.
    function releaseMilestone(bytes32 engagementId, uint256 milestoneIndex) external {
        EscrowInfo storage info = escrows[engagementId];
        if (!info.funded) revert NotFunded();
        if (msg.sender != info.client) revert NotClient();

        _release(engagementId, milestoneIndex, info);
    }

    /// @notice Callable by anyone (typically a Privy session signer on a schedule,
    /// or a keeper) once the acceptance window has closed without a dispute. This
    /// is what makes retainer/recurring/T&M auto-pay work with no manual action.
    function autoRelease(bytes32 engagementId, uint256 milestoneIndex) external {
        EscrowInfo storage info = escrows[engagementId];
        if (!info.funded) revert NotFunded();

        Milestone storage m = milestones[engagementId][milestoneIndex];
        if (m.releaseAfter == 0 || block.timestamp < m.releaseAfter) revert WindowNotClosed();

        _release(engagementId, milestoneIndex, info);
    }

    function _release(bytes32 engagementId, uint256 milestoneIndex, EscrowInfo storage info) internal {
        Milestone storage m = milestones[engagementId][milestoneIndex];
        if (!m.submitted) revert MilestoneNotSubmitted();
        if (m.released) revert MilestoneAlreadyReleased();
        if (m.disputed) revert MilestoneDisputedErr();

        if (m.amount >= highValueThreshold) {
            if (!worldAttested[engagementId][milestoneIndex]) revert WorldVerificationRequired();
        }

        m.released = true;

        bool ok = usdc.transfer(info.provider, m.amount);
        if (!ok) revert TransferFailed();

        emit MilestoneReleased(engagementId, milestoneIndex, m.amount);
        _settleBond(engagementId, info, milestoneIndex);
        _finalizeIfComplete(engagementId, info);
    }

    /// @notice Template 6 (Split Delivery) only. Client accepts the joint delivery;
    /// USDC splits atomically to both providers in one transaction — no manual split,
    /// no trust required between the two co-delivering businesses.
    function splitRelease(
        bytes32 engagementId,
        address providerA,
        uint256 shareABps,      // basis points, 0-10000
        address providerB
    ) external {
        EscrowInfo storage info = escrows[engagementId];
        if (!info.funded) revert NotFunded();
        if (msg.sender != info.client) revert NotClient();
        if (shareABps > 10_000) revert BadShare();

        Milestone storage m = milestones[engagementId][0];
        if (!m.submitted) revert MilestoneNotSubmitted();
        if (m.released) revert MilestoneAlreadyReleased();
        if (m.disputed) revert MilestoneDisputedErr();

        if (m.amount >= highValueThreshold) {
            if (!worldAttested[engagementId][0]) revert WorldVerificationRequired();
        }

        uint256 amountA = (m.amount * shareABps) / 10_000;
        uint256 amountB = m.amount - amountA; // remainder assigned to B — no dust lost

        m.released = true;

        if (amountA > 0) {
            bool okA = usdc.transfer(providerA, amountA);
            if (!okA) revert TransferFailed();
        }
        if (amountB > 0) {
            bool okB = usdc.transfer(providerB, amountB);
            if (!okB) revert TransferFailed();
        }

        emit MilestoneReleased(engagementId, 0, m.amount);
        _settleBond(engagementId, info, 0);
        _finalizeIfComplete(engagementId, info);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // M5 N-party splits with pull-payment fallback
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice M5 N-way fan-out for milestone 0. Per-recipient try/catch: a
    /// failing receiver is credited to pendingShares instead of bricking the
    /// whole split; last recipient takes the remainder dust.
    function releaseSplit(
        bytes32 engagementId,
        address[] calldata recipients,
        uint16[] calldata sharesBps
    ) external {
        EscrowInfo storage info = escrows[engagementId];
        if (!info.funded) revert NotFunded();
        if (msg.sender != info.client) revert NotClient();
        if (recipients.length != sharesBps.length || recipients.length == 0) revert BadShare();

        uint256 totalBps;
        for (uint256 i = 0; i < sharesBps.length; i++) {
            totalBps += sharesBps[i];
        }
        if (totalBps != 10_000) revert BadShare();

        Milestone storage m = milestones[engagementId][0];
        if (!m.submitted) revert MilestoneNotSubmitted();
        if (m.released) revert MilestoneAlreadyReleased();
        if (m.disputed) revert MilestoneDisputedErr();

        if (m.amount >= highValueThreshold) {
            if (!worldAttested[engagementId][0]) revert WorldVerificationRequired();
        }

        uint256 total = m.amount;
        uint256 distributed;
        m.released = true;

        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 amt;
            if (i == recipients.length - 1) {
                amt = total - distributed;
            } else {
                amt = (total * sharesBps[i]) / 10_000;
                distributed += amt;
            }
            if (amt == 0) continue;
            try usdc.transfer(recipients[i], amt) returns (bool ok) {
                if (!ok) {
                    pendingShares[engagementId][recipients[i]] += amt;
                }
            } catch {
                pendingShares[engagementId][recipients[i]] += amt;
            }
        }

        emit SplitReleased(engagementId, total);
        _settleBond(engagementId, info, 0);
        _finalizeIfComplete(engagementId, info);
    }

    /// @notice M5 claim fallback for a failed split recipient. Pullable indefinitely.
    function claimShare(bytes32 engagementId) external {
        uint256 amt = pendingShares[engagementId][msg.sender];
        if (amt == 0) revert NothingToClaim();
        pendingShares[engagementId][msg.sender] = 0;
        bool ok = usdc.transfer(msg.sender, amt);
        if (!ok) revert TransferFailed();
        emit ShareClaimed(engagementId, msg.sender, amt);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // M6 attestations (record-only)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice M6 record-only attestation. Open to anyone; never read by release paths.
    function attestCompletion(
        bytes32 engagementId,
        uint256 milestoneIndex,
        bytes32 evidenceHash,
        bool verdict
    ) external {
        _attestations[engagementId][milestoneIndex].push(
            Attestation({attestor: msg.sender, evidenceHash: evidenceHash, verdict: verdict, at: block.timestamp})
        );
        emit CompletionAttested(engagementId, milestoneIndex, msg.sender, evidenceHash, verdict);
    }

    function getAttestations(bytes32 engagementId, uint256 milestoneIndex)
        external
        view
        returns (Attestation[] memory)
    {
        return _attestations[engagementId][milestoneIndex];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // World Selfie Check attestation
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Called by the trusted backend signer once it has verified a World
    /// Selfie Check proof off-chain for this specific engagement + milestone (the
    /// proof is bound to the engagement hash so a replayed selfie session can't be
    /// reused elsewhere). This unblocks releaseMilestone/autoRelease/splitRelease
    /// for high-value milestones.
    function attestWorldVerification(bytes32 engagementId, uint256 milestoneIndex) external {
        if (msg.sender != worldVerifier) revert NotWorldVerifier();
        worldAttested[engagementId][milestoneIndex] = true;
        emit WorldVerified(engagementId, milestoneIndex);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Disputes
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Either party disputes a submitted-but-not-yet-released milestone.
    /// Freezes that milestone until both parties co-sign an identical resolution.
    function raiseDispute(bytes32 engagementId, uint256 milestoneIndex) external {
        EscrowInfo storage info = escrows[engagementId];
        if (!info.funded) revert NotFunded();
        if (msg.sender != info.client && msg.sender != info.provider) revert NotAParty();

        Milestone storage m = milestones[engagementId][milestoneIndex];
        if (m.released) revert MilestoneAlreadyReleased();
        if (m.disputed) revert MilestoneDisputedErr();

        m.disputed = true;
        info.everDisputed = true;

        emit MilestoneDisputed(engagementId, milestoneIndex);

        // M1: disputed milestones freeze the bond until resolution.
        Bond storage db = bonds[engagementId];
        if (db.posted && !db.settled) {
            db.frozen = true;
            emit BondFrozen(engagementId);
        }
    }

    /// @notice Key-quorum resolution: both client and provider must independently
    /// call this with the *same* split for it to execute. USDC stays in escrow
    /// indefinitely until both sides agree (no third-party arbitration in MVP).
    function resolveDispute(
        bytes32 engagementId,
        uint256 milestoneIndex,
        uint256 providerAmount,
        uint256 clientRefund
    ) external {
        EscrowInfo storage info = escrows[engagementId];
        if (!info.funded) revert NotFunded();
        if (msg.sender != info.client && msg.sender != info.provider) revert NotAParty();

        Milestone storage m = milestones[engagementId][milestoneIndex];
        if (!m.disputed) revert MilestoneNotDisputed();
        if (m.released) revert MilestoneAlreadyReleased();
        if (providerAmount + clientRefund != m.amount) revert AmountsMismatch();

        bytes32 proposal = keccak256(abi.encode(providerAmount, clientRefund));
        _disputeVote[engagementId][milestoneIndex][msg.sender] = proposal;

        address other = msg.sender == info.client ? info.provider : info.client;
        bytes32 otherVote = _disputeVote[engagementId][milestoneIndex][other];

        if (otherVote != bytes32(0) && otherVote == proposal) {
            m.released = true;
            m.disputed = false; // resolved

            if (providerAmount > 0) {
                bool okP = usdc.transfer(info.provider, providerAmount);
                if (!okP) revert TransferFailed();
            }
            if (clientRefund > 0) {
                bool okC = usdc.transfer(info.client, clientRefund);
                if (!okC) revert TransferFailed();
            }

            emit DisputeResolved(engagementId, milestoneIndex, providerAmount, clientRefund);
            _settleBond(engagementId, info, milestoneIndex);
            _finalizeIfComplete(engagementId, info);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // M3 optimistic disputes (co-sign path above is the mutual fast path)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Either party proposes a split for a disputed milestone.
    /// First proposal opens a fixed challenge window; only the proposer may
    /// update afterwards, and re-proposals never extend the original deadline.
    function proposeResolution(
        bytes32 engagementId,
        uint256 milestoneIndex,
        uint256 providerAmount,
        uint256 clientRefund
    ) external {
        EscrowInfo storage info = escrows[engagementId];
        if (!info.funded) revert NotFunded();
        if (msg.sender != info.client && msg.sender != info.provider) revert NotAParty();

        Milestone storage m = milestones[engagementId][milestoneIndex];
        if (!m.submitted) revert MilestoneNotSubmitted();
        if (m.released) revert MilestoneAlreadyReleased();
        if (!m.disputed) revert MilestoneNotDisputed();
        if (providerAmount + clientRefund != m.amount) revert AmountsMismatch();

        DisputeState storage s = disputeStates[engagementId][milestoneIndex];
        if (s.challengeDeadline == 0) {
            s.active = true;
            s.providerAmount = providerAmount;
            s.clientRefund = clientRefund;
            s.proposer = msg.sender;
            s.challengeDeadline =
                block.timestamp + milestoneTerms[engagementId][milestoneIndex].challengeWindowSeconds;
            s.challenged = false;
        } else {
            if (msg.sender != s.proposer) revert NotProposer();
            s.providerAmount = providerAmount;
            s.clientRefund = clientRefund;
            // keep the ORIGINAL deadline and the challenged flag
        }

        emit ResolutionProposed(engagementId, milestoneIndex, providerAmount, clientRefund, msg.sender);
    }

    /// @notice Counterparty challenges a proposed split. At window close,
    /// executeResolution then pays the pre-agreed default split instead.
    function challengeResolution(bytes32 engagementId, uint256 milestoneIndex) external {
        EscrowInfo storage info = escrows[engagementId];
        if (!info.funded) revert NotFunded();
        if (msg.sender != info.client && msg.sender != info.provider) revert NotAParty();

        Milestone storage m = milestones[engagementId][milestoneIndex];
        if (m.released) revert MilestoneAlreadyReleased();

        DisputeState storage s = disputeStates[engagementId][milestoneIndex];
        if (!s.active || s.challengeDeadline == 0) revert MilestoneNotDisputed();
        if (msg.sender == s.proposer) revert CannotChallengeOwnProposal();

        s.challenged = true;
        emit ResolutionChallenged(engagementId, milestoneIndex, msg.sender);
    }

    /// @notice Anyone executes a matured proposal: the proposed split when
    /// unchallenged, else the pre-agreed default split from milestone terms.
    function executeResolution(bytes32 engagementId, uint256 milestoneIndex) external {
        EscrowInfo storage info = escrows[engagementId];
        if (!info.funded) revert NotFunded();

        Milestone storage m = milestones[engagementId][milestoneIndex];
        if (m.released) revert MilestoneAlreadyReleased();

        DisputeState storage s = disputeStates[engagementId][milestoneIndex];
        if (!s.active || s.challengeDeadline == 0) revert MilestoneNotDisputed();
        if (block.timestamp < s.challengeDeadline) revert WindowNotClosed();

        uint256 providerAmount;
        uint256 clientRefund;
        bool wasChallenged = s.challenged;
        if (wasChallenged) {
            MilestoneTerms storage t = milestoneTerms[engagementId][milestoneIndex];
            providerAmount = (m.amount * t.defaultProviderBps) / 10_000;
            clientRefund = m.amount - providerAmount;
        } else {
            providerAmount = s.providerAmount;
            clientRefund = s.clientRefund;
        }

        m.released = true;
        m.disputed = false;

        if (providerAmount > 0) {
            bool okP = usdc.transfer(info.provider, providerAmount);
            if (!okP) revert TransferFailed();
        }
        if (clientRefund > 0) {
            bool okC = usdc.transfer(info.client, clientRefund);
            if (!okC) revert TransferFailed();
        }

        emit ResolutionExecuted(engagementId, milestoneIndex, providerAmount, clientRefund, wasChallenged);
        _settleBond(engagementId, info, milestoneIndex);
        _finalizeIfComplete(engagementId, info);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Reputation finalization
    // ─────────────────────────────────────────────────────────────────────────

    function _finalizeIfComplete(bytes32 engagementId, EscrowInfo storage info) internal {
        if (info.completedEmitted) return;
        if (info.fundedCount == 0) return;

        for (uint256 i = 0; i < info.fundedCount; i++) {
            if (!milestones[engagementId][i].released) return; // not all funded done yet
        }

        info.completedEmitted = true;

        PactRegistry.Engagement memory e = registry.getEngagement(engagementId);
        PactRegistry.Business memory bizA = registry.getBusiness(e.partyA);
        PactRegistry.Business memory bizB = registry.getBusiness(e.partyB);

        // M4 on-time definition: no dispute ever raised AND no milestone submitted late
        // (late = submitted past deadline + grace, flagged at submitCompletion).
        // M2: default does NOT taint provider onTime; only funded milestones count.
        bool onTime = !info.everDisputed;
        if (onTime) {
            for (uint256 i = 0; i < info.fundedCount; i++) {
                if (milestones[engagementId][i].late) {
                    onTime = false;
                    break;
                }
            }
        }

        // M6: engagement visibility = terms[0]. Commit mode emits keccak-hex of
        // each subname (66-char 0x-hex) instead of plaintext.
        string memory subA = bizA.ensSubname;
        string memory subB = bizB.ensSubname;
        if (milestoneTerms[engagementId][0].visibility == 1) {
            subA = Strings.toHexString(uint256(keccak256(bytes(subA))), 32);
            subB = Strings.toHexString(uint256(keccak256(bytes(subB))), 32);
        }

        emit PactCompleted(
            engagementId,
            e.partyA,
            subA,
            e.partyB,
            subB,
            e.templateType,
            info.fundedTotal,
            onTime,
            info.everDisputed
        );

        registry.setEngagementStatus(engagementId, PactRegistry.EngagementStatus.COMPLETED);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function getMilestone(bytes32 engagementId, uint256 milestoneIndex) external view returns (Milestone memory) {
        return milestones[engagementId][milestoneIndex];
    }

    function getMilestoneTerms(bytes32 engagementId, uint256 milestoneIndex) external view returns (MilestoneTerms memory) {
        return milestoneTerms[engagementId][milestoneIndex];
    }

    function getEscrowInfo(bytes32 engagementId) external view returns (EscrowInfo memory) {
        return escrows[engagementId];
    }

    function getBond(bytes32 engagementId) external view returns (Bond memory) {
        return bonds[engagementId];
    }
}
