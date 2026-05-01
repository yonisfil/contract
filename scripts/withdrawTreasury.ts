import { network } from "hardhat";
import { config as loadEnv } from "dotenv";

loadEnv();

const { ethers } = await network.create("localhost");

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) throw new Error("Missing CONTRACT_ADDRESS");

  const amount = process.env.TREASURY_WITHDRAW_AMOUNT ?? "15";
  const [owner] = await ethers.getSigners();
  const challenge = await ethers.getContractAt("CodeforcesDailyChallenge", contractAddress, owner);

  const tx = await challenge.withdrawTreasury(ethers.parseEther(amount));
  const receipt = await tx.wait();

  console.log(`Treasury withdrawn: ${amount} ETH`);
  console.log(`Tx: ${receipt?.hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
