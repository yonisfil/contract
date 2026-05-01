export const challengeAbi = [
  "function activeChallengeOf(address user) view returns (uint256)",
  "function getChallenge(uint256 challengeId) view returns (address user, string handle, uint64 startAt, uint64 periodDuration, uint64 cycleDuration, uint32 totalPeriods, uint32 minRating, uint256 penaltyNoSubmission, uint256 penaltyNoOk, uint256 deposit, uint256 slashedAmount, uint32 resolvedPeriods, bool withdrawn, bool canceled, bool active)",
  "function getPeriodWindow(uint256 challengeId, uint256 periodIndex) view returns (uint256 periodStart, uint256 periodEnd)",
  "function getPeriodRecord(uint256 challengeId, uint256 periodIndex) view returns (uint8 status, uint256 resolvedAt, uint256 penaltyApplied, bool penaltySettled, uint256 submissionId, uint256 acceptedAt, uint256 rating, bytes32 proofHash)",
  "function nextChallengeId() view returns (uint256)",
  "function outstandingPenaltyOf(address user) view returns (uint256)",
  "function penaltyRecipient() view returns (address)",
  "function treasury() view returns (address)",
  "function treasuryBalance() view returns (uint256)",
  "function payPeriodPenalty(uint256 challengeId, uint256 periodIndex) payable"
];
