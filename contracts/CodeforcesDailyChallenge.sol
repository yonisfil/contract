// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract CodeforcesDailyChallenge is Ownable, Pausable, ReentrancyGuard {
    enum PeriodStatus {
        Unresolved,
        Completed,
        SlashedNoSubmission,
        SlashedNoOk
    }

    struct Challenge {
        address user;
        string handle;
        uint64 startAt;
        uint64 periodDuration;
        uint64 cycleDuration;
        uint32 totalPeriods;
        uint32 minRating;
        uint256 penaltyNoSubmission;
        uint256 penaltyNoOk;
        uint256 deposit;
        uint256 slashedAmount;
        uint32 resolvedPeriods;
        bool withdrawn;
        bool canceled;
        bool active;
    }

    struct PeriodRecord {
        PeriodStatus status;
        uint256 resolvedAt;
        uint256 penaltyApplied;
        bool penaltySettled;
        uint256 submissionId;
        uint256 acceptedAt;
        uint256 rating;
        bytes32 proofHash;
    }

    address public oracle;
    address public treasury;
    address public penaltyRecipient;

    uint256 public nextChallengeId = 1;
    uint256 public treasuryBalance;
    mapping(address => uint256) public outstandingPenaltyOf;

    mapping(uint256 => Challenge) private challenges;
    mapping(uint256 => mapping(uint256 => PeriodRecord)) private periodRecords;
    mapping(address => uint256) public activeChallengeOf;

    event ChallengeCreated(
        uint256 indexed challengeId,
        address indexed user,
        string handle,
        uint64 startAt,
        uint64 periodDuration,
        uint64 cycleDuration,
        uint32 totalPeriods,
        uint32 minRating,
        uint256 penaltyNoSubmission,
        uint256 penaltyNoOk,
        uint256 deposit
    );

    event ChallengeCanceled(uint256 indexed challengeId, address indexed user, uint256 refundedAmount);
    event PeriodCompleted(
        uint256 indexed challengeId,
        uint256 indexed periodIndex,
        uint256 submissionId,
        uint256 acceptedAt,
        uint256 rating,
        bytes32 proofHash
    );
    event PeriodSlashed(
        uint256 indexed challengeId,
        uint256 indexed periodIndex,
        PeriodStatus status,
        uint256 penaltyApplied,
        bytes32 proofHash
    );
    event RemainingWithdrawn(uint256 indexed challengeId, address indexed user, uint256 amount);
    event TreasuryWithdrawn(address indexed treasury, uint256 amount);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event PenaltyRecipientUpdated(address indexed oldPenaltyRecipient, address indexed newPenaltyRecipient);
    event PenaltyPaid(uint256 indexed challengeId, uint256 indexed periodIndex, address indexed user, uint256 amount);

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle");
        _;
    }

    modifier onlyChallengeUser(uint256 challengeId) {
        require(challenges[challengeId].user == msg.sender, "Not challenge user");
        _;
    }

    modifier challengeExists(uint256 challengeId) {
        require(challenges[challengeId].user != address(0), "Challenge not found");
        _;
    }

    constructor(address initialOracle, address initialTreasury, address initialPenaltyRecipient)
        Ownable(msg.sender)
    {
        require(initialOracle != address(0), "Oracle address is zero");
        require(initialTreasury != address(0), "Treasury address is zero");
        require(initialPenaltyRecipient != address(0), "Penalty recipient is zero");

        oracle = initialOracle;
        treasury = initialTreasury;
        penaltyRecipient = initialPenaltyRecipient;
    }

    function createChallenge(
        string calldata handle,
        uint64 startAt,
        uint64 periodDuration,
        uint64 cycleDuration,
        uint32 totalPeriods,
        uint32 minRating,
        uint256 penaltyNoSubmission,
        uint256 penaltyNoOk
    ) external payable nonReentrant whenNotPaused returns (uint256 challengeId) {
        require(bytes(handle).length > 0, "Handle is empty");
        require(startAt > block.timestamp, "Start must be in the future");
        require(periodDuration > 0, "Period duration must be > 0");
        require(cycleDuration >= periodDuration, "Cycle duration must be >= period duration");
        require(totalPeriods > 0, "Total periods must be > 0");
        require(minRating > 0, "Min rating must be > 0");
        require(penaltyNoSubmission > 0, "PenaltyNoSubmission must be > 0");
        require(penaltyNoOk > 0, "PenaltyNoOk must be > 0");
        require(penaltyNoSubmission >= penaltyNoOk, "Miss penalty must be >= failed penalty");

        uint256 existingChallengeId = activeChallengeOf[msg.sender];
        if (existingChallengeId != 0) {
            require(!challenges[existingChallengeId].active, "User already has active challenge");
        }

        uint256 requiredDeposit = uint256(totalPeriods) * penaltyNoSubmission;
        require(requiredDeposit > 0, "Invalid deposit");
        require(msg.value == requiredDeposit, "Incorrect ETH deposit");

        challengeId = nextChallengeId++;
        challenges[challengeId] = Challenge({
            user: msg.sender,
            handle: handle,
            startAt: startAt,
            periodDuration: periodDuration,
            cycleDuration: cycleDuration,
            totalPeriods: totalPeriods,
            minRating: minRating,
            penaltyNoSubmission: penaltyNoSubmission,
            penaltyNoOk: penaltyNoOk,
            deposit: requiredDeposit,
            slashedAmount: 0,
            resolvedPeriods: 0,
            withdrawn: false,
            canceled: false,
            active: true
        });

        activeChallengeOf[msg.sender] = challengeId;

        emit ChallengeCreated(
            challengeId,
            msg.sender,
            handle,
            startAt,
            periodDuration,
            cycleDuration,
            totalPeriods,
            minRating,
            penaltyNoSubmission,
            penaltyNoOk,
            requiredDeposit
        );
    }

    function cancelBeforeStart(uint256 challengeId)
        external
        nonReentrant
        challengeExists(challengeId)
        onlyChallengeUser(challengeId)
    {
        Challenge storage c = challenges[challengeId];

        require(c.active, "Challenge is not active");
        require(!c.canceled, "Challenge already canceled");
        require(!c.withdrawn, "Challenge already withdrawn");
        require(block.timestamp < c.startAt, "Challenge already started");

        c.canceled = true;
        c.active = false;
        activeChallengeOf[c.user] = 0;

        _sendEth(c.user, c.deposit);

        emit ChallengeCanceled(challengeId, c.user, c.deposit);
    }

    function markPeriodCompleted(
        uint256 challengeId,
        uint256 periodIndex,
        uint256 submissionId,
        uint256 acceptedAt,
        uint256 rating,
        bytes32 proofHash
    ) external whenNotPaused onlyOracle challengeExists(challengeId) {
        Challenge storage c = challenges[challengeId];
        require(c.active, "Challenge is not active");
        require(!c.canceled, "Challenge canceled");
        require(!c.withdrawn, "Challenge withdrawn");
        require(periodIndex < c.totalPeriods, "Invalid period index");
        require(rating >= c.minRating, "Rating below minimum");
        require(submissionId > 0, "Submission id must be > 0");

        PeriodRecord storage record = periodRecords[challengeId][periodIndex];
        require(record.status == PeriodStatus.Unresolved, "Period already resolved");

        (uint256 periodStart, uint256 periodEnd) = getPeriodWindow(challengeId, periodIndex);
        require(block.timestamp >= periodEnd, "Period not ended yet");
        require(acceptedAt >= periodStart && acceptedAt < periodEnd, "acceptedAt outside period");

        record.status = PeriodStatus.Completed;
        record.resolvedAt = block.timestamp;
        record.penaltyApplied = 0;
        record.penaltySettled = true;
        record.submissionId = submissionId;
        record.acceptedAt = acceptedAt;
        record.rating = rating;
        record.proofHash = proofHash;

        c.resolvedPeriods += 1;

        emit PeriodCompleted(challengeId, periodIndex, submissionId, acceptedAt, rating, proofHash);
    }

    function slashPeriodNoSubmission(
        uint256 challengeId,
        uint256 periodIndex,
        bytes32 proofHash
    ) external nonReentrant whenNotPaused onlyOracle challengeExists(challengeId) {
        _slashPeriod(
            challengeId,
            periodIndex,
            PeriodStatus.SlashedNoSubmission,
            challenges[challengeId].penaltyNoSubmission,
            proofHash
        );
    }

    function slashPeriodNoOk(
        uint256 challengeId,
        uint256 periodIndex,
        bytes32 proofHash
    ) external nonReentrant whenNotPaused onlyOracle challengeExists(challengeId) {
        _slashPeriod(
            challengeId,
            periodIndex,
            PeriodStatus.SlashedNoOk,
            challenges[challengeId].penaltyNoOk,
            proofHash
        );
    }

    function _slashPeriod(
        uint256 challengeId,
        uint256 periodIndex,
        PeriodStatus status,
        uint256 penalty,
        bytes32 proofHash
    ) internal {
        Challenge storage c = challenges[challengeId];

        require(!c.canceled, "Challenge canceled");
        require(periodIndex < c.totalPeriods, "Invalid period index");

        PeriodRecord storage record = periodRecords[challengeId][periodIndex];
        require(record.status == PeriodStatus.Unresolved, "Period already resolved");

        (, uint256 periodEnd) = getPeriodWindow(challengeId, periodIndex);
        require(block.timestamp >= periodEnd, "Period not ended yet");

        record.status = status;
        record.resolvedAt = block.timestamp;
        record.penaltyApplied = penalty;
        record.penaltySettled = false;
        record.submissionId = 0;
        record.acceptedAt = 0;
        record.rating = 0;
        record.proofHash = proofHash;

        c.resolvedPeriods += 1;
        outstandingPenaltyOf[c.user] += penalty;

        emit PeriodSlashed(challengeId, periodIndex, status, penalty, proofHash);
    }

    function payPeriodPenalty(uint256 challengeId, uint256 periodIndex)
        external
        payable
        nonReentrant
        challengeExists(challengeId)
        onlyChallengeUser(challengeId)
    {
        Challenge storage c = challenges[challengeId];
        require(!c.canceled, "Challenge canceled");

        PeriodRecord storage record = periodRecords[challengeId][periodIndex];
        require(
            record.status == PeriodStatus.SlashedNoSubmission || record.status == PeriodStatus.SlashedNoOk,
            "Period is not slashed"
        );
        require(!record.penaltySettled, "Penalty already settled");
        require(record.penaltyApplied > 0, "Penalty is zero");
        require(msg.value == record.penaltyApplied, "Incorrect penalty payment");

        record.penaltySettled = true;
        c.slashedAmount += record.penaltyApplied;
        outstandingPenaltyOf[c.user] -= record.penaltyApplied;
        treasuryBalance += record.penaltyApplied;

        emit PenaltyPaid(challengeId, periodIndex, msg.sender, record.penaltyApplied);
    }

    function withdrawRemaining(uint256 challengeId)
        external
        nonReentrant
        challengeExists(challengeId)
        onlyChallengeUser(challengeId)
    {
        Challenge storage c = challenges[challengeId];

        require(c.active, "Challenge is not active");
        require(!c.canceled, "Challenge canceled");
        require(!c.withdrawn, "Remaining already withdrawn");
        require(c.resolvedPeriods == c.totalPeriods, "Not all periods resolved");

        c.withdrawn = true;
        c.active = false;
        activeChallengeOf[c.user] = 0;

        _sendEth(c.user, c.deposit);

        emit RemainingWithdrawn(challengeId, c.user, c.deposit);
    }

    function withdrawTreasury(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(amount <= treasuryBalance, "Amount exceeds treasury balance");

        treasuryBalance -= amount;
        _sendEth(treasury, amount);

        emit TreasuryWithdrawn(treasury, amount);
    }

    function setOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "Oracle address is zero");
        address oldOracle = oracle;
        oracle = newOracle;
        emit OracleUpdated(oldOracle, newOracle);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Treasury address is zero");
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    function setPenaltyRecipient(address newPenaltyRecipient) external onlyOwner {
        require(newPenaltyRecipient != address(0), "Penalty recipient is zero");
        address oldPenaltyRecipient = penaltyRecipient;
        penaltyRecipient = newPenaltyRecipient;
        emit PenaltyRecipientUpdated(oldPenaltyRecipient, newPenaltyRecipient);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getPeriodWindow(uint256 challengeId, uint256 periodIndex)
        public
        view
        challengeExists(challengeId)
        returns (uint256 periodStart, uint256 periodEnd)
    {
        Challenge storage c = challenges[challengeId];
        require(periodIndex < c.totalPeriods, "Invalid period index");

        periodStart = uint256(c.startAt) + (uint256(periodIndex) * uint256(c.cycleDuration));
        periodEnd = periodStart + uint256(c.periodDuration);
    }

    function getChallenge(uint256 challengeId)
        external
        view
        challengeExists(challengeId)
        returns (
            address user,
            string memory handle,
            uint64 startAt,
            uint64 periodDuration,
            uint64 cycleDuration,
            uint32 totalPeriods,
            uint32 minRating,
            uint256 penaltyNoSubmission,
            uint256 penaltyNoOk,
            uint256 deposit,
            uint256 slashedAmount,
            uint32 resolvedPeriods,
            bool withdrawn,
            bool canceled,
            bool active
        )
    {
        Challenge storage c = challenges[challengeId];
        return (
            c.user,
            c.handle,
            c.startAt,
            c.periodDuration,
            c.cycleDuration,
            c.totalPeriods,
            c.minRating,
            c.penaltyNoSubmission,
            c.penaltyNoOk,
            c.deposit,
            c.slashedAmount,
            c.resolvedPeriods,
            c.withdrawn,
            c.canceled,
            c.active
        );
    }

    function getPeriodRecord(uint256 challengeId, uint256 periodIndex)
        external
        view
        challengeExists(challengeId)
        returns (
            PeriodStatus status,
            uint256 resolvedAt,
            uint256 penaltyApplied,
            bool penaltySettled,
            uint256 submissionId,
            uint256 acceptedAt,
            uint256 rating,
            bytes32 proofHash
        )
    {
        PeriodRecord storage r = periodRecords[challengeId][periodIndex];
        return (
            r.status,
            r.resolvedAt,
            r.penaltyApplied,
            r.penaltySettled,
            r.submissionId,
            r.acceptedAt,
            r.rating,
            r.proofHash
        );
    }

    function challengeEndAt(uint256 challengeId)
        external
        view
        challengeExists(challengeId)
        returns (uint256)
    {
        Challenge storage c = challenges[challengeId];
        return
            uint256(c.startAt)
                + (uint256(c.cycleDuration) * uint256(c.totalPeriods - 1))
                + uint256(c.periodDuration);
    }

    function _sendEth(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        require(ok, "ETH transfer failed");
    }
}
