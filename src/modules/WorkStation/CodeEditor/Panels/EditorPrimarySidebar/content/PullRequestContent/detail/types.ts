import type { GitHubIssueComment, GitHubPrReview } from "@src/api/tauri/github";

import type { useWorkstationPrDetail } from "../../../hooks/useWorkstationPrDetail";

/** Mutations, picker candidates and pending flags for the mounted PR. */
export type WorkstationPrDetailController = ReturnType<
  typeof useWorkstationPrDetail
>;

// ── Merged timeline ──────────────────────────────────────────────────────────

export type TimelineEntry =
  | { kind: "comment"; at: string; comment: GitHubIssueComment }
  | { kind: "review"; at: string; review: GitHubPrReview };
