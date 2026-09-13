// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PactRegistry} from "../src/PactRegistry.sol";
import {PactEscrow} from "../src/PactEscrow.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// @notice Deploys PactRegistry + PactEscrow to Sepolia and wires them together.
/// Set USDC_SEPOLIA_ADDRESS in .env to a real testnet USDC to skip MockUSDC deployment;
/// otherwise this deploys MockUSDC automatically.
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy --rpc-url $SEPOLIA_RPC_URL \
///     --private-key $DEPLOYER_PRIVATE_KEY --broadcast --verify
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address worldVerifier = vm.envOr("WORLD_VERIFIER_ADDRESS", vm.addr(deployerKey));
        address existingUsdc = vm.envOr("USDC_SEPOLIA_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);

        address usdcAddress = existingUsdc;
        if (usdcAddress == address(0)) {
            MockUSDC mock = new MockUSDC();
            usdcAddress = address(mock);
            console.log("Deployed MockUSDC at:", usdcAddress);
        } else {
            console.log("Using existing USDC at:", usdcAddress);
        }

        PactRegistry registry = new PactRegistry();
        console.log("Deployed PactRegistry at:", address(registry));

        PactEscrow escrow = new PactEscrow(usdcAddress, address(registry));
        console.log("Deployed PactEscrow at:", address(escrow));

        registry.setEscrow(address(escrow));
        escrow.setWorldVerifier(worldVerifier);
        console.log("Wired registry.escrow and escrow.worldVerifier to:", worldVerifier);

        vm.stopBroadcast();

        console.log("\n--- Paste into .env ---");
        console.log("USDC_SEPOLIA_ADDRESS=", usdcAddress);
        console.log("PACT_REGISTRY_ADDRESS=", address(registry));
        console.log("PACT_ESCROW_ADDRESS=", address(escrow));
    }
}
