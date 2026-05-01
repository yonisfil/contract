import type { CodeforcesSubmission, ResolutionResult } from "./types.js";

type ResolveParams = {
  handle: string;
  periodIndex: number;
  periodStart: number;
  periodEnd: number;
  minRating: number;
  submissions: CodeforcesSubmission[];
};

export function resolvePeriod(params: ResolveParams): ResolutionResult {
  const {
    handle,
    periodIndex,
    periodStart,
    periodEnd,
    minRating,
    submissions,
  } = params;

  const inWindow = submissions.filter((submission) => {
    const t = submission.creationTimeSeconds;
    return t >= periodStart && t < periodEnd;
  });

  if (inWindow.length === 0) {
    return {
      kind: "no_submission",
      report: {
        handle,
        periodIndex,
        periodStart,
        periodEnd,
        submissionsFound: 0,
        validOkFound: false,
        rule: "Only Codeforces problems with an explicit rating are eligible.",
        reason: "No submissions in this period",
      },
    };
  }

  const validOk = inWindow.find((submission) => {
    return (
      submission.verdict === "OK" &&
      typeof submission.problem.rating === "number" &&
      submission.problem.rating >= minRating
    );
  });

  if (!validOk) {
    return {
      kind: "no_ok",
      report: {
        handle,
        periodIndex,
        periodStart,
        periodEnd,
        submissionsFound: inWindow.length,
        validOkFound: false,
        rule: "Only Codeforces problems with an explicit rating are eligible.",
        reason: "There were submissions, but no OK on a rated problem with rating >= minRating",
        submissions: inWindow.map((s) => ({
          id: s.id,
          verdict: s.verdict ?? null,
          createdAt: s.creationTimeSeconds,
          contestId: s.contestId ?? null,
          problemIndex: s.problem.index,
          problemName: s.problem.name,
          rating: s.problem.rating ?? null,
        })),
      },
    };
  }

  return {
    kind: "completed",
    submissionId: validOk.id,
    acceptedAt: validOk.creationTimeSeconds,
    rating: validOk.problem.rating!,
    report: {
      handle,
      periodIndex,
      periodStart,
      periodEnd,
      submissionsFound: inWindow.length,
      validOkFound: true,
      rule: "Only Codeforces problems with an explicit rating are eligible.",
      submissionId: validOk.id,
      acceptedAt: validOk.creationTimeSeconds,
      verdict: validOk.verdict,
      rating: validOk.problem.rating,
      contestId: validOk.contestId ?? null,
      problemIndex: validOk.problem.index,
      problemName: validOk.problem.name,
    },
  };
}
