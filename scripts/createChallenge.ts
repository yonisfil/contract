import { network } from "hardhat";
import { config as loadEnv } from "dotenv";

loadEnv();

const { ethers } = await network.create("localhost");

function numberFromEnv(name: string, fallback: string) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!contractAddress) throw new Error("Missing CONTRACT_ADDRESS");

  const [user] = await ethers.getSigners();
  const challenge = await ethers.getContractAt("CodeforcesDailyChallenge", contractAddress, user);

  const latestBlock = await ethers.provider.getBlock("latest");
  if (!latestBlock) throw new Error("Failed to get latest block");

  const nowFromPc = Math.floor(Date.now() / 1000);
  const nowFromChain = Number(latestBlock.timestamp);
  const baseTime = Math.max(nowFromPc, nowFromChain);

  const handle = process.env.CHALLENGE_HANDLE ?? "tourist";
  const startDelaySeconds = numberFromEnv("START_DELAY_SECONDS", "300");
  const startAt = BigInt(baseTime + startDelaySeconds);
  const periodDuration = numberFromEnv("PERIOD_DURATION_SECONDS", "300");
  const cycleDuration = numberFromEnv("CYCLE_DURATION_SECONDS", String(periodDuration));
  const totalPeriods = numberFromEnv("TOTAL_PERIODS", "1");
  const minRating = numberFromEnv("MIN_RATING", "800");
  const penaltyNoSubmission = ethers.parseEther(process.env.PENALTY_NO_SUBMISSION ?? "10");
  const penaltyNoOk = ethers.parseEther(process.env.PENALTY_NO_OK ?? "5");

  const requiredDeposit = penaltyNoSubmission * BigInt(totalPeriods);

  console.log("User:", user.address);
  console.log("Latest block timestamp:", nowFromChain);
  console.log("Current PC timestamp:", nowFromPc);
  console.log("Chosen challenge startAt:", startAt.toString());
  console.log("Codeforces handle:", handle);
  console.log("Active period duration:", periodDuration);
  console.log("Cycle duration:", cycleDuration);
  console.log("Total periods:", totalPeriods);
  console.log("Minimum rating:", minRating);
  console.log("Required ETH deposit:", ethers.formatEther(requiredDeposit), "ETH");

  const tx = await challenge.createChallenge(
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
  console.log("Challenge created. Tx:", receipt?.hash);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
