import { useState } from "react";
import type { ThreadDetailResponse } from "@/components/api-client";
import styles from "./thread-feedback.module.css";

export function ThreadFeedbackBox({
  thread,
  onSubmit,
  disabled,
}: {
  thread: ThreadDetailResponse["thread"];
  onSubmit: (rating: number, comment: string) => void;
  disabled: boolean;
}) {
  const [rating, setRating] = useState<number>(thread.feedback.mine?.rating ?? 5);
  const [comment, setComment] = useState<string>(thread.feedback.mine?.comment ?? "");

  return (
    <div className={styles.datasetNote}>
      <h3>Thread Feedback</h3>
      <p>
        Average: {thread.feedback.averageRating ? thread.feedback.averageRating.toFixed(2) : "-"} ({thread.feedback.count})
      </p>
      <div className={styles.feedbackControls}>
        <select value={rating} onChange={(event) => setRating(Number(event.target.value))} disabled={disabled}>
          <option value={5}>5 - Excellent</option>
          <option value={4}>4 - Good</option>
          <option value={3}>3 - Okay</option>
          <option value={2}>2 - Weak</option>
          <option value={1}>1 - Poor</option>
        </select>
        <button
          type="button"
          className="ghost-button"
          disabled={disabled}
          onClick={() => onSubmit(rating, comment)}
        >
          {disabled ? "Saving..." : "Save"}
        </button>
      </div>
      <textarea
        className={styles.feedbackComment}
        rows={2}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Optional thread-level feedback"
        disabled={disabled}
      />
    </div>
  );
}
