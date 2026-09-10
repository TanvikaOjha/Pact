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
    }

    function _activeEngagement(uint256 totalAmount, uint8 templateType) internal returns (bytes32 id) {
        vm.prank(client);
        id = registry.createEngagement(provider, templateType, totalAmount, keccak256("terms"), "eng-1.pact.eth");

        vm.prank(client);
        registry.signEngagement(id);
        vm.prank(provider);
        registry.signEngagement(id);
    }

    // ── Funding ─────────────────────────────────────────────────────────────

    function test_fundEngagement_movesUsdcAndStoresMilestones() public {
        bytes32 id = _activeEngagement(2_000e6, 1);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2_000e6;

        vm.prank(client);
        escrow.fundEngagement(id, amounts, 2 days);

        assertEq(usdc.balanceOf(address(escrow)), 2_000e6);
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

        vm.prank(client);
        vm.expectRevert(PactEscrow.AmountsMismatch.selector);
        escrow.fundEngagement(id, amounts, 2 days);
    }

    // ── Direct release (FilePizza mechanic: no backend in the call path) ──────

    function test_releaseMilestone_directClientCall_movesFundsAndEmitsCompleted() public {
        bytes32 id = _activeEngagement(2_000e6, 1);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2_000e6;
        vm.prank(client);
        escrow.fundEngagement(id, amounts, 2 days);

        vm.prank(provider);
        escrow.submitCompletion(id, 0);

        // This call comes straight from the client's wallet — no Pact backend involved.
        vm.expectEmit(true, true, true, true);
        emit PactEscrow.PactCompleted(id, client, "client.pact.eth", provider, "provider.pact.eth", 1, 2_000e6, true, false);

        vm.prank(client);
        escrow.releaseMilestone(id, 0);

        assertEq(usdc.balanceOf(provider), 2_000e6);
        assertEq(uint8(registry.getEngagement(id).status), uint8(PactRegistry.EngagementStatus.COMPLETED));
    }

    function test_releaseMilestone_revertsIfNotSubmitted() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        vm.prank(client);
        escrow.fundEngagement(id, amounts, 1 days);

        vm.prank(client);
        vm.expectRevert(PactEscrow.MilestoneNotSubmitted.selector);
        escrow.releaseMilestone(id, 0);
    }

    function test_multiMilestone_onlyFinalReleaseEmitsCompleted() public {
        bytes32 id = _activeEngagement(5_000e6, 2);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 2_000e6;
        amounts[1] = 3_000e6;
        vm.prank(client);
        escrow.fundEngagement(id, amounts, 1 days);

        vm.prank(provider);
        escrow.submitCompletion(id, 0);
        vm.prank(client);
        escrow.releaseMilestone(id, 0); // first milestone — should NOT emit PactCompleted

        assertEq(usdc.balanceOf(provider), 2_000e6);
        assertEq(uint8(registry.getEngagement(id).status), uint8(PactRegistry.EngagementStatus.ACTIVE));

        vm.prank(provider);
        escrow.submitCompletion(id, 1);
        vm.prank(client);
        escrow.releaseMilestone(id, 1); // second milestone — completes the engagement

        assertEq(usdc.balanceOf(provider), 5_000e6);
        assertEq(uint8(registry.getEngagement(id).status), uint8(PactRegistry.EngagementStatus.COMPLETED));
    }

    // ── Auto-release ────────────────────────────────────────────────────────

    function test_autoRelease_firesAfterWindowWithNoManualAccept() public {
        bytes32 id = _activeEngagement(1_500e6, 3); // retainer-style
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_500e6;
        vm.prank(client);
        escrow.fundEngagement(id, amounts, 2 days);

        vm.prank(provider);
        escrow.submitCompletion(id, 0);

        vm.expectRevert(PactEscrow.WindowNotClosed.selector);
        vm.prank(keeper);
        escrow.autoRelease(id, 0);

        vm.warp(block.timestamp + 2 days + 1);

        vm.prank(keeper); // arbitrary caller — simulates a Privy session signer / cron keeper
        escrow.autoRelease(id, 0);

        assertEq(usdc.balanceOf(provider), 1_500e6);
    }

    // ── World Selfie Check gating for high-value milestones ────────────────

    function test_highValueMilestone_requiresWorldAttestation() public {
        bytes32 id = _activeEngagement(10_000e6, 2); // above the $5,000 default threshold
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10_000e6;
        vm.prank(client);
        escrow.fundEngagement(id, amounts, 2 days);

        vm.prank(provider);
        escrow.submitCompletion(id, 0);

        vm.prank(client);
        vm.expectRevert(PactEscrow.WorldVerificationRequired.selector);
        escrow.releaseMilestone(id, 0);

        vm.prank(worldVerifier);
        escrow.attestWorldVerification(id, 0);

        vm.prank(client);
        escrow.releaseMilestone(id, 0); // now succeeds

        assertEq(usdc.balanceOf(provider), 10_000e6);
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
        vm.prank(client);
        escrow.fundEngagement(id, amounts, 1 days);

        vm.prank(provider); // provider field is unused for split but submitCompletion still gated on it
        escrow.submitCompletion(id, 0);

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
        vm.prank(client);
        escrow.fundEngagement(id, amounts, 1 days);
        vm.prank(provider);
        escrow.submitCompletion(id, 0);

        vm.prank(client);
        vm.expectRevert(PactEscrow.BadShare.selector);
        escrow.splitRelease(id, address(0xA), 10_001, address(0xB));
    }

    // ── Disputes ─────────────────────────────────────────────────────────────

    function test_dispute_requiresBothPartiesToCosignIdenticalResolution() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        vm.prank(client);
        escrow.fundEngagement(id, amounts, 2 days);

        vm.prank(provider);
        escrow.submitCompletion(id, 0);

        vm.prank(client);
        escrow.raiseDispute(id, 0);

        // Mismatched proposals must NOT resolve.
        vm.prank(client);
        escrow.resolveDispute(id, 0, 400e6, 600e6);
        vm.prank(provider);
        escrow.resolveDispute(id, 0, 500e6, 500e6);

        assertEq(usdc.balanceOf(provider), 0); // still unresolved

        // Matching proposal resolves and pays out.
        vm.prank(provider);
        escrow.resolveDispute(id, 0, 400e6, 600e6);

        assertEq(usdc.balanceOf(provider), 400e6);
        assertEq(usdc.balanceOf(client), 1_000_000e6 - 1_000e6 + 600e6); // minted balance minus funded plus refund
    }

    function test_dispute_setsDisputedFlagOnFinalReputationEvent() public {
        bytes32 id = _activeEngagement(1_000e6, 1);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1_000e6;
        vm.prank(client);
        escrow.fundEngagement(id, amounts, 2 days);

        vm.prank(provider);
        escrow.submitCompletion(id, 0);

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
        vm.prank(client);
        escrow.fundEngagement(id, amounts, 1 days);
        vm.prank(provider);
        escrow.submitCompletion(id, 0);
        vm.prank(client);
        escrow.releaseMilestone(id, 0);

        vm.prank(client);
        vm.expectRevert(PactEscrow.MilestoneAlreadyReleased.selector);
        escrow.raiseDispute(id, 0);
    }
}
