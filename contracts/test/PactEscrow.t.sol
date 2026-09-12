// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PactRegistry} from "../src/PactRegistry.sol";
import {PactEscrow} from "../src/PactEscrow.sol";
import {PactScore} from "../src/PactScore.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Test-local reverting token: transfer reverts for one flagged recipient,
/// transferFrom always works (so funding/bond still succeed). Used to exercise
/// the M5 pull-payment fallback via a second escrow.
contract FailToToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public failRecipient;

    function setFailRecipient(address r) external {
        failRecipient = r;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (to == failRecipient) revert("FailTo: blocked recipient");
        require(balanceOf[msg.sender] >= amount, "FailTo: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "FailTo: insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        require(balanceOf[from] >= amount, "FailTo: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }
}

contract PactEscrowTest is Test {
    PactRegistry registry;
    PactEscrow escrow;
    MockUSDC usdc;

    address client = address(0xC11E47); // the paying party
    address provider = address(0x9201D); // the delivering party
    address worldVerifier = address(0x05071);
    address keeper = address(0xBEEF); // arbitrary caller for autoRelease, simulating a keeper/session signer

    function setUp() public {
        usdc = new MockUSDC();
        registry = new PactRegistry();
        escrow = new PactEscrow(address(usdc), address(registry));

        registry.setEscrow(address(escrow));
        escrow.setWorldVerifier(worldVerifier);

        vm.prank(client);
        registry.registerBusiness("client.pact.eth", keccak256("client-session"));
        vm.prank(provider);
        registry.registerBusiness("provider.pact.eth", keccak256("provider-session"));

        usdc.mint(client, 1_000_000e6);
        vm.prank(client);
        usdc.approve(address(escrow), type(uint256).max);

        // M1: provider must stake the fidelity bond before funding (10% at tier 0).
        usdc.mint(provider, 1_000_000e6);
        vm.prank(provider);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _activeEngagement(uint256 totalAmount, uint8 templateType) internal returns (bytes32 id) {
        vm.prank(client);
        id = registry.createEngagement(provider, templateType, totalAmount, keccak256("terms"), "eng-1.pact.eth");

        vm.prank(client);
        registry.signEngagement(id);
        vm.prank(provider);
        registry.signEngagement(id);
    }

    function _defaultTerms(uint256 n) internal pure returns (PactEscrow.MilestoneTerms[] memory terms) {
        terms = new PactEscrow.MilestoneTerms[](n);
        for (uint256 i = 0; i < n; i++) {
            terms[i] = PactEscrow.MilestoneTerms({
                deadline: 0,
                graceSeconds: 1 hours,
                evidenceRequired: false,
                acceptanceWindowSeconds: 2 days,
                defaultProviderBps: 5000,
                challengeWindowSeconds: 7 days,
                visibility: 0
            });
        }
    }

    /// @notice M1: provider stakes the bond, then client funds. Bond-first ordering
    /// is required by fundEngagement (reverts BondNotPosted otherwise).
    function _postBond(bytes32 id) internal {
        vm.prank(provider);
        escrow.postBond(id);
    }

    function _fund(bytes32 id, uint256[] memory amounts, PactEscrow.MilestoneTerms[] memory terms) internal {
        _postBond(id);
        vm.prank(client);
        escrow.fundEngagement(id, amounts, terms);
    }

    // ── Funding ─────────────────────────────────────────────────────────────

    function test_fundEngagement_movesUsdcAndStoresMilestones() public {
        bytes32 id = _activeEngagement(2_000e6, 1);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2_000e6;

        _fund(id, amounts, _defaultTerms(1));

        // escrow holds the engagement funding plus the 10% tier-0 provider bond
        assertEq(usdc.balanceOf(address(escrow)), 2_000e6 + 200e6);
        PactEscrow.EscrowInfo memory info = escrow.getEscrowInfo(id);
        assertEq(info.client, client);
        assertEq(info.provider, provider);
        assertTrue(info.funded);
        assertEq(info.milestoneCount, 1);
    }

    function test_fundEngagement_revertsOnAmountMismatch() public {
        bytes32 id = _activeEngagement(2_000e6, 1);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_999e6; // off by one dollar — below the tier-0 100% floor

        _postBond(id);
        // M2: partial single-tranche below floor is InsufficientFunding (was AmountsMismatch pre-M2).
        vm.expectRevert(PactEscrow.InsufficientFunding.selector);
        vm.prank(client);
        escrow.fundEngagement(id, amounts, _defaultTerms(1));
    }

    function test_fundEngagement_revertsOnOverTotalAmountsMismatch() public {
        bytes32 id = _activeEngagement(2_000e6, 1);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2_001e6; // over total

        _postBond(id);
        vm.expectRevert(PactEscrow.AmountsMismatch.selector);
        vm.prank(client);
        escrow.fundEngagement(id, amounts, _defaultTerms(1));
    }

    // ── Direct release (FilePizza mechanic: no backend in the call path) ──────

    function test_releaseMilestone_directClientCall_movesFundsAndEmitsCompleted() public {
        bytes32 id = _activeEngagement(2_000e6, 1);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2_000e6;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        // This call comes straight from the client's wallet — no Pact backend involved.
        vm.expectEmit(true, true, true, true);
        emit PactEscrow.PactCompleted(id, client, "client.pact.eth", provider, "provider.pact.eth", 1, 2_000e6, true, false);

        vm.prank(client);
        escrow.releaseMilestone(id, 0);

        // clean single milestone: payout plus the full bond returned (1M provider seed + payout)
        assertEq(usdc.balanceOf(provider), 1_000_000e6 + 2_000e6);
        assertEq(uint8(registry.getEngagement(id).status), uint8(PactRegistry.EngagementStatus.COMPLETED));
    }

    function test_releaseMilestone_revertsIfNotSubmitted() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(client);
        vm.expectRevert(PactEscrow.MilestoneNotSubmitted.selector);
        escrow.releaseMilestone(id, 0);
    }

    function test_multiMilestone_onlyFinalReleaseEmitsCompleted() public {
        bytes32 id = _activeEngagement(5_000e6, 2);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 2_000e6;
        amounts[1] = 3_000e6;
        _fund(id, amounts, _defaultTerms(2));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));
        vm.prank(client);
        escrow.releaseMilestone(id, 0); // first milestone — should NOT emit PactCompleted

        // 5_000e6 engagement → 500e6 bond still locked; provider nets first payout only
        assertEq(usdc.balanceOf(provider), 1_000_000e6 - 500e6 + 2_000e6);
        assertEq(uint8(registry.getEngagement(id).status), uint8(PactRegistry.EngagementStatus.ACTIVE));

        vm.prank(provider);
        escrow.submitCompletion(id, 1, bytes32(0));
        vm.prank(client);
        escrow.releaseMilestone(id, 1); // second milestone — completes the engagement

        // all clean: full 500e6 bond returned on top of both payouts
        assertEq(usdc.balanceOf(provider), 1_000_000e6 + 5_000e6);
        assertEq(uint8(registry.getEngagement(id).status), uint8(PactRegistry.EngagementStatus.COMPLETED));
    }

    // ── Auto-release ────────────────────────────────────────────────────────

    function test_autoRelease_firesAfterWindowWithNoManualAccept() public {
        bytes32 id = _activeEngagement(1_500e6, 3); // retainer-style
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_500e6;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        vm.expectRevert(PactEscrow.WindowNotClosed.selector);
        vm.prank(keeper);
        escrow.autoRelease(id, 0);

        vm.warp(block.timestamp + 2 days + 1);

        vm.prank(keeper); // arbitrary caller — simulates a Privy session signer / cron keeper
        escrow.autoRelease(id, 0);

        assertEq(usdc.balanceOf(provider), 1_000_000e6 + 1_500e6);
    }

    // ── World Selfie Check gating for high-value milestones ────────────────

    function test_highValueMilestone_requiresWorldAttestation() public {
        bytes32 id = _activeEngagement(10_000e6, 2); // above the $5,000 default threshold
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10_000e6;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        vm.prank(client);
        vm.expectRevert(PactEscrow.WorldVerificationRequired.selector);
        escrow.releaseMilestone(id, 0);

        vm.prank(worldVerifier);
        escrow.attestWorldVerification(id, 0);

        vm.prank(client);
        escrow.releaseMilestone(id, 0); // now succeeds

        assertEq(usdc.balanceOf(provider), 1_000_000e6 + 10_000e6);
    }

    function test_attestWorldVerification_onlyVerifier() public {
        bytes32 id = _activeEngagement(10_000e6, 2);
        vm.expectRevert(PactEscrow.NotWorldVerifier.selector);
        escrow.attestWorldVerification(id, 0);
    }

    // ── Split delivery: atomic, no lost dust ────────────────────────────────

    function test_splitRelease_atomicAndExactNoRemainderLost() public {
        address providerA = address(0xA);
        address providerB = address(0xB);

        bytes32 id = _activeEngagement(1_000_000, 6); // small odd number to stress rounding
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000_000;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider); // provider field is unused for split but submitCompletion still gated on it
        escrow.submitCompletion(id, 0, bytes32(0));

        vm.prank(client);
        escrow.splitRelease(id, providerA, 3333, providerB); // 33.33% / 66.67%

        uint256 balA = usdc.balanceOf(providerA);
        uint256 balB = usdc.balanceOf(providerB);

        assertEq(balA + balB, 1_000_000);
        assertEq(balA, 333_300); // (1_000_000 * 3333) / 10000
    }

    function test_splitRelease_revertsOnBadShare() public {
        bytes32 id = _activeEngagement(1_000e6, 6);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));
        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        vm.prank(client);
        vm.expectRevert(PactEscrow.BadShare.selector);
        escrow.splitRelease(id, address(0xA), 10_001, address(0xB));
    }

    // ── Disputes ─────────────────────────────────────────────────────────────

    function test_dispute_requiresBothPartiesToCosignIdenticalResolution() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        vm.prank(client);
        escrow.raiseDispute(id, 0);

        // Mismatched proposals must NOT resolve. Provider holds only the locked bond delta.
        vm.prank(client);
        escrow.resolveDispute(id, 0, 400e6, 600e6);
        vm.prank(provider);
        escrow.resolveDispute(id, 0, 500e6, 500e6);

        assertEq(usdc.balanceOf(provider), 1_000_000e6 - 100e6); // still unresolved (bond locked)

        // Matching proposal resolves and pays out (clean milestone → full 100e6 bond back).
        vm.prank(provider);
        escrow.resolveDispute(id, 0, 400e6, 600e6);

        assertEq(usdc.balanceOf(provider), 1_000_000e6 + 400e6);
        assertEq(usdc.balanceOf(client), 1_000_000e6 - 1_000e6 + 600e6); // minted balance minus funded plus refund
    }

    function test_dispute_setsDisputedFlagOnFinalReputationEvent() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        vm.prank(client);
        escrow.raiseDispute(id, 0);

        vm.prank(client);
        escrow.resolveDispute(id, 0, 1_000e6, 0);

        vm.expectEmit(true, true, true, true);
        emit PactEscrow.PactCompleted(id, client, "client.pact.eth", provider, "provider.pact.eth", 1, 1_000e6, false, true);

        vm.prank(provider);
        escrow.resolveDispute(id, 0, 1_000e6, 0); // matching proposal triggers resolution + PactCompleted
    }

    function test_raiseDispute_revertsIfAlreadyReleased() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));
        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));
        vm.prank(client);
        escrow.releaseMilestone(id, 0);

        vm.prank(client);
        vm.expectRevert(PactEscrow.MilestoneAlreadyReleased.selector);
        escrow.raiseDispute(id, 0);
    }

    // ── M4 executable terms ─────────────────────────────────────────────────

    function test_termsCommitted_storedAndEmitted() public {
        bytes32 id = _activeEngagement(2_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2_000e6;

        PactEscrow.MilestoneTerms[] memory terms = new PactEscrow.MilestoneTerms[](1);
        terms[0] = PactEscrow.MilestoneTerms({
            deadline: block.timestamp + 7 days,
            graceSeconds: 1 hours,
            evidenceRequired: false,
            acceptanceWindowSeconds: 2 days,
            defaultProviderBps: 5000,
            challengeWindowSeconds: 7 days,
            visibility: 0
        });

        _postBond(id);
        vm.expectEmit(true, false, false, true);
        emit PactEscrow.TermsCommitted(id, 0);

        vm.prank(client);
        escrow.fundEngagement(id, amounts, terms);

        PactEscrow.MilestoneTerms memory stored = escrow.getMilestoneTerms(id, 0);
        assertEq(stored.deadline, block.timestamp + 7 days);
        assertEq(stored.graceSeconds, 1 hours);
        assertFalse(stored.evidenceRequired);
        assertEq(stored.acceptanceWindowSeconds, 2 days);
        assertEq(stored.defaultProviderBps, 5000);
        assertEq(stored.challengeWindowSeconds, 7 days);
        assertEq(stored.visibility, 0);
    }

    function test_fundEngagement_revertsOnTermsMismatch() public {
        bytes32 id = _activeEngagement(2_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2_000e6;

        PactEscrow.MilestoneTerms[] memory terms = _defaultTerms(2); // length 2 vs amounts length 1

        _postBond(id);
        vm.expectRevert(PactEscrow.TermsMismatch.selector);
        vm.prank(client);
        escrow.fundEngagement(id, amounts, terms);
    }

    function test_fundEngagement_revertsOnBadVisibility() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;

        PactEscrow.MilestoneTerms[] memory terms = _defaultTerms(1);
        terms[0].visibility = 2; // sealed is v2.1

        _postBond(id);
        vm.expectRevert(PactEscrow.BadVisibility.selector);
        vm.prank(client);
        escrow.fundEngagement(id, amounts, terms);
    }

    function test_fundEngagement_revertsOnBadDefaultShare() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;

        PactEscrow.MilestoneTerms[] memory terms = _defaultTerms(1);
        terms[0].defaultProviderBps = 10001;

        _postBond(id);
        vm.expectRevert(PactEscrow.BadShare.selector);
        vm.prank(client);
        escrow.fundEngagement(id, amounts, terms);
    }

    function test_submitCompletion_revertsWhenEvidenceRequired() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;

        PactEscrow.MilestoneTerms[] memory terms = _defaultTerms(1);
        terms[0].evidenceRequired = true;

        _fund(id, amounts, terms);

        vm.prank(provider);
        vm.expectRevert(PactEscrow.EvidenceRequired.selector);
        escrow.submitCompletion(id, 0, bytes32(0));
    }

    function test_submitCompletion_storesEvidenceHash() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;

        PactEscrow.MilestoneTerms[] memory terms = _defaultTerms(1);
        terms[0].evidenceRequired = true;

        _fund(id, amounts, terms);

        bytes32 evidence = keccak256("deliverable-cid");
        vm.prank(provider);
        escrow.submitCompletion(id, 0, evidence);

        PactEscrow.Milestone memory m = escrow.getMilestone(id, 0);
        assertEq(m.evidenceHash, evidence);
    }

    function test_submitCompletion_marksLateWhenPastDeadlinePlusGrace() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;

        uint256 deadline = block.timestamp + 1 days;
        PactEscrow.MilestoneTerms[] memory terms = _defaultTerms(1);
        terms[0].deadline = deadline;
        terms[0].graceSeconds = 1 hours;

        _fund(id, amounts, terms);

        vm.warp(deadline + 1 hours + 1); // past deadline + grace

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        PactEscrow.Milestone memory m = escrow.getMilestone(id, 0);
        assertTrue(m.late);
    }

    function test_submitCompletion_notLateWhenOnTime() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;

        PactEscrow.MilestoneTerms[] memory terms = _defaultTerms(1);
        terms[0].deadline = block.timestamp + 7 days;
        terms[0].graceSeconds = 1 hours;

        _fund(id, amounts, terms);

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        PactEscrow.Milestone memory m = escrow.getMilestone(id, 0);
        assertFalse(m.late);
    }

    function test_submitCompletion_notLateWhenNoDeadline() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;

        PactEscrow.MilestoneTerms[] memory terms = _defaultTerms(1);
        terms[0].deadline = 0;

        _fund(id, amounts, terms);

        vm.warp(block.timestamp + 365 days); // far future still not late without a deadline

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        PactEscrow.Milestone memory m = escrow.getMilestone(id, 0);
        assertFalse(m.late);
    }

    function test_releaseAfter_honorsPerMilestoneWindow() public {
        bytes32 id = _activeEngagement(5_000e6, 2);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 2_000e6;
        amounts[1] = 3_000e6;

        PactEscrow.MilestoneTerms[] memory terms = _defaultTerms(2);
        terms[0].acceptanceWindowSeconds = 1 days;
        terms[1].acceptanceWindowSeconds = 3 days;

        _fund(id, amounts, terms);

        uint256 submitTime = block.timestamp;
        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));
        vm.prank(provider);
        escrow.submitCompletion(id, 1, bytes32(0));

        PactEscrow.Milestone memory m0 = escrow.getMilestone(id, 0);
        PactEscrow.Milestone memory m1 = escrow.getMilestone(id, 1);
        assertEq(m0.releaseAfter, submitTime + 1 days);
        assertEq(m1.releaseAfter, submitTime + 3 days);
    }

    function test_pactCompleted_onTimeFalseWhenLateWithNoDispute() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;

        uint256 deadline = block.timestamp + 1 days;
        PactEscrow.MilestoneTerms[] memory terms = _defaultTerms(1);
        terms[0].deadline = deadline;
        terms[0].graceSeconds = 1 hours;

        _fund(id, amounts, terms);

        vm.warp(deadline + 1 hours + 1);
        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        vm.expectEmit(true, true, true, true);
        emit PactEscrow.PactCompleted(id, client, "client.pact.eth", provider, "provider.pact.eth", 1, 1_000e6, false, false);

        vm.prank(client);
        escrow.releaseMilestone(id, 0);
    }

    // ── M1 bilateral fidelity bonds ─────────────────────────────────────────

    function test_postBond_storesAmountAndBonder() public {
        bytes32 id = _activeEngagement(2_000e6, 1);

        vm.prank(provider);
        escrow.postBond(id);

        PactEscrow.Bond memory b = escrow.getBond(id);
        assertEq(b.amount, 200e6); // 10% tier-0 (no score contract wired)
        assertEq(b.bonder, provider);
        assertTrue(b.posted);
        assertFalse(b.frozen);
        assertFalse(b.settled);
        assertEq(b.burned, 0);
    }

    function test_fundEngagement_revertsBondNotPostedWithoutBond() public {
        bytes32 id = _activeEngagement(2_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2_000e6;

        vm.expectRevert(PactEscrow.BondNotPosted.selector);
        vm.prank(client);
        escrow.fundEngagement(id, amounts, _defaultTerms(1));
    }

    function test_fundEngagement_revertsBondNotPostedWhenBonderIsNotProvider() public {
        bytes32 id = _activeEngagement(2_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2_000e6;

        // client posts instead of the provider — funding must still revert
        vm.prank(client);
        escrow.postBond(id);

        vm.expectRevert(PactEscrow.BondNotPosted.selector);
        vm.prank(client);
        escrow.fundEngagement(id, amounts, _defaultTerms(1));
    }

    function test_postBond_revertsWhenPostedTwice() public {
        bytes32 id = _activeEngagement(2_000e6, 1);
        _postBond(id);

        vm.prank(provider);
        vm.expectRevert(PactEscrow.BondAlreadyPosted.selector);
        escrow.postBond(id);
    }

    function test_lateRelease_burnsFullBondOnSingleMilestone() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;

        uint256 deadline = block.timestamp + 1 days;
        PactEscrow.MilestoneTerms[] memory terms = _defaultTerms(1);
        terms[0].deadline = deadline;
        terms[0].graceSeconds = 1 hours;
        _fund(id, amounts, terms);

        vm.warp(deadline + 1 hours + 1);
        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        address dead = 0x000000000000000000000000000000000000dEaD;
        vm.expectEmit(true, false, false, true);
        emit PactEscrow.BondSlashed(id, 100e6); // amount / count = 100e6 / 1

        vm.prank(client);
        escrow.releaseMilestone(id, 0);

        assertEq(usdc.balanceOf(dead), 100e6);
        PactEscrow.Bond memory b = escrow.getBond(id);
        assertEq(b.burned, 100e6);
        assertTrue(b.settled);
        // payout 1_000e6, no bond remainder (fully burned)
        assertEq(usdc.balanceOf(provider), 1_000_000e6 - 100e6 + 1_000e6);
    }

    function test_multiMilestone_lateBurnThenFinalReturn() public {
        bytes32 id = _activeEngagement(2_000e6, 2);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1_000e6;
        amounts[1] = 1_000e6;

        uint256 deadline = block.timestamp + 1 days;
        PactEscrow.MilestoneTerms[] memory terms = _defaultTerms(2);
        terms[0].deadline = deadline;
        terms[0].graceSeconds = 1 hours;
        terms[1].deadline = 0; // no deadline → never late
        _fund(id, amounts, terms);

        vm.warp(deadline + 1 hours + 1);
        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0)); // late
        vm.prank(provider);
        escrow.submitCompletion(id, 1, bytes32(0)); // on time (no deadline)

        vm.expectEmit(true, false, false, true);
        emit PactEscrow.BondSlashed(id, 100e6); // 200e6 / 2

        vm.prank(client);
        escrow.releaseMilestone(id, 0);

        PactEscrow.Bond memory mid = escrow.getBond(id);
        assertEq(mid.burned, 100e6);
        assertFalse(mid.settled);

        vm.expectEmit(true, true, false, true);
        emit PactEscrow.BondReturned(id, provider, 100e6); // 200e6 - 100e6 burned

        vm.prank(client);
        escrow.releaseMilestone(id, 1);

        PactEscrow.Bond memory fin = escrow.getBond(id);
        assertEq(fin.burned, 100e6);
        assertTrue(fin.settled);
        assertEq(usdc.balanceOf(provider), 1_000_000e6 - 200e6 + 2_000e6 + 100e6);
    }

    function test_raiseDispute_freezesBond() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        vm.expectEmit(true, false, false, true);
        emit PactEscrow.BondFrozen(id);

        vm.prank(client);
        escrow.raiseDispute(id, 0);

        assertTrue(escrow.getBond(id).frozen);
    }

    function test_cosignCleanResolution_returnsFullBond() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        vm.prank(client);
        escrow.resolveDispute(id, 0, 400e6, 600e6);
        vm.prank(provider);
        escrow.resolveDispute(id, 0, 400e6, 600e6);

        PactEscrow.Bond memory b = escrow.getBond(id);
        assertEq(b.burned, 0);
        assertTrue(b.settled);
        assertFalse(b.frozen);
        assertEq(usdc.balanceOf(provider), 1_000_000e6 + 400e6);
    }

    // ── M3 optimistic disputes ──────────────────────────────────────────────

    function test_proposeWaitExecute_paysProposed() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        vm.prank(client);
        escrow.proposeResolution(id, 0, 300e6, 700e6);

        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(keeper); // anyone may execute
        escrow.executeResolution(id, 0);

        assertEq(usdc.balanceOf(provider), 1_000_000e6 + 300e6); // 300e6 + full 100e6 bond back
        assertEq(usdc.balanceOf(client), 1_000_000e6 - 1_000e6 + 700e6);
        PactEscrow.Milestone memory m = escrow.getMilestone(id, 0);
        assertTrue(m.released);
        assertFalse(m.disputed);
    }

    function test_challengeExecute_paysDefaultSplit() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1)); // defaultProviderBps 5000 → 50/50

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        vm.prank(provider);
        escrow.proposeResolution(id, 0, 800e6, 200e6);

        vm.prank(client);
        escrow.challengeResolution(id, 0);

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(keeper);
        escrow.executeResolution(id, 0);

        assertEq(usdc.balanceOf(provider), 1_000_000e6 + 500e6);
        assertEq(usdc.balanceOf(client), 1_000_000e6 - 1_000e6 + 500e6);
    }

    function test_reproposeByProposer_doesNotExtendDeadline() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        vm.prank(client);
        escrow.proposeResolution(id, 0, 300e6, 700e6);

        vm.warp(block.timestamp + 3 days);
        // proposer updates the split — deadline must NOT move
        vm.prank(client);
        escrow.proposeResolution(id, 0, 400e6, 600e6);

        vm.warp(block.timestamp + 4 days + 2); // past the ORIGINAL 7-day deadline
        vm.prank(keeper);
        escrow.executeResolution(id, 0); // works — latest proposal pays out

        assertEq(usdc.balanceOf(provider), 1_000_000e6 + 400e6);
        assertEq(usdc.balanceOf(client), 1_000_000e6 - 1_000e6 + 600e6);
    }

    function test_reproposeByNonProposer_reverts() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        vm.prank(client);
        escrow.proposeResolution(id, 0, 300e6, 700e6);

        vm.prank(provider);
        vm.expectRevert(PactEscrow.NotProposer.selector);
        escrow.proposeResolution(id, 0, 500e6, 500e6);
    }

    function test_challengeByProposer_reverts() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        vm.prank(client);
        escrow.proposeResolution(id, 0, 300e6, 700e6);

        vm.prank(client);
        vm.expectRevert(PactEscrow.CannotChallengeOwnProposal.selector);
        escrow.challengeResolution(id, 0);
    }

    function test_executeBeforeDeadline_revertsWindowNotClosed() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));
        vm.prank(client);
        escrow.raiseDispute(id, 0);
        vm.prank(client);
        escrow.proposeResolution(id, 0, 300e6, 700e6);

        vm.expectRevert(PactEscrow.WindowNotClosed.selector);
        escrow.executeResolution(id, 0);
    }

    function test_proposeOnUndisputed_revertsMilestoneNotDisputed() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        vm.prank(client);
        vm.expectRevert(PactEscrow.MilestoneNotDisputed.selector);
        escrow.proposeResolution(id, 0, 500e6, 500e6);
    }

    // ── M2 on-chain pricing ─────────────────────────────────────────────────

    function _wireTier2Client() internal returns (PactScore score) {
        score = new PactScore();
        score.attestScore("client.pact.eth", 600, 1); // Trusted tier 2
        escrow.setScoreContract(address(score));
    }

    function test_m2_tier2Client_fundsFiftyPercentPrefix() public {
        _wireTier2Client();
        bytes32 id = _activeEngagement(2_000e6, 2);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1_000e6;
        amounts[1] = 0; // unfunded second tranche
        _fund(id, amounts, _defaultTerms(2));

        PactEscrow.EscrowInfo memory info = escrow.getEscrowInfo(id);
        assertEq(uint256(info.fundedCount), 1);
        assertEq(info.fundedTotal, uint256(1_000e6));
        assertEq(usdc.balanceOf(address(escrow)), 1_000e6 + 200e6); // prefix + 10% bond
    }

    function test_m2_belowFloor_revertsInsufficientFunding() public {
        bytes32 id = _activeEngagement(2_000e6, 2); // tier-0 client needs 100%
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1_000e6;
        amounts[1] = 0;

        _postBond(id);
        vm.expectRevert(PactEscrow.InsufficientFunding.selector);
        vm.prank(client);
        escrow.fundEngagement(id, amounts, _defaultTerms(2));
    }

    function test_m2_nonPrefixTail_revertsAmountsMismatch() public {
        _wireTier2Client();
        bytes32 id = _activeEngagement(2_000e6, 2);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 0; // leading zero then nonzero is not a prefix
        amounts[1] = 2_000e6;

        _postBond(id);
        vm.expectRevert(PactEscrow.AmountsMismatch.selector);
        vm.prank(client);
        escrow.fundEngagement(id, amounts, _defaultTerms(2));
    }

    function test_m2_nonPrefixHole_revertsAmountsMismatch() public {
        _wireTier2Client();
        bytes32 id = _activeEngagement(3_000e6, 3);
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 1_000e6;
        amounts[1] = 0;
        amounts[2] = 1_000e6; // nonzero after zero

        _postBond(id);
        vm.expectRevert(PactEscrow.AmountsMismatch.selector);
        vm.prank(client);
        escrow.fundEngagement(id, amounts, _defaultTerms(3));
    }

    function test_m2_topUp_extendsFundedCountAndTotal() public {
        _wireTier2Client();
        bytes32 id = _activeEngagement(2_000e6, 2);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1_000e6;
        amounts[1] = 0;
        _fund(id, amounts, _defaultTerms(2));

        uint256[] memory top = new uint256[](1);
        top[0] = 1_000e6;
        vm.expectEmit(true, false, false, true);
        emit PactEscrow.TopUpFunded(id, 1, 1);
        vm.prank(client);
        escrow.topUp(id, 1, top);

        PactEscrow.EscrowInfo memory info = escrow.getEscrowInfo(id);
        assertEq(uint256(info.fundedCount), 2);
        assertEq(info.fundedTotal, uint256(2_000e6));

        // previously unfunded milestone is now submittable
        vm.prank(provider);
        escrow.submitCompletion(id, 1, bytes32(0));
        assertTrue(escrow.getMilestone(id, 1).submitted);
    }

    function test_m2_topUp_overTotal_revertsAmountsMismatch() public {
        _wireTier2Client();
        bytes32 id = _activeEngagement(2_000e6, 2);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1_000e6;
        amounts[1] = 0;
        _fund(id, amounts, _defaultTerms(2));

        uint256[] memory top = new uint256[](1);
        top[0] = 1_500e6; // 1000 + 1500 > 2000
        vm.expectRevert(PactEscrow.AmountsMismatch.selector);
        vm.prank(client);
        escrow.topUp(id, 1, top);
    }

    function test_m2_topUp_wrongStartIndex_revertsAmountsMismatch() public {
        _wireTier2Client();
        bytes32 id = _activeEngagement(2_000e6, 2);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1_000e6;
        amounts[1] = 0;
        _fund(id, amounts, _defaultTerms(2));

        uint256[] memory top = new uint256[](1);
        top[0] = 1_000e6;
        vm.expectRevert(PactEscrow.AmountsMismatch.selector);
        vm.prank(client);
        escrow.topUp(id, 0, top);
    }

    function test_m2_submitUnfunded_revertsMilestoneUnfunded() public {
        _wireTier2Client();
        bytes32 id = _activeEngagement(2_000e6, 2);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1_000e6;
        amounts[1] = 0;
        _fund(id, amounts, _defaultTerms(2));

        vm.prank(provider);
        vm.expectRevert(PactEscrow.MilestoneUnfunded.selector);
        escrow.submitCompletion(id, 1, bytes32(0));
    }

    function _m2_defaultSetup() internal returns (bytes32 id) {
        _wireTier2Client();
        id = _activeEngagement(2_000e6, 2);
        PactEscrow.MilestoneTerms[] memory terms = _defaultTerms(2);
        terms[1].deadline = block.timestamp + 1 days;
        terms[1].graceSeconds = 1 hours;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1_000e6;
        amounts[1] = 0;
        _fund(id, amounts, terms);
    }

    function test_m2_recordDefault_afterDeadline_ok() public {
        bytes32 id = _m2_defaultSetup();
        vm.warp(block.timestamp + 1 days + 1 hours + 1);
        vm.expectEmit(true, false, false, true);
        emit PactEscrow.DefaultRecorded(id);
        escrow.recordDefault(id);
        assertTrue(escrow.getEscrowInfo(id).defaulted);
    }

    function test_m2_recordDefault_beforeDeadline_revertsWindowNotClosed() public {
        bytes32 id = _m2_defaultSetup();
        vm.expectRevert(PactEscrow.WindowNotClosed.selector);
        escrow.recordDefault(id);
    }

    function test_m2_recordDefault_doubleDefault_reverts() public {
        bytes32 id = _m2_defaultSetup();
        vm.warp(block.timestamp + 1 days + 1 hours + 1);
        escrow.recordDefault(id);
        vm.expectRevert(PactEscrow.AlreadyDefaulted.selector);
        escrow.recordDefault(id);
    }

    function test_m2_defaultedEngagement_completesWithFundedTotalAndOnTime() public {
        bytes32 id = _m2_defaultSetup();
        vm.warp(block.timestamp + 1 days + 1 hours + 1);
        escrow.recordDefault(id);

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        vm.expectEmit(true, true, true, true);
        emit PactEscrow.PactCompleted(id, client, "client.pact.eth", provider, "provider.pact.eth", 2, 1_000e6, true, false);

        vm.prank(client);
        escrow.releaseMilestone(id, 0);

        assertEq(uint8(registry.getEngagement(id).status), uint8(PactRegistry.EngagementStatus.COMPLETED));
    }

    // ── M5 N-splits ─────────────────────────────────────────────────────────

    function test_m5_releaseSplit_threeWayExact() public {
        bytes32 id = _activeEngagement(1_000_000, 6);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000_000;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        address r1 = address(0xA1);
        address r2 = address(0xA2);
        address r3 = address(0xA3);
        address[] memory recipients = new address[](3);
        recipients[0] = r1;
        recipients[1] = r2;
        recipients[2] = r3;
        uint16[] memory bps = new uint16[](3);
        bps[0] = 5000;
        bps[1] = 3000;
        bps[2] = 2000;

        vm.expectEmit(true, false, false, true);
        emit PactEscrow.SplitReleased(id, 1_000_000);
        vm.prank(client);
        escrow.releaseSplit(id, recipients, bps);

        assertEq(usdc.balanceOf(r1), 500_000);
        assertEq(usdc.balanceOf(r2), 300_000);
        assertEq(usdc.balanceOf(r3), 200_000);
    }

    function test_m5_releaseSplit_dustToLastOddTotal() public {
        bytes32 id = _activeEngagement(1_000_001, 6);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000_001;
        _fund(id, amounts, _defaultTerms(1));

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        address r1 = address(0xB1);
        address r2 = address(0xB2);
        address r3 = address(0xB3);
        address[] memory recipients = new address[](3);
        recipients[0] = r1;
        recipients[1] = r2;
        recipients[2] = r3;
        uint16[] memory bps = new uint16[](3);
        bps[0] = 3300;
        bps[1] = 3300;
        bps[2] = 3400;

        vm.prank(client);
        escrow.releaseSplit(id, recipients, bps);

        uint256 b1 = usdc.balanceOf(r1);
        uint256 b2 = usdc.balanceOf(r2);
        uint256 b3 = usdc.balanceOf(r3);
        assertEq(b1 + b2 + b3, uint256(1_000_001));
        assertEq(b1, (uint256(1_000_001) * 3300) / 10_000);
        assertEq(b2, (uint256(1_000_001) * 3300) / 10_000);
        assertEq(b3, uint256(1_000_001) - b1 - b2); // dust to last
    }

    function test_m5_releaseSplit_revertsOnLengthMismatch() public {
        bytes32 id = _activeEngagement(1_000e6, 6);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));
        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        address[] memory recipients = new address[](2);
        recipients[0] = address(0xA);
        recipients[1] = address(0xB);
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10000;

        vm.prank(client);
        vm.expectRevert(PactEscrow.BadShare.selector);
        escrow.releaseSplit(id, recipients, bps);
    }

    function test_m5_releaseSplit_revertsOnBadTotalBps() public {
        bytes32 id = _activeEngagement(1_000e6, 6);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));
        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        address[] memory recipients = new address[](2);
        recipients[0] = address(0xA);
        recipients[1] = address(0xB);
        uint16[] memory bps = new uint16[](2);
        bps[0] = 5000;
        bps[1] = 4999; // 9999 != 10000

        vm.prank(client);
        vm.expectRevert(PactEscrow.BadShare.selector);
        escrow.releaseSplit(id, recipients, bps);
    }

    function _deployFailEscrow(address failRecipient)
        internal
        returns (PactRegistry reg2, PactEscrow esc2, FailToToken ftok, bytes32 id)
    {
        ftok = new FailToToken();
        ftok.setFailRecipient(failRecipient);
        reg2 = new PactRegistry();
        esc2 = new PactEscrow(address(ftok), address(reg2));
        reg2.setEscrow(address(esc2));
        esc2.setWorldVerifier(worldVerifier);

        vm.prank(client);
        reg2.registerBusiness("client.pact.eth", keccak256("client-session"));
        vm.prank(provider);
        reg2.registerBusiness("provider.pact.eth", keccak256("provider-session"));

        ftok.mint(client, 1_000_000e6);
        ftok.mint(provider, 1_000_000e6);
        vm.prank(client);
        ftok.approve(address(esc2), type(uint256).max);
        vm.prank(provider);
        ftok.approve(address(esc2), type(uint256).max);

        vm.prank(client);
        id = reg2.createEngagement(provider, 6, 1_000_000, keccak256("terms"), "eng-1.pact.eth");
        vm.prank(client);
        reg2.signEngagement(id);
        vm.prank(provider);
        reg2.signEngagement(id);

        vm.prank(provider);
        esc2.postBond(id);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000_000;
        PactEscrow.MilestoneTerms[] memory terms = new PactEscrow.MilestoneTerms[](1);
        terms[0] = PactEscrow.MilestoneTerms({
            deadline: 0,
            graceSeconds: 1 hours,
            evidenceRequired: false,
            acceptanceWindowSeconds: 2 days,
            defaultProviderBps: 5000,
            challengeWindowSeconds: 7 days,
            visibility: 0
        });
        vm.prank(client);
        esc2.fundEngagement(id, amounts, terms);
        vm.prank(provider);
        esc2.submitCompletion(id, 0, bytes32(0));
    }

    function test_m5_failingRecipient_creditedPending() public {
        address bad = address(0xBAD);
        (, PactEscrow e2, FailToToken ft2, bytes32 id2) = _deployFailEscrow(bad);

        address[] memory recipients = new address[](3);
        recipients[0] = address(0xA1);
        recipients[1] = bad;
        recipients[2] = address(0xA3);
        uint16[] memory bps = new uint16[](3);
        bps[0] = 3300;
        bps[1] = 3300;
        bps[2] = 3400;

        vm.prank(client);
        e2.releaseSplit(id2, recipients, bps);

        assertEq(e2.pendingShares(id2, bad), uint256(330_000));
        assertEq(ft2.balanceOf(address(0xA1)), uint256(330_000));
        assertEq(ft2.balanceOf(bad), uint256(0));
    }

    function test_m5_claimShare_paysThenDoubleClaimReverts() public {
        address bad = address(0xBAD2);
        (, PactEscrow e2, FailToToken ft2, bytes32 id2) = _deployFailEscrow(bad);

        address[] memory recipients = new address[](2);
        recipients[0] = address(0xA1);
        recipients[1] = bad;
        uint16[] memory bps = new uint16[](2);
        bps[0] = 5000;
        bps[1] = 5000;
        vm.prank(client);
        e2.releaseSplit(id2, recipients, bps);
        uint256 owed = e2.pendingShares(id2, bad);
        assertEq(owed, 500_000);

        // unblock the recipient so the pull payment can land
        ft2.setFailRecipient(address(0xDEAD));
        vm.expectEmit(true, true, false, true);
        emit PactEscrow.ShareClaimed(id2, bad, owed);
        vm.prank(bad);
        e2.claimShare(id2);
        assertEq(ft2.balanceOf(bad), owed);
        assertEq(e2.pendingShares(id2, bad), 0);

        vm.prank(bad);
        vm.expectRevert(PactEscrow.NothingToClaim.selector);
        e2.claimShare(id2);
    }

    function test_m5_claimShare_emptyRevertsNothingToClaim() public {
        bytes32 id = _activeEngagement(1_000e6, 6);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));
        vm.prank(address(0x123456));
        vm.expectRevert(PactEscrow.NothingToClaim.selector);
        escrow.claimShare(id);
    }

    // ── M6 attestations + visibility ────────────────────────────────────────

    function test_m6_attestCompletion_storesAndEmits() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1));

        address attestor = address(0xA77E57);
        bytes32 evidence = keccak256("audit-report");
        vm.expectEmit(true, true, false, true);
        emit PactEscrow.CompletionAttested(id, 0, attestor, evidence, true);
        vm.prank(attestor);
        escrow.attestCompletion(id, 0, evidence, true);

        PactEscrow.Attestation[] memory records = escrow.getAttestations(id, 0);
        assertEq(records.length, 1);
        assertEq(records[0].attestor, attestor);
        assertEq(records[0].evidenceHash, evidence);
        assertTrue(records[0].verdict);
    }

    function test_m6_commitVisibility_emitsHexSubnames() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        PactEscrow.MilestoneTerms[] memory terms = _defaultTerms(1);
        terms[0].visibility = 1; // commit
        _fund(id, amounts, terms);

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        string memory hexA = Strings.toHexString(uint256(keccak256(bytes("client.pact.eth"))), 32);
        string memory hexB = Strings.toHexString(uint256(keccak256(bytes("provider.pact.eth"))), 32);
        assertEq(bytes(hexA).length, 66);
        assertEq(bytes(hexB).length, 66);

        vm.expectEmit(true, true, true, true);
        emit PactEscrow.PactCompleted(id, client, hexA, provider, hexB, 1, 1_000e6, true, false);

        vm.prank(client);
        escrow.releaseMilestone(id, 0);
    }

    function test_m6_publicVisibility_unchangedPlaintext() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        _fund(id, amounts, _defaultTerms(1)); // visibility 0

        vm.prank(provider);
        escrow.submitCompletion(id, 0, bytes32(0));

        vm.expectEmit(true, true, true, true);
        emit PactEscrow.PactCompleted(id, client, "client.pact.eth", provider, "provider.pact.eth", 1, 1_000e6, true, false);

        vm.prank(client);
        escrow.releaseMilestone(id, 0);
    }
}

