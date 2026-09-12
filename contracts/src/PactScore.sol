// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PactScore
/// @notice M2 on-chain score tiers. An off-chain attestor job computes scores
/// from PactCompleted + BondSlashed events and commits them here. Escrow reads
/// only the tier at funding time.
contract PactScore {
    struct Score {
        uint16 score;
        uint8 version;
        uint64 attestedAt;
    }

    uint16[3] public TIER_CUTOFFS = [uint16(200), uint16(550), uint16(800)];

    mapping(string => Score) public scores;

    address public admin;
    address public attestor;

    event ScoreAttested(string subname, uint16 score, uint8 version);
    event TierChanged(string subname, uint8 oldTier, uint8 newTier);

    error NotAttestor();
    error EmptySubname();
    error OnlyAdmin();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    constructor() {
        admin = msg.sender;
        attestor = msg.sender;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
    }

    function setAttestor(address newAttestor) external onlyAdmin {
        if (newAttestor == address(0)) revert ZeroAddress();
        attestor = newAttestor;
    }

    function attestScore(string calldata subname, uint16 score, uint8 version) external {
        if (msg.sender != attestor) revert NotAttestor();
        if (bytes(subname).length == 0) revert EmptySubname();

        uint8 oldTier = getTier(subname);
        scores[subname] = Score({score: score, version: version, attestedAt: uint64(block.timestamp)});
        uint8 newTier = getTier(subname);

        emit ScoreAttested(subname, score, version);
        if (newTier != oldTier) {
            emit TierChanged(subname, oldTier, newTier);
        }
    }

    function getTier(string calldata subname) public view returns (uint8) {
        Score memory s = scores[subname];
        if (s.attestedAt == 0) return 0;
        return _tierFor(s.score);
    }

    function getScore(string calldata subname) external view returns (uint16 score, uint8 version, uint64 attestedAt) {
        Score memory s = scores[subname];
        return (s.score, s.version, s.attestedAt);
    }

    function _tierFor(uint16 score) internal view returns (uint8) {
        if (score >= TIER_CUTOFFS[2]) return 3;
        if (score >= TIER_CUTOFFS[1]) return 2;
        if (score >= TIER_CUTOFFS[0]) return 1;
        return 0;
    }
}
