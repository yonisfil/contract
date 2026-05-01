import { network } from "hardhat";
import { config as loadEnv } from "dotenv";

loadEnv();

const { ethers } = await network.create("localhost");

function parsePositiveIntArg(name: string): number {
  const fromArg = process.argv.find((x) => x.startsWith(`--${name}=`));
  const value = Number(fromArg ? fromArg.slice(name.length + 3) : "");

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return value;
}

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!contractAddress) throw new Error("Missing CONTRACT_ADDRESS");

  const challengeId = parsePositiveIntArg("challenge");
  const periodIndex = parsePositiveIntArg("period");

  const [user] = await ethers.getSigners();

  const challenge = await ethers.getContractAt("CodeforcesDailyChallenge", contractAddress, user);
  const period = await challenge.getPeriodRecord(challengeId, periodIndex);
  const penaltyAmount = BigInt(period[2]);

  if (penaltyAmount <= 0n) {
    throw new Error("Penalty amount is zero");
  }

  const tx = await challenge.payPeriodPenalty(challengeId, periodIndex, {
    value: penaltyAmount,
  });
  const receipt = await tx.wait();

  console.log(
    `Penalty paid for challenge #${challengeId}, period #${periodIndex}: ${ethers.formatEther(penaltyAmount)} ETH`
  );
  console.log(`Tx: ${receipt?.hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
