// http-buckets.ts — the latency histogram bucket boundaries (milliseconds) the API's HTTP metrics write and the Super
// Admin latency report reads (Constitution 11 §44; Constitution 13: one definition both sides share).
export const MS_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
