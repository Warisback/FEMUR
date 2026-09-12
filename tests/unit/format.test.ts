import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatUsdc,
  shortAddress,
  shortHash,
} from "@/lib/format";

describe("formatUsdc", () => {
  it("always shows at least two decimals", () => {
    expect(formatUsdc(0.5)).toBe("0.50");
    expect(formatUsdc(20)).toBe("20.00");
    expect(formatUsdc("1.1")).toBe("1.10");
  });

  it("keeps up to seven decimals, trimming trailing zeros", () => {
    expect(formatUsdc("0.1234567")).toBe("0.1234567");
    expect(formatUsdc(0.123456789)).toBe("0.1234568");
    expect(formatUsdc("2.500000")).toBe("2.50");
  });

  it("falls back to 0.00 on garbage", () => {
    expect(formatUsdc("not a number")).toBe("0.00");
    expect(formatUsdc(Number.NaN)).toBe("0.00");
  });
});

describe("shortAddress / shortHash", () => {
  const address = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";
  const hash =
    "9f3ab21c64de0a9b7f5c83d12e46fa07b9d05c31a8e2f74d60b19c85e372c21e";

  it("keeps the first and last four characters", () => {
    expect(shortAddress(address)).toBe("GDQN…KTL3");
    expect(shortHash(hash)).toBe("9f3a…c21e");
  });

  it("leaves short strings alone", () => {
    expect(shortAddress("GABC")).toBe("GABC");
    expect(shortHash("9f3a")).toBe("9f3a");
  });
});

describe("formatDuration", () => {
  it("shows one decimal under ten seconds", () => {
    expect(formatDuration(5800)).toBe("5.8 s");
    expect(formatDuration(9990)).toBe("10.0 s");
  });

  it("rounds to whole seconds from ten up", () => {
    expect(formatDuration(16000)).toBe("16 s");
    expect(formatDuration(16400)).toBe("16 s");
    expect(formatDuration(16600)).toBe("17 s");
  });
});
