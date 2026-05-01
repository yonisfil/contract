import { network } from "hardhat";
import { config as loadEnv } from "dotenv";

loadEnv();

const { ethers } = await network.create("localhost");

function getChallengeId() {
  const fromArg = process.argv.find((x) => x.startsWith("--challenge="));
  return Number(fromArg ? fromArg.slice("--challenge=".length) : process.env.CHALLENGE_ID ?? "1");
}

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) throw new Error("Missing CONTRACT_ADDRESS");

  const challengeId = getChallengeId();
  if (!Number.isInteger(challengeId) || challengeId <= 0) {
    throw new Error("challenge must be a positive integer");
  }

  const [user] = await ethers.getSigners();
  const challenge = await ethers.getContractAt("CodeforcesDailyChallenge", contractAddress, user);

  const tx = await challenge.withdrawRemaining(challengeId);
  const receipt = await tx.wait();

  console.log(`Remaining deposit withdrawn for challenge #${challengeId}`);
  console.log(`Tx: ${receipt?.hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
