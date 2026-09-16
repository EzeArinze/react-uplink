import { describe, it, expect } from "vitest";
import { applyJitter, computeBackoffDelay } from "../src/utils/jitter";

describe("applyJitter", () => {
  it("returns 0 for a non-positive base", () => {
    expect(applyJitter(0)).toBe(0);
    expect(applyJitter(-100)).toBe(0);
  });

  it("stays within ±percent of the base value", () => {
    for (let i = 0; i < 200; i++) {
      const result = applyJitter(1000, 0.2);
      expect(result).toBeGreaterThanOrEqual(800);
      expect(result).toBeLessThanOrEqual(1200);
    }
  });

  it("clamps percent to [0, 1]", () => {
    for (let i = 0; i < 50; i++) {
      const result = applyJitter(1000, 5); // absurd percent, should clamp to 1
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(2000);
    }
  });
});

describe("computeBackoffDelay", () => {
  it("grows exponentially with attempt number, before capping", () => {
    // Use 0 jitter-equivalent by checking bounds loosely (jitter is ±20%)
    const attempt1 = computeBackoffDelay(1, 1000, 100000);
    const attempt2 = computeBackoffDelay(2, 1000, 100000);
    const attempt3 = computeBackoffDelay(3, 1000, 100000);

    // attempt1 ~1000 (800-1200), attempt2 ~2000 (1600-2400), attempt3 ~4000 (3200-4800)
    expect(attempt1).toBeLessThan(attempt2);
    expect(attempt2).toBeLessThan(attempt3);
  });

  it("never exceeds the cap, even accounting for jitter", () => {
    for (let i = 0; i < 50; i++) {
      const result = computeBackoffDelay(10, 1000, 5000);
      // cap is 5000, jitter can push it up to +20% of the capped value
      expect(result).toBeLessThanOrEqual(6000);
    }
  });

  it("treats attempt < 1 as attempt 1", () => {
    const a0 = computeBackoffDelay(0, 1000, 100000);
    const a1 = computeBackoffDelay(1, 1000, 100000);
    expect(a0).toBeGreaterThanOrEqual(800);
    expect(a1).toBeGreaterThanOrEqual(800);
  });
});
