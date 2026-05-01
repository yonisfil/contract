import { expect } from "chai";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();

describe("CodeforcesDailyChallenge", function () {
  async function deployFixture() {
    const [user, penaltyRecipient, oracle, treasury] = await ethers.getSigners();

    const challenge = await ethers.deployContract("CodeforcesDailyChallenge", [
      oracle.address,
      treasury.address,
      penaltyRecipient.address,
    ]);
    await challenge.waitForDeployment();

    return { user, penaltyRecipient, oracle, treasury, challenge };
  }

  it("creates a challenge and locks the ETH deposit from account #0", async function () {
    const { user, challenge } = await networkHelpers.loadFixture(deployFixture);

    const latest = await networkHelpers.time.latest();
    const startAt = latest + 100;

    const penaltyNoSubmission = ethers.parseEther("10");
    const penaltyNoOk = ethers.parseEther("5");
    const requiredDeposit = penaltyNoSubmission * 3n;

    await expect(
      challenge.connect(user).createChallenge(
        "tourist",
        startAt,
        60,
        60,
        3,
        800,
        penaltyNoSubmission,
        penaltyNoOk,
        { value: requiredDeposit }
      )
    ).to.emit(challenge, "ChallengeCreated");

    const stored = await challenge.getChallenge(1);
    expect(stored[9]).to.equal(requiredDeposit);
    expect(await ethers.provider.getBalance(await challenge.getAddress())).to.equal(requiredDeposit);
    expect(await challenge.activeChallengeOf(user.address)).to.equal(1n);
  });

  it("returns the full ETH deposit when the challenge is completed successfully", async function () {
    const { user, oracle, challenge } = await networkHelpers.loadFixture(deployFixture);

    const latest = await networkHelpers.time.latest();
    const startAt = latest + 100;

    const penaltyNoSubmission = ethers.parseEther("10");
    const penaltyNoOk = ethers.parseEther("5");

    await challenge.connect(user).createChallenge(
      "tourist",
      startAt,
      60,
      60,
      1,
      800,
      penaltyNoSubmission,
      penaltyNoOk,
      { value: penaltyNoSubmission }
    );

    await networkHelpers.time.increaseTo(startAt + 61);

    await expect(
      challenge.connect(oracle).markPeriodCompleted(
        1,
        0,
        123456,
        startAt + 10,
        900,
        ethers.keccak256(ethers.toUtf8Bytes("success-proof"))
      )
    ).to.emit(challenge, "PeriodCompleted");

    const userBalanceBefore = await ethers.provider.getBalance(user.address);
    const tx = await challenge.connect(user).withdrawRemaining(1);
    const receipt = await tx.wait();
    const userBalanceAfter = await ethers.provider.getBalance(user.address);
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;

    expect(userBalanceAfter - userBalanceBefore + gasCost).to.equal(penaltyNoSubmission);
    expect(await ethers.provider.getBalance(await challenge.getAddress())).to.equal(0n);
  });

  it("requires a real ETH penalty payment in a separate transaction", async function () {
    const { user, oracle, challenge } = await networkHelpers.loadFixture(deployFixture);

    const latest = await networkHelpers.time.latest();
    const startAt = latest + 100;

    const penaltyNoSubmission = ethers.parseEther("10");
    const penaltyNoOk = ethers.parseEther("5");

    await challenge.connect(user).createChallenge(
      "tourist",
      startAt,
      60,
      60,
      1,
      800,
      penaltyNoSubmission,
      penaltyNoOk,
      { value: penaltyNoSubmission }
    );

    await networkHelpers.time.increaseTo(startAt + 61);

    await challenge
      .connect(oracle)
      .slashPeriodNoSubmission(1, 0, ethers.keccak256(ethers.toUtf8Bytes("no-submissions")));

    const recordBeforePay = await challenge.getPeriodRecord(1, 0);
    expect(recordBeforePay[3]).to.equal(false);
    expect(await challenge.outstandingPenaltyOf(user.address)).to.equal(penaltyNoSubmission);

    const userBalanceBeforePay = await ethers.provider.getBalance(user.address);
    const payTx = await challenge.connect(user).payPeriodPenalty(1, 0, {
      value: penaltyNoSubmission,
    });
    const payReceipt = await payTx.wait();
    const userBalanceAfterPay = await ethers.provider.getBalance(user.address);
    const payGasCost = payReceipt!.gasUsed * payReceipt!.gasPrice;
    const recordAfterPay = await challenge.getPeriodRecord(1, 0);

    expect(userBalanceBeforePay - userBalanceAfterPay - payGasCost).to.equal(penaltyNoSubmission);
    expect(recordAfterPay[3]).to.equal(true);
    expect(await challenge.outstandingPenaltyOf(user.address)).to.equal(0n);
    expect(await challenge.treasuryBalance()).to.equal(penaltyNoSubmission);

    const withdrawTx = await challenge.connect(user).withdrawRemaining(1);
    await withdrawTx.wait();

    expect(await ethers.provider.getBalance(await challenge.getAddress())).to.equal(penaltyNoSubmission);
  });

  it("returns the full deposit after a no-ok penalty is paid separately", async function () {
    const { user, oracle, treasury, challenge } = await networkHelpers.loadFixture(deployFixture);

    const latest = await networkHelpers.time.latest();
    const startAt = latest + 100;

    const penaltyNoSubmission = ethers.parseEther("10");
    const penaltyNoOk = ethers.parseEther("5");
    const deposit = penaltyNoSubmission * 2n;

    await challenge.connect(user).createChallenge(
      "tourist",
      startAt,
      60,
      60,
      2,
      800,
      penaltyNoSubmission,
      penaltyNoOk,
      { value: deposit }
    );

    await networkHelpers.time.increaseTo(startAt + 61);

    await challenge.connect(oracle).slashPeriodNoOk(
      1,
      0,
      ethers.keccak256(ethers.toUtf8Bytes("no-ok-proof"))
    );

    await networkHelpers.time.increaseTo(startAt + 121);

    await challenge.connect(oracle).markPeriodCompleted(
      1,
      1,
      654321,
      startAt + 80,
      900,
      ethers.keccak256(ethers.toUtf8Bytes("ok-proof"))
    );

    const treasuryBalanceBefore = await challenge.treasuryBalance();
    await challenge.connect(user).payPeriodPenalty(1, 0, { value: penaltyNoOk });
    const treasuryBalanceAfter = await challenge.treasuryBalance();

    expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(penaltyNoOk);

    const userBalanceBeforeWithdraw = await ethers.provider.getBalance(user.address);
    const withdrawTx = await challenge.connect(user).withdrawRemaining(1);
    const withdrawReceipt = await withdrawTx.wait();
    const userBalanceAfterWithdraw = await ethers.provider.getBalance(user.address);
    const withdrawGasCost = withdrawReceipt!.gasUsed * withdrawReceipt!.gasPrice;

    expect(userBalanceAfterWithdraw - userBalanceBeforeWithdraw + withdrawGasCost).to.equal(deposit);

    const treasuryBalanceBeforePayout = await ethers.provider.getBalance(treasury.address);
    const treasuryWithdrawTx = await challenge.withdrawTreasury(penaltyNoOk);
    const treasuryWithdrawReceipt = await treasuryWithdrawTx.wait();
    const treasuryBalanceAfterPayout = await ethers.provider.getBalance(treasury.address);
    const treasuryGasCost = treasuryWithdrawReceipt!.gasUsed * treasuryWithdrawReceipt!.gasPrice;

    expect(treasuryBalanceAfterPayout - treasuryBalanceBeforePayout).to.equal(penaltyNoOk);
    expect(await challenge.treasuryBalance()).to.equal(0n);
    expect(await ethers.provider.getBalance(await challenge.getAddress())).to.equal(0n);
    expect(treasuryGasCost >= 0n).to.equal(true);
  });

  it("allows withdrawing the deposit even if penalty debt is still unpaid", async function () {
    const { user, oracle, challenge } = await networkHelpers.loadFixture(deployFixture);

    const latest = await networkHelpers.time.latest();
    const startAt = latest + 100;
    const penaltyNoSubmission = ethers.parseEther("10");
    const penaltyNoOk = ethers.parseEther("5");

    await challenge.connect(user).createChallenge(
      "tourist",
      startAt,
      60,
      60,
      1,
      800,
      penaltyNoSubmission,
      penaltyNoOk,
      { value: penaltyNoSubmission }
    );

    await networkHelpers.time.increaseTo(startAt + 61);
    await challenge
      .connect(oracle)
      .slashPeriodNoSubmission(1, 0, ethers.keccak256(ethers.toUtf8Bytes("no-submissions")));

    const userBalanceBeforeWithdraw = await ethers.provider.getBalance(user.address);
    const withdrawTx = await challenge.connect(user).withdrawRemaining(1);
    const withdrawReceipt = await withdrawTx.wait();
    const userBalanceAfterWithdraw = await ethers.provider.getBalance(user.address);
    const withdrawGasCost = withdrawReceipt!.gasUsed * withdrawReceipt!.gasPrice;

    expect(userBalanceAfterWithdraw - userBalanceBeforeWithdraw + withdrawGasCost).to.equal(
      penaltyNoSubmission
    );
    expect(await challenge.outstandingPenaltyOf(user.address)).to.equal(penaltyNoSubmission);
    expect(await challenge.activeChallengeOf(user.address)).to.equal(0n);

    const payTx = await challenge.connect(user).payPeriodPenalty(1, 0, {
      value: penaltyNoSubmission,
    });
    await payTx.wait();

    expect(await challenge.outstandingPenaltyOf(user.address)).to.equal(0n);
    expect(await challenge.treasuryBalance()).to.equal(penaltyNoSubmission);
  });

  it("lets a user start the next challenge while unpaid penalties from the previous one remain", async function () {
    const { user, oracle, challenge } = await networkHelpers.loadFixture(deployFixture);

    const latest = await networkHelpers.time.latest();
    const firstStartAt = latest + 100;
    const penaltyNoSubmission = ethers.parseEther("10");
    const penaltyNoOk = ethers.parseEther("5");

    await challenge.connect(user).createChallenge(
      "tourist",
      firstStartAt,
      60,
      60,
      1,
      800,
      penaltyNoSubmission,
      penaltyNoOk,
      { value: penaltyNoSubmission }
    );

    await networkHelpers.time.increaseTo(firstStartAt + 61);
    await challenge
      .connect(oracle)
      .slashPeriodNoSubmission(1, 0, ethers.keccak256(ethers.toUtf8Bytes("first-no-submissions")));

    await challenge.connect(user).withdrawRemaining(1);

    const secondStartAt = (await networkHelpers.time.latest()) + 100;
    await challenge.connect(user).createChallenge(
      "tourist",
      secondStartAt,
      60,
      60,
      1,
      800,
      penaltyNoSubmission,
      penaltyNoOk,
      { value: penaltyNoSubmission }
    );

    expect(await challenge.activeChallengeOf(user.address)).to.equal(2n);
    expect(await challenge.outstandingPenaltyOf(user.address)).to.equal(penaltyNoSubmission);
  });

  it("accumulates debt across multiple failed periods in the same long challenge", async function () {
    const { user, oracle, challenge } = await networkHelpers.loadFixture(deployFixture);

    const latest = await networkHelpers.time.latest();
    const startAt = latest + 100;
    const penaltyNoSubmission = ethers.parseEther("10");
    const penaltyNoOk = ethers.parseEther("5");

    await challenge.connect(user).createChallenge(
      "tourist",
      startAt,
      120,
      180,
      3,
      800,
      penaltyNoSubmission,
      penaltyNoOk,
      { value: penaltyNoSubmission * 3n }
    );

    await networkHelpers.time.increaseTo(startAt + 121);
    await challenge
      .connect(oracle)
      .slashPeriodNoSubmission(1, 0, ethers.keccak256(ethers.toUtf8Bytes("period-1-miss")));

    expect(await challenge.outstandingPenaltyOf(user.address)).to.equal(penaltyNoSubmission);

    await networkHelpers.time.increaseTo(startAt + 301);
    await challenge
      .connect(oracle)
      .slashPeriodNoOk(1, 1, ethers.keccak256(ethers.toUtf8Bytes("period-2-no-ok")));

    expect(await challenge.outstandingPenaltyOf(user.address)).to.equal(
      penaltyNoSubmission + penaltyNoOk
    );

    await networkHelpers.time.increaseTo(startAt + 481);
    await challenge.connect(oracle).markPeriodCompleted(
      1,
      2,
      999999,
      startAt + 400,
      900,
      ethers.keccak256(ethers.toUtf8Bytes("period-3-ok"))
    );

    expect(await challenge.outstandingPenaltyOf(user.address)).to.equal(
      penaltyNoSubmission + penaltyNoOk
    );
  });
});
