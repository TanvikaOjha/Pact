// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PactRegistry} from "../src/PactRegistry.sol";
import {PactEscrow} from "../src/PactEscrow.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

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
        amounts[0] = 1_999e6; // off by one dollar

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
}
