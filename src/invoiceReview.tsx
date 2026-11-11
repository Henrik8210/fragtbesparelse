import { useEffect, useState } from "react";
import { api } from "./api.ts";

export type ReviewState = "open" | "accepted";

export function useInvoiceReview(customerId: string) {
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});

  useEffect(() => {
    let cancel = false;
    api<{ reviews: Record<string, ReviewState> }>(`/api/companies/${customerId}/reviews`)
      .then((result) => {
        if (!cancel) setReviews(result.reviews);
      })
      .catch(() => {
        if (!cancel) setReviews({});
      });
    return () => {
      cancel = true;
    };
  }, [customerId]);

  function reviewFor(key: string, fallback: ReviewState): ReviewState {
    return reviews[key] ?? fallback;
  }

  function setReview(key: string, state: ReviewState) {
    setReviews((current) => ({ ...current, [key]: state }));
    void api(`/api/companies/${customerId}/reviews`, {
      method: "PUT",
      body: JSON.stringify({ key, state }),
    });
  }

  return { reviewFor, setReview };
}
