import type { CodeforcesApiResponse, CodeforcesSubmission } from "./types.js";

const CODEFORCES_MIN_DELAY_MS = 2_100;
let lastRequestAt = 0;

async function waitForCodeforcesRateLimit() {
  const now = Date.now();
  const waitMs = Math.max(0, CODEFORCES_MIN_DELAY_MS - (now - lastRequestAt));

  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  lastRequestAt = Date.now();
}

export async function fetchUserStatus(
  handle: string,
  count = 200
): Promise<CodeforcesSubmission[]> {
  await waitForCodeforcesRateLimit();

  const url = `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=${count}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Codeforces HTTP error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as CodeforcesApiResponse<CodeforcesSubmission[]>;

  if (data.status !== "OK") {
    throw new Error(`Codeforces API failed: ${data.comment ?? "unknown error"}`);
  }

  return data.result;
}
