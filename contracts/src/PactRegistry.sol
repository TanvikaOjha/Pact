// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PactRegistry
/// @notice Registers verified business identities and creates/signs mutual engagements.
/// Business identity itself (the ENS subname + EAC fuses that make it unrevokable) lives
/// in ENSv2, not here — this contract stores the World-verification pointer and the
/// engagement lifecycle, and is the source of truth PactEscrow checks before it moves funds.
contract PactRegistry {
    // Types

    enum EngagementStatus { NONE, PROPOSED, ACTIVE, COMPLETED, DISPUTED, CANCELLED }

    struct Business {
        address wallet;
        string ensSubname;       // e.g. "studio.pact.eth"
        bytes32 worldSessionId;  // World Selfie Check session id, set at registration
        bool active;
    }

    struct Engagement {
        bytes32 id;
        address partyA;          // proposer
        address partyB;          // counterparty
        string ensSubname;       // e.g. "eng-a3f9.pact.eth"
        uint8 templateType;      // 1-6 (7/custom is mapped to nearest before this call)
        uint256 totalAmount;     // USDC, 6 decimals
        bytes32 termsHash;       // keccak256 of the canonical terms JSON written to ENS
        EngagementStatus status;
    }

    // Storage

    mapping(address => Business) public businesses;
    mapping(bytes32 => Engagement) public engagements;
    mapping(bytes32 => mapping(address => bool)) public hasSigned;
    mapping(bytes32 => uint8) private _signCount;

    address public admin;
    address public escrow; // PactEscrow contract, wired once post-deploy

    // Events

    event BusinessRegistered(address indexed wallet, string subname, bytes32 worldSessionId);
    event EngagementCreated(bytes32 indexed id, address indexed partyA, address indexed partyB, uint8 templateType);
    event EngagementSigned(bytes32 indexed id, address indexed signer);
    event EngagementActive(bytes32 indexed id);
    event EngagementCancelled(bytes32 indexed id);
    event EscrowSet(address escrow);

    // Errors

    error AlreadyRegistered();
    error NotRegistered();
    error CounterpartyNotRegistered();
    error NotParty();
    error AlreadySigned();
    error EngagementNotFound();
    error EngagementNotProposed();
    error InvalidTemplateType();
    error EscrowAlreadySet();
    error OnlyAdmin();
    error OnlyEscrow();
    error ZeroAddress();

    // Modifiers

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    // Admin

    /// @notice One-time wiring to the deployed PactEscrow contract, so it can push
    /// status updates (COMPLETED / DISPUTED) back into the registry.
    function setEscrow(address _escrow) external onlyAdmin {
        if (_escrow == address(0)) revert ZeroAddress();
        if (escrow != address(0)) revert EscrowAlreadySet();
        escrow = _escrow;
        emit EscrowSet(_escrow);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
    }

    // Business identity

    /// @notice Registers a business identity. The World Selfie Check proof is verified
    /// off-chain by the Pact backend *before* this call is made; only the resulting
    /// session id is stored on-chain. The ENS subname (with EAC fuses burned so Pact's
    /// admin cannot revoke it) is minted by the backend in the same flow — this call
    /// records that mapping so PactEscrow and reputation lookups can trust it.
    function registerBusiness(
        string calldata ensSubname,
        bytes32 worldSessionId
    ) external returns (bool) {
        if (businesses[msg.sender].active) revert AlreadyRegistered();

        businesses[msg.sender] = Business({
            wallet: msg.sender,
            ensSubname: ensSubname,
            worldSessionId: worldSessionId,
            active: true
        });

        emit BusinessRegistered(msg.sender, ensSubname, worldSessionId);
        return true;
    }

    function isBusinessActive(address wallet) public view returns (bool) {
        return businesses[wallet].active;
    }

    function getBusiness(address wallet) external view returns (Business memory) {
        return businesses[wallet];
    }

    // Engagement lifecycle

    /// @notice Proposer creates an engagement. No funds move here — escrow funding
    /// happens in PactEscrow once both parties have signed (status == ACTIVE).
    function createEngagement(
        address counterparty,
        uint8 templateType,
        uint256 totalAmount,
        bytes32 termsHash,
        string calldata engagementSubname
    ) external returns (bytes32 engagementId) {
        if (!businesses[msg.sender].active) revert NotRegistered();
        if (!businesses[counterparty].active) revert CounterpartyNotRegistered();
        if (templateType == 0 || templateType > 6) revert InvalidTemplateType();

        engagementId = keccak256(
            abi.encode(msg.sender, counterparty, termsHash, block.timestamp, block.number)
        );

        engagements[engagementId] = Engagement({
            id: engagementId,
            partyA: msg.sender,
            partyB: counterparty,
            ensSubname: engagementSubname,
            templateType: templateType,
            totalAmount: totalAmount,
            termsHash: termsHash,
            status: EngagementStatus.PROPOSED
        });

        emit EngagementCreated(engagementId, msg.sender, counterparty, templateType);
    }

    /// @notice Either party signs. When both have signed, the engagement flips to
    /// ACTIVE. The frontend is expected to immediately call PactEscrow.fundEngagement
    /// once ACTIVE fires.
    function signEngagement(bytes32 engagementId) external {
        Engagement storage e = engagements[engagementId];
        if (e.id == bytes32(0)) revert EngagementNotFound();
        if (e.status != EngagementStatus.PROPOSED) revert EngagementNotProposed();
        if (msg.sender != e.partyA && msg.sender != e.partyB) revert NotParty();
        if (hasSigned[engagementId][msg.sender]) revert AlreadySigned();

        hasSigned[engagementId][msg.sender] = true;
        _signCount[engagementId] += 1;
        emit EngagementSigned(engagementId, msg.sender);

        if (_signCount[engagementId] == 2) {
            e.status = EngagementStatus.ACTIVE;
            emit EngagementActive(engagementId);
        }
    }

    /// @notice Either party can cancel while still PROPOSED (before both signatures).
    function cancelEngagement(bytes32 engagementId) external {
        Engagement storage e = engagements[engagementId];
        if (e.id == bytes32(0)) revert EngagementNotFound();
        if (e.status != EngagementStatus.PROPOSED) revert EngagementNotProposed();
        if (msg.sender != e.partyA && msg.sender != e.partyB) revert NotParty();

        e.status = EngagementStatus.CANCELLED;
        emit EngagementCancelled(engagementId);
    }

    function getEngagement(bytes32 id) external view returns (Engagement memory) {
        return engagements[id];
    }

    /// @notice Called only by PactEscrow, to push COMPLETED / DISPUTED status back
    /// into the registry as the on-chain lifecycle progresses.
    function setEngagementStatus(bytes32 id, EngagementStatus status) external {
        if (msg.sender != escrow) revert OnlyEscrow();
        Engagement storage e = engagements[id];
        if (e.id == bytes32(0)) revert EngagementNotFound();
        e.status = status;
    }
}
