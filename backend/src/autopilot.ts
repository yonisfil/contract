import { config as loadEnv } from "dotenv";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";

import { fetchUserStatus } from "./codeforces.js";
import { resolvePeriod } from "./resolver.js";

loadEnv();

const REQUIRED_ENV = [
  "RPC_URL",
  "PRIVATE_KEY",
  "CONTRACT_ADDRESS",
] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL!);
const oracleWallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
const userWallet = process.env.USER_PRIVATE_KEY
  ? new ethers.Wallet(process.env.USER_PRIVATE_KEY, provider)
  : null;

const contractAbi = [
  "function activeChallengeOf(address user) view returns (uint256)",
  "function createChallenge(string handle, uint64 startAt, uint64 periodDuration, uint64 cycleDuration, uint32 totalPeriods, uint32 minRating, uint256 penaltyNoSubmission, uint256 penaltyNoOk) payable returns (uint256 challengeId)",
  "function getChallenge(uint256 challengeId) view returns (address user, string handle, uint64 startAt, uint64 periodDuration, uint64 cycleDuration, uint32 totalPeriods, uint32 minRating, uint256 penaltyNoSubmission, uint256 penaltyNoOk, uint256 deposit, uint256 slashedAmount, uint32 resolvedPeriods, bool withdrawn, bool canceled, bool active)",
  "function getPeriodWindow(uint256 challengeId, uint256 periodIndex) view returns (uint256 periodStart, uint256 periodEnd)",
  "function getPeriodRecord(uint256 challengeId, uint256 periodIndex) view returns (uint8 status, uint256 resolvedAt, uint256 penaltyApplied, bool penaltySettled, uint256 submissionId, uint256 acceptedAt, uint256 rating, bytes32 proofHash)",
  "function markPeriodCompleted(uint256 challengeId, uint256 periodIndex, uint256 submissionId, uint256 acceptedAt, uint256 rating, bytes32 proofHash)",
  "function slashPeriodNoSubmission(uint256 challengeId, uint256 periodIndex, bytes32 proofHash)",
  "function slashPeriodNoOk(uint256 challengeId, uint256 periodIndex, bytes32 proofHash)",
  "function withdrawRemaining(uint256 challengeId)",
  "function outstandingPenaltyOf(address user) view returns (uint256)",
] as const;

const oracleContract = new ethers.Contract(
  process.env.CONTRACT_ADDRESS!,
  contractAbi,
  oracleWallet
);
const userContract = new ethers.Contract(
  process.env.CONTRACT_ADDRESS!,
  contractAbi,
  userWallet
);

function numberFromEnv(name: string, fallback: string): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

const pollIntervalMs = numberFromEnv("AUTOPILOT_POLL_INTERVAL_SECONDS", "15") * 1000;
const startDelaySeconds = numberFromEnv("AUTOPILOT_START_DELAY_SECONDS", "5");
const periodDuration = numberFromEnv("PERIOD_DURATION_SECONDS", "300");
const cycleDuration = numberFromEnv("CYCLE_DURATION_SECONDS", String(periodDuration));
const totalPeriods = numberFromEnv("TOTAL_PERIODS", "1");
const minRating = numberFromEnv("MIN_RATING", "800");
const handle = process.env.CHALLENGE_HANDLE ?? "";
const configuredChallengeId = Number(process.env.CHALLENGE_ID ?? "0");
const penaltyNoSubmission = ethers.parseEther(process.env.PENALTY_NO_SUBMISSION ?? "10");
const penaltyNoOk = ethers.parseEther(process.env.PENALTY_NO_OK ?? "5");
const requiredDeposit = penaltyNoSubmission * BigInt(totalPeriods);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getNextWakeDelayMs(challengeId: number) {
  const challengeData = await oracleContract.getChallenge(challengeId);
  const total = Number(challengeData[5]);
  const withdrawn = Boolean(challengeData[12]);
  const canceled = Boolean(challengeData[13]);

  if (withdrawn || canceled) {
    return pollIntervalMs;
  }

  const latestBlock = await provider.getBlock("latest");
  const now = Number(latestBlock?.timestamp ?? 0);

  for (let periodIndex = 0; periodIndex < total; periodIndex++) {
    const record = await oracleContract.getPeriodRecord(challengeId, periodIndex);
    const status = Number(record[0]);
    if (status !== 0) {
      continue;
    }

    const window = await oracleContract.getPeriodWindow(challengeId, periodIndex);
    const periodEnd = Number(window[1]);
    const delaySeconds = Math.max(1, periodEnd + 1 - now);
    return delaySeconds * 1000;
  }

  return pollIntervalMs;
}

async function createNextChallenge() {
  if (!userWallet) {
    throw new Error("USER_PRIVATE_KEY is required to create a new challenge automatically");
  }
  if (!handle) {
    throw new Error("CHALLENGE_HANDLE is required to create a new challenge automatically");
  }

  const latestBlock = await provider.getBlock("latest");
  if (!latestBlock) {
    throw new Error("Failed to get latest block");
  }

  const startAt = BigInt(Number(latestBlock.timestamp) + startDelaySeconds);
  const tx = await userContract.createChallenge(
    handle,
    startAt,
    periodDuration,
    cycleDuration,
    totalPeriods,
    minRating,
    penaltyNoSubmission,
    penaltyNoOk,
    { value: requiredDeposit }
  );
  const receipt = await tx.wait();

  console.log(
    `[autopilot] Created challenge. tx=${receipt?.hash} startAt=${startAt.toString()} handle=${handle}`
  );
}