contract PactScoreTest is Test {
    PactScore score;
    address nonAttestor = address(0xBAD);

    function setUp() public {
        score = new PactScore();
    }

    function test_score_bands() public {
        // unattested defaults to tier 0
        assertEq(uint256(score.getTier("ghost.pact.eth")), 0);

        score.attestScore("s.pact.eth", 199, 1);
        assertEq(uint256(score.getTier("s.pact.eth")), 0);
        score.attestScore("s.pact.eth", 200, 1);
        assertEq(uint256(score.getTier("s.pact.eth")), 1);
        score.attestScore("s.pact.eth", 549, 1);
        assertEq(uint256(score.getTier("s.pact.eth")), 1);
        score.attestScore("s.pact.eth", 550, 1);
        assertEq(uint256(score.getTier("s.pact.eth")), 2);
        score.attestScore("s.pact.eth", 799, 1);
        assertEq(uint256(score.getTier("s.pact.eth")), 2);
        score.attestScore("s.pact.eth", 800, 1);
        assertEq(uint256(score.getTier("s.pact.eth")), 3);
        score.attestScore("s.pact.eth", 1000, 1);
        assertEq(uint256(score.getTier("s.pact.eth")), 3);
    }

    function test_score_nonAttestor_reverts() public {
        vm.prank(nonAttestor);
        vm.expectRevert(PactScore.NotAttestor.selector);
        score.attestScore("x.pact.eth", 500, 1);
    }

    function test_score_emptySubname_reverts() public {
        vm.expectRevert(PactScore.EmptySubname.selector);
        score.attestScore("", 500, 1);
    }

    function test_score_unknownSubname_tierZero() public {
        assertEq(uint256(score.getTier("never-attested.pact.eth")), 0);
        (uint16 s, uint8 v, uint64 attWhen) = score.getScore("never-attested.pact.eth");
        assertEq(uint256(s), 0);
        assertEq(uint256(v), 0);
        assertEq(uint256(attWhen), 0);
    }

    function test_score_attestEmitsAndTierChanged() public {
        vm.expectEmit(false, false, false, true);
        emit PactScore.ScoreAttested("a.pact.eth", 100, 1);
        score.attestScore("a.pact.eth", 100, 1); // tier stays 0 → no TierChanged
        assertEq(uint256(score.getTier("a.pact.eth")), 0);

        vm.expectEmit(false, false, false, true);
        emit PactScore.ScoreAttested("a.pact.eth", 600, 2);
        vm.expectEmit(false, false, false, true);
        emit PactScore.TierChanged("a.pact.eth", 0, 2);
        score.attestScore("a.pact.eth", 600, 2);

        (uint16 s, uint8 v, uint64 attWhen) = score.getScore("a.pact.eth");
        assertEq(uint256(s), 600);
        assertEq(uint256(v), 2);
        assertTrue(attWhen != 0);
    }

    function test_score_adminTransferAndSetAttestor() public {
        address newAdmin = address(0xAD);
        address newAttestor = address(0xA7);
        score.transferAdmin(newAdmin);
        assertEq(score.admin(), newAdmin);

        // old admin can no longer set attestor
        vm.expectRevert(PactScore.OnlyAdmin.selector);
        score.setAttestor(newAttestor);

        vm.prank(newAdmin);
        score.setAttestor(newAttestor);
        assertEq(score.attestor(), newAttestor);

        vm.prank(newAttestor);
        score.attestScore("z.pact.eth", 850, 1);
        assertEq(uint256(score.getTier("z.pact.eth")), 3);
    }
}
