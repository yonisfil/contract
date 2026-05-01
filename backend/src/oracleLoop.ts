import { config as loadEnv } from "dotenv";
import { spawn } from "node:child_process";

loadEnv();

function parseNumberArg(name: string, fallback?: number): number {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  const rawValue = arg ? arg.slice(name.length + 3) : fallback?.toString();
  const value = Number(rawValue);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOracleForPeriod(challengeId: number, periodIndex: number) {
  console.log(`[oracle-loop] Running: npm run oracle -- --challenge=${challengeId} --period=${periodIndex}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "npm",
      ["run", "oracle", "--", `--challenge=${challengeId}`, `--period=${periodIndex}`],
      {
        stdio: "inherit",
        shell: true,
      }
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`oracle command failed for period ${periodIndex} with exit code ${code}`));
    });
  });
}

async function main() {
  const challengeId = parseNumberArg(
    "challenge",
    Number(process.env.CHALLENGE_ID ?? "1")
  );
  const startPeriod = parseNumberArg("start-period", 0);
  const intervalSeconds = parseNumberArg(
    "interval-seconds",
    Number(process.env.ORACLE_LOOP_INTERVAL_SECONDS ?? "70")
  );

  console.log(`[oracle-loop] challenge=${challengeId}`);
  console.log(`[oracle-loop] startPeriod=${startPeriod}`);
  console.log(`[oracle-loop] intervalSeconds=${intervalSeconds}`);

  let currentPeriod = startPeriod;

  for (;;) {
    try {
      await runOracleForPeriod(challengeId, currentPeriod);
      currentPeriod += 1;
    } catch (error) {
      console.error("[oracle-loop] Error:", error);
      console.log("[oracle-loop] Period index will not advance after a failed run.");
    }

    await sleep(intervalSeconds * 1000);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