async function resolvePeriodIfReady(challengeId: number, periodIndex: number, challengeData: unknown[]) {
  const record = await oracleContract.getPeriodRecord(challengeId, periodIndex);
  const currentStatus = Number(record[0]);
  if (currentStatus !== 0) {
    return false;
  }

  const window = await oracleContract.getPeriodWindow(challengeId, periodIndex);
  const periodStart = Number(window[0]);
  const periodEnd = Number(window[1]);
  const latestBlock = await provider.getBlock("latest");
  const now = Number(latestBlock?.timestamp ?? 0);

  if (now < periodEnd) {
    return false;
  }

  const submissions = await fetchUserStatus(String(challengeData[1]), 200);
  const resolution = resolvePeriod({
    handle: String(challengeData[1]),
    periodIndex,
    periodStart,
    periodEnd,
    minRating: Number(challengeData[6]),
    submissions,
  });

  const reportJson = JSON.stringify(resolution.report, null, 2);
  const proofHash = ethers.keccak256(ethers.toUtf8Bytes(reportJson));

  fs.mkdirSync(path.resolve("proofs"), { recursive: true });
  const proofFile = path.resolve("proofs", `challenge-${challengeId}-period-${periodIndex}.json`);
  fs.writeFileSync(proofFile, reportJson, "utf-8");

  let tx;
  if (resolution.kind === "completed") {
    tx = await oracleContract.markPeriodCompleted(
      challengeId,
      periodIndex,
      resolution.submissionId!,
      resolution.acceptedAt!,
      resolution.rating!,
      proofHash
    );
  } else if (resolution.kind === "no_submission") {
    tx = await oracleContract.slashPeriodNoSubmission(challengeId, periodIndex, proofHash);
  } else {
    tx = await oracleContract.slashPeriodNoOk(challengeId, periodIndex, proofHash);
  }

  const receipt = await tx.wait();
  console.log(
    `[autopilot] Resolved challenge #${challengeId}, period #${periodIndex}. kind=${resolution.kind} tx=${receipt?.hash}`
  );
  return true;
}

async function resolveFinishedPeriods(challengeId: number, challengeData: unknown[]) {
  const total = Number(challengeData[5]);
  let changed = false;

  for (let index = 0; index < total; index++) {
    const didResolve = await resolvePeriodIfReady(challengeId, index, challengeData);
    changed = didResolve || changed;
  }

  return changed;
}

async function tick() {
  if (!userWallet) {
    if (configuredChallengeId <= 0) {
      throw new Error("Set CHALLENGE_ID for watch mode or USER_PRIVATE_KEY for auto-create mode");
    }

    const challengeData = await oracleContract.getChallenge(configuredChallengeId);
    const withdrawn = Boolean(challengeData[12]);
    const canceled = Boolean(challengeData[13]);

    if (withdrawn || canceled) {
      console.log(
        `[autopilot] Challenge #${configuredChallengeId} is already closed. Nothing to watch.`
      );
      return;
    }

    await resolveFinishedPeriods(configuredChallengeId, challengeData);
    return await getNextWakeDelayMs(configuredChallengeId);
  }

  const activeChallengeId = Number(await oracleContract.activeChallengeOf(userWallet.address));

  if (activeChallengeId === 0) {
    await createNextChallenge();
    const newActiveChallengeId = Number(await oracleContract.activeChallengeOf(userWallet.address));
    if (newActiveChallengeId > 0) {
      return await getNextWakeDelayMs(newActiveChallengeId);
    }
    return pollIntervalMs;
  }

  let challengeData = await oracleContract.getChallenge(activeChallengeId);

  await resolveFinishedPeriods(activeChallengeId, challengeData);
  challengeData = await oracleContract.getChallenge(activeChallengeId);
  const resolvedPeriods = Number(challengeData[11]);
  const totalPeriodsInChallenge = Number(challengeData[5]);

  if (resolvedPeriods === totalPeriodsInChallenge) {
    const outstanding = await oracleContract.outstandingPenaltyOf(userWallet.address);
    console.log(
      `[autopilot] Challenge #${activeChallengeId} reached its final period. No new challenge will be created automatically. outstandingPenalty=${ethers.formatEther(outstanding)} ETH`
    );
  }

  return await getNextWakeDelayMs(activeChallengeId);
}

async function main() {
  console.log(`[autopilot] Oracle address: ${oracleWallet.address}`);
  if (userWallet) {
    console.log(`[autopilot] User address: ${userWallet.address}`);
    console.log("[autopilot] Mode: auto-create and auto-resolve");
  } else {
    console.log(`[autopilot] Mode: watch existing challenge #${configuredChallengeId}`);
  }
  console.log(`[autopilot] Poll interval: ${pollIntervalMs} ms`);

  for (;;) {
    try {
      const nextDelayMs = await tick();
      await sleep(nextDelayMs);
    } catch (error) {
      console.error("[autopilot] Tick failed:", error);
      await sleep(pollIntervalMs);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
