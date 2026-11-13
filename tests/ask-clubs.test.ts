import { describe, expect, it } from "vitest";
import { addAskClub, askPath, formatAskClubs, parseAskClubs, removeAskClub } from "@/lib/ask-clubs";

describe("parseAskClubs (the URL is untrusted)", () => {
  it("reads club.platform pairs in order", () => {
    expect(parseAskClubs("914493.common-gen5,123.nx")).toEqual([{ clubId: "914493", platform: "common-gen5" }, { clubId: "123", platform: "nx" }]);
  });
  it("drops invalid entries but keeps the valid ones", () => {
    expect(parseAskClubs("abc.nx,5.common-gen4,.nx,5,7.nx,8.__proto__,9.nx<script>")).toEqual([{ clubId: "7", platform: "nx" }]);
  });
  it("collapses duplicates and caps the list at 4", () => {
    expect(parseAskClubs("1.nx,1.nx,1.common-gen5")).toHaveLength(2);
    expect(parseAskClubs("1.nx,2.nx,3.nx,4.nx,5.nx,6.nx").map((c) => c.clubId)).toEqual(["1", "2", "3", "4"]);
  });
  it("returns an empty list for anything that is not text", () => {
    for (const v of [undefined, null, 5, [], {}, ["1.nx"], ""]) expect(parseAskClubs(v), String(v)).toEqual([]);
  });
  it("ignores everything after 400 characters instead of working through a huge value", () => {
    expect(parseAskClubs("1.nx," + "x".repeat(2000) + ",2.nx")).toEqual([{ clubId: "1", platform: "nx" }]);
  });
});

describe("add, remove and paths", () => {
  const a = { clubId: "1", platform: "nx" };
  const b = { clubId: "2", platform: "nx" };
  it("adds a club once, and says when the list is full", () => {
    expect(addAskClub([a], b)).toEqual({ clubs: [a, b], added: true, full: false });
    expect(addAskClub([a], a)).toEqual({ clubs: [a], added: false, full: false });
    const four = [1, 2, 3, 4].map((i) => ({ clubId: String(i), platform: "nx" }));
    expect(addAskClub(four, { clubId: "9", platform: "nx" })).toEqual({ clubs: four, added: false, full: true });
  });
  it("the same id on another platform is another club", () => {
    expect(addAskClub([a], { clubId: "1", platform: "common-gen5" }).added).toBe(true);
  });
  it("removes only the matching club", () => {
    expect(removeAskClub([a, b], a)).toEqual([b]);
    expect(removeAskClub([a], b)).toEqual([a]);
  });
  it("round-trips through the URL, and an empty list goes to the bare page", () => {
    expect(parseAskClubs(decodeURIComponent(askPath([a, b]).split("clubs=")[1]))).toEqual([a, b]);
    expect(formatAskClubs([a, b])).toBe("1.nx,2.nx");
    expect(askPath([])).toBe("/analysis");
  });
});
