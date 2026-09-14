import { useMemo } from "react";

import type {
  GitHubIssueComment,
  GitHubPrReview,
  GitHubReviewComment,
} from "@src/api/tauri/github";

import type { TimelineEntry } from "./types";

/**
 * Inline review comments grouped by review id, and the conversation comments
 * and reviews merged into one chronological timeline.
 */
export function usePrConversationTimeline(
  conversation: GitHubIssueComment[],
  reviews: GitHubPrReview[],
  reviewComments: GitHubReviewComment[]
) {
  const commentsByReview = useMemo(() => {
    const map = new Map<number, GitHubReviewComment[]>();
    for (const comment of reviewComments) {
      const key = comment.pull_request_review_id;
      if (key == null) continue;
      const list = map.get(key) ?? [];
      list.push(comment);
      map.set(key, list);
    }
    return map;
  }, [reviewComments]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = [];
    for (const comment of conversation) {
      entries.push({ kind: "comment", at: comment.created_at, comment });
    }
    for (const review of reviews) {
      // Skip empty pending / commented reviews that carry neither body nor
      // inline comments — they add noise, not signal.
      const hasInline = (commentsByReview.get(review.id)?.length ?? 0) > 0;
      if (review.state === "COMMENTED" && !review.body.trim() && !hasInline) {
        continue;
      }
      entries.push({
        kind: "review",
        at: review.submitted_at ?? "",
        review,
      });
    }
    entries.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
    return entries;
  }, [conversation, reviews, commentsByReview]);

  return { commentsByReview, timeline };
}
