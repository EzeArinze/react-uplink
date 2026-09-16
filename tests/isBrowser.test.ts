import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getRawBrowserOnline,
  isBrowser,
  isDocumentHidden,
} from "../src/utils/isBrowser";

describe("isBrowser", () => {
  it("returns true in jsdom test environment", () => {
    expect(isBrowser()).toBe(true);
  });
});

describe("getRawBrowserOnline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reflects navigator.onLine when true", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    expect(getRawBrowserOnline()).toBe(true);
  });

  it("reflects navigator.onLine when false", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(getRawBrowserOnline()).toBe(false);
  });
});

describe("isDocumentHidden", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reflects document.hidden", () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    expect(isDocumentHidden()).toBe(true);
  });
});
