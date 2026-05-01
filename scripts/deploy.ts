import { network } from "hardhat";

const { ethers, networkName } = await network.create();

async function main() {
  const [user, penaltyRecipient, oracle, treasury] = await ethers.getSigners();

  console.log(`Deploying to network: ${networkName}`);
  console.log(`Primary user (Account #0): ${user.address}`);
  console.log(`Penalty mode: user pays a separate ETH slash transaction from Account #0`);
  console.log(`Penalty recipient label: ${penaltyRecipient.address}`);
  console.log(`Oracle: ${oracle.address}`);
  console.log(`Treasury: ${treasury.address}`);

  const challenge = await ethers.deployContract("CodeforcesDailyChallenge", [
    oracle.address,
    treasury.address,
    penaltyRecipient.address,
  ]);
  await challenge.waitForDeployment();

  console.log("CodeforcesDailyChallenge:", await challenge.getAddress());
  console.log("Account #0 already has test ETH from Hardhat");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
