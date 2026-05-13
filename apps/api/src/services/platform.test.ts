import { describe, it, expect } from "bun:test";
import { platformAdminsFromEnv, isUpdateInProgress, readUpdateLog } from "./platform.ts";

describe("platformAdminsFromEnv", () => {
  it("returns an empty array when env is empty (default)", () => {
    expect(platformAdminsFromEnv()).toEqual([]);
  });
});

describe("isUpdateInProgress", () => {
  it("returns false when no lock file exists", () => {
    expect(isUpdateInProgress()).toBe(false);
  });
});

describe("readUpdateLog", () => {
  it("returns empty string when no log file exists", () => {
    expect(readUpdateLog()).toBe("");
  });
});
