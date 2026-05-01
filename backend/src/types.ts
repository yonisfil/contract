export type CodeforcesProblem = {
  contestId?: number;
  problemsetName?: string;
  index: string;
  name: string;
  rating?: number;
  tags?: string[];
};

export type CodeforcesSubmission = {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  relativeTimeSeconds: number;
  problem: CodeforcesProblem;
  verdict?: string;
  programmingLanguage?: string;
  passedTestCount?: number;
};

export type CodeforcesApiResponse<T> = {
  status: "OK" | "FAILED";
  comment?: string;
  result: T;
};

export type ResolutionKind = "completed" | "no_submission" | "no_ok";

export type ResolutionResult = {
  kind: ResolutionKind;
  report: Record<string, unknown>;
  submissionId?: number;
  acceptedAt?: number;
  rating?: number;
};
