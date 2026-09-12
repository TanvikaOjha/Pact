// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {PactRegistry} from "./PactRegistry.sol";

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

        uint256 sum;
        for (uint256 i = 0; i < milestoneAmounts.length; i++) {
            sum += milestoneAmounts[i];
        }
        if (sum != e.totalAmount) revert AmountsMismatch();

        address provider = msg.sender == e.partyA ? e.partyB : e.partyA;

        escrows[engagementId] = EscrowInfo({
            client: msg.sender,
            provider: provider,
            totalAmount: e.totalAmount,
            milestoneCount: uint8(milestoneAmounts.length),
            funded: true,
            everDisputed: false,
            completedEmitted: false
        });

        for (uint256 i = 0; i < milestoneAmounts.length; i++) {
            milestones[engagementId][i] = Milestone({
                amount: milestoneAmounts[i],
                submitted: false,
                submittedAt: 0,
                releaseAfter: 0,
                released: false,
                disputed: false,
                evidenceHash: bytes32(0),
                late: false
            });
            milestoneTerms[engagementId][i] = terms[i];
            emit TermsCommitted(engagementId, i);
        }

        bool ok = usdc.transferFrom(msg.sender, address(this), e.totalAmount);
        if (!ok) revert TransferFailed();

        emit EngagementFunded(engagementId, msg.sender, provider, e.totalAmount, milestoneAmounts.length);
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
        _finalizeIfComplete(engagementId, info);
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
            _finalizeIfComplete(engagementId, info);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Reputation finalization
    // ─────────────────────────────────────────────────────────────────────────

    function _finalizeIfComplete(bytes32 engagementId, EscrowInfo storage info) internal {
        if (info.completedEmitted) return;

        for (uint256 i = 0; i < info.milestoneCount; i++) {
            if (!milestones[engagementId][i].released) return; // not all done yet
        }

        info.completedEmitted = true;

        PactRegistry.Engagement memory e = registry.getEngagement(engagementId);
        PactRegistry.Business memory bizA = registry.getBusiness(e.partyA);
        PactRegistry.Business memory bizB = registry.getBusiness(e.partyB);

        // M4 on-time definition: no dispute ever raised AND no milestone submitted late
        // (late = submitted past deadline + grace, flagged at submitCompletion).
        bool onTime = !info.everDisputed;
        if (onTime) {
            for (uint256 i = 0; i < info.milestoneCount; i++) {
                if (milestones[engagementId][i].late) {
                    onTime = false;
                    break;
                }
            }
        }

        emit PactCompleted(
            engagementId,
            e.partyA,
            bizA.ensSubname,
            e.partyB,
            bizB.ensSubname,
            e.templateType,
            info.totalAmount,
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
}
