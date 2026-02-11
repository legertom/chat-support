import { useState } from "react";
import type { ThreadMessage } from "@/components/api-client";

export function MessageFeedbackBox({
  message,
  onSubmit,
  disabled,
}: {
  message: ThreadMessage;
  onSubmit: (rating: number, comment: string) => void;
  disabled: boolean;
}) {
  const [rating, setRating] = useState<number>(message.feedback.mine?.rating ?? 5);
  const [comment, setComment] = useState<string>(message.feedback.mine?.comment ?? "");

  return (
    <div className="feedback-box">
      <p className="feedback-title">Rate this response</p>
      <div className="feedback-controls">
        <select value={rating} onChange={(event) => setRating(Number(event.target.value))} disabled={disabled}>
          <option value={5}>5 - Excellent</option>
          <option value={4}>4 - Good</option>
          <option value={3}>3 - Okay</option>
          <option value={2}>2 - Weak</option>
          <option value={1}>1 - Incorrect</option>
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
        className="feedback-comment"
        rows={2}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Optional comment"
        disabled={disabled}
      />
    </div>
  );
}
