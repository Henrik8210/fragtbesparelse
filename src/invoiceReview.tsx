import { useEffect, useState } from "react";

const STORAGE_KEY = "fairlane-invoice-review";

export type ReviewState = "open" | "accepted";

type ReviewStore = Record<string, Record<string, ReviewState>>;

function readCustomer(customerId: string): Record<string, ReviewState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const entry = (parsed as Record<string, unknown>)[customerId];
    if (!entry || typeof entry !== "object") return {};
    const reviews: Record<string, ReviewState> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (value === "open" || value === "accepted") reviews[key] = value;
    }
    return reviews;
  } catch {
    return {};
  }
}

function writeCustomer(customerId: string, reviews: Record<string, ReviewState>) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const store: ReviewStore = parsed && typeof parsed === "object" ? (parsed as ReviewStore) : {};
    store[customerId] = reviews;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // The review still shows for this visit if storage is unavailable.
  }
}

export function useInvoiceReview(customerId: string) {
  const [reviews, setReviews] = useState<Record<string, ReviewState>>(() => readCustomer(customerId));

  useEffect(() => {
    writeCustomer(customerId, reviews);
  }, [customerId, reviews]);

  function reviewFor(key: string, fallback: ReviewState): ReviewState {
    return reviews[key] ?? fallback;
  }

  function setReview(key: string, state: ReviewState) {
    setReviews((current) => ({ ...current, [key]: state }));
  }

  return { reviewFor, setReview };
}
