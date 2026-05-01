import { config as loadEnv } from "dotenv";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";

import { fetchUserStatus } from "./codeforces.js";
import { resolvePeriod } from "./resolver.js";

loadEnv();

const REQUIRED_ENV = ["RPC_URL", "PRIVATE_KEY", "CONTRACT_ADDRESS"] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL!);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const contractAbi = [
  "function getChallenge(uint256 challengeId) view returns (address user, string handle, uint64 startAt, uint64 periodDuration, uint64 cycleDuration, uint32 totalPeriods, uint32 minRating, uint256 penaltyNoSubmission, uint256 penaltyNoOk, uint256 deposit, uint256 slashedAmount, uint32 resolvedPeriods, bool withdrawn, bool canceled, bool active)",
  "function getPeriodWindow(uint256 challengeId, uint256 periodIndex) view returns (uint256 periodStart, uint256 periodEnd)",
  "function getPeriodRecord(uint256 challengeId, uint256 periodIndex) view returns (uint8 status, uint256 resolvedAt, uint256 penaltyApplied, bool penaltySettled, uint256 submissionId, uint256 acceptedAt, uint256 rating, bytes32 proofHash)",
  "function markPeriodCompleted(uint256 challengeId, uint256 periodIndex, uint256 submissionId, uint256 acceptedAt, uint256 rating, bytes32 proofHash)",
  "function slashPeriodNoSubmission(uint256 challengeId, uint256 periodIndex, bytes32 proofHash)",
  "function slashPeriodNoOk(uint256 challengeId, uint256 periodIndex, bytes32 proofHash)",
];

const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS!, contractAbi, wallet);

function parseArg(name: string): string {
  const arg = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!arg) {
    throw new Error(`Missing argument --${name}=...`);
  }
  return arg.slice(name.length + 3);
}

async function main() {
  const challengeId = Number(parseArg("challenge"));
  const periodIndex = Number(parseArg("period"));

  if (!Number.isInteger(challengeId) || challengeId <= 0) {
    throw new Error("challenge must be a positive integer");
  }
  if (!Number.isInteger(periodIndex) || periodIndex < 0) {
    throw new Error("period must be a non-negative integer");
  }

  console.log(`Resolving challenge #${challengeId}, period #${periodIndex}`);

  const challengeData = await contract.getChallenge(challengeId);
  const handle = String(challengeData[1]);
  const totalPeriods = Number(challengeData[5]);
  const minRating = Number(challengeData[6]);
  const withdrawn = Boolean(challengeData[12]);
  const canceled = Boolean(challengeData[13]);
  const active = Boolean(challengeData[14]);

  if (!active || canceled || withdrawn) {
    throw new Error("Challenge is not active");
  }

  if (periodIndex >= totalPeriods) {
    throw new Error(`periodIndex ${periodIndex} is outside totalPeriods ${totalPeriods}`);
  }

  const record = await contract.getPeriodRecord(challengeId, periodIndex);
  const currentStatus = Number(record[0]);
  if (currentStatus !== 0) {
    throw new Error("Current period status is not Unresolved");
  }

  const window = await contract.getPeriodWindow(challengeId, periodIndex);
  const periodStart = Number(window[0]);
  const periodEnd = Number(window[1]);

  const now = Math.floor(Date.now() / 1000);
  if (now < periodEnd) {
    throw new Error(`Period is not over yet. Now=${now}, periodEnd=${periodEnd}`);
  }

  console.log(`Codeforces handle: ${handle}`);
  console.log(`Min rating: ${minRating}`);
  console.log(`Period window: [${periodStart}, ${periodEnd})`);
  console.log("Rule: only problems with an explicit Codeforces rating are eligible.");

  const submissions = await fetchUserStatus(handle, 200);
  console.log(`Submissions received: ${submissions.length}`);

  const resolution = resolvePeriod({
    handle,
    periodIndex,
    periodStart,
    periodEnd,
    minRating,
    submissions,
  });

  const reportJson = JSON.stringify(resolution.report, null, 2);
  const proofHash = ethers.keccak256(ethers.toUtf8Bytes(reportJson));

  fs.mkdirSync(path.resolve("proofs"), { recursive: true });
  const proofFile = path.resolve("proofs", `challenge-${challengeId}-period-${periodIndex}.json`);
  fs.writeFileSync(proofFile, reportJson, "utf-8");

  console.log(`Resolution kind: ${resolution.kind}`);
  console.log(`Proof file: ${proofFile}`);
  console.log(`Proof hash: ${proofHash}`);

  let tx;

  if (resolution.kind === "completed") {
    tx = await contract.markPeriodCompleted(
      challengeId,
      periodIndex,
      resolution.submissionId!,
      resolution.acceptedAt!,
      resolution.rating!,
      proofHash
    );
  } else if (resolution.kind === "no_submission") {
    tx = await contract.slashPeriodNoSubmission(challengeId, periodIndex, proofHash);
  } else {
    tx = await contract.slashPeriodNoOk(challengeId, periodIndex, proofHash);
  }

  console.log(`Transaction sent: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Transaction mined in block: ${receipt.blockNumber}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
