// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PactRegistry} from "../src/PactRegistry.sol";

contract PactRegistryTest is Test {
    PactRegistry registry;

    address studio = address(0xA11CE);
    address agency = address(0xB0B);
    address stranger = address(0xC0FFEE);

    function setUp() public {
        registry = new PactRegistry();
    }

    function _registerBoth() internal {
        vm.prank(studio);
        registry.registerBusiness("studio.pact.eth", keccak256("studio-world-session"));

        vm.prank(agency);
        registry.registerBusiness("agency.pact.eth", keccak256("agency-world-session"));
    }

    function test_registerBusiness_setsActiveAndEmits() public {
        vm.expectEmit(true, false, false, true);
        emit PactRegistry.BusinessRegistered(studio, "studio.pact.eth", keccak256("s"));

        vm.prank(studio);
        registry.registerBusiness("studio.pact.eth", keccak256("s"));

        assertTrue(registry.isBusinessActive(studio));
        PactRegistry.Business memory b = registry.getBusiness(studio);
        assertEq(b.ensSubname, "studio.pact.eth");
        assertTrue(b.active);
    }

    function test_registerBusiness_revertsIfAlreadyRegistered() public {
        vm.prank(studio);
        registry.registerBusiness("studio.pact.eth", keccak256("s"));

        vm.prank(studio);
        vm.expectRevert(PactRegistry.AlreadyRegistered.selector);
        registry.registerBusiness("studio-2.pact.eth", keccak256("s2"));
    }

    function test_createEngagement_revertsIfPartyNotRegistered() public {
        vm.prank(studio);
        vm.expectRevert(PactRegistry.NotRegistered.selector);
        registry.createEngagement(agency, 1, 1000e6, keccak256("terms"), "eng-1.pact.eth");
    }

    function test_createEngagement_revertsIfCounterpartyNotRegistered() public {
        vm.prank(studio);
        registry.registerBusiness("studio.pact.eth", keccak256("s"));

        vm.prank(studio);
        vm.expectRevert(PactRegistry.CounterpartyNotRegistered.selector);
        registry.createEngagement(agency, 1, 1000e6, keccak256("terms"), "eng-1.pact.eth");
    }

    function test_fullSigningFlow_activatesEngagement() public {
        _registerBoth();

        vm.prank(studio);
        bytes32 id = registry.createEngagement(agency, 2, 7_500e6, keccak256("terms"), "eng-a3f9.pact.eth");

        PactRegistry.Engagement memory e = registry.getEngagement(id);
        assertEq(uint8(e.status), uint8(PactRegistry.EngagementStatus.PROPOSED));

        vm.prank(studio);
        registry.signEngagement(id);
        e = registry.getEngagement(id);
        assertEq(uint8(e.status), uint8(PactRegistry.EngagementStatus.PROPOSED)); // one sig isn't enough

        vm.prank(agency);
        registry.signEngagement(id);
        e = registry.getEngagement(id);
        assertEq(uint8(e.status), uint8(PactRegistry.EngagementStatus.ACTIVE));
    }

    function test_signEngagement_revertsForNonParty() public {
        _registerBoth();

        vm.prank(studio);
        bytes32 id = registry.createEngagement(agency, 1, 1_000e6, keccak256("t"), "eng-1.pact.eth");

        vm.prank(stranger);
        vm.expectRevert(PactRegistry.NotParty.selector);
        registry.signEngagement(id);
    }

    function test_signEngagement_revertsOnDoubleSign() public {
        _registerBoth();

        vm.prank(studio);
        bytes32 id = registry.createEngagement(agency, 1, 1_000e6, keccak256("t"), "eng-1.pact.eth");

        vm.prank(studio);
        registry.signEngagement(id);

        vm.prank(studio);
        vm.expectRevert(PactRegistry.AlreadySigned.selector);
        registry.signEngagement(id);
    }

    function test_cancelEngagement_beforeBothSign() public {
        _registerBoth();

        vm.prank(studio);
        bytes32 id = registry.createEngagement(agency, 1, 1_000e6, keccak256("t"), "eng-1.pact.eth");

        vm.prank(agency);
        registry.cancelEngagement(id);

        PactRegistry.Engagement memory e = registry.getEngagement(id);
        assertEq(uint8(e.status), uint8(PactRegistry.EngagementStatus.CANCELLED));
    }

    function test_setEscrow_onlyOnceAndOnlyAdmin() public {
        vm.prank(stranger);
        vm.expectRevert(PactRegistry.OnlyAdmin.selector);
        registry.setEscrow(address(0xE5C40));

        registry.setEscrow(address(0xE5C40)); // called by test contract == admin
        assertEq(registry.escrow(), address(0xE5C40));

        vm.expectRevert(PactRegistry.EscrowAlreadySet.selector);
        registry.setEscrow(address(0xDEAD));
    }

    function test_setEngagementStatus_onlyCallableByEscrow() public {
        registry.setEscrow(address(0xE5C40));
        _registerBoth();

        vm.prank(studio);
        bytes32 id = registry.createEngagement(agency, 1, 1_000e6, keccak256("t"), "eng-1.pact.eth");

        vm.expectRevert(PactRegistry.OnlyEscrow.selector);
        registry.setEngagementStatus(id, PactRegistry.EngagementStatus.COMPLETED);

        vm.prank(address(0xE5C40));
        registry.setEngagementStatus(id, PactRegistry.EngagementStatus.COMPLETED);

        PactRegistry.Engagement memory e = registry.getEngagement(id);
        assertEq(uint8(e.status), uint8(PactRegistry.EngagementStatus.COMPLETED));
    }
}
