// The stylesheet's colours are tokens in light and dark. Nothing renders pages in tests, so these checks guard what
// can be computed: text stays readable (WCAG contrast) in both themes, and no page hard-codes a colour.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const css = readFileSync(root + "app/globals.css", "utf8");

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
const lightBlock = css.slice(css.indexOf(":root"), css.indexOf("@media (prefers-color-scheme: dark)"));
const darkBlock = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("* { box-sizing"));
const light = tokens(lightBlock);
const dark = { ...light, ...tokens(darkBlock) };

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("contrast (WCAG AA: 4.5 for text)", () => {
  const pairs: Array<[string, string, number]> = [
    ["text", "bg", 4.5], ["text", "card", 4.5], ["muted", "bg", 4.5], ["muted", "card", 4.5],
    ["accent-text", "accent", 4.5], ["accent", "card", 4.5], ["accent", "bg", 4.5],
    ["warn", "warn-bg", 4.5], ["text", "warn-bg", 4.5], ["err", "card", 4.5], ["err", "bg", 4.5], ["text", "err-bg", 4.5], ["text", "accent-soft", 4.5],
    ["warn", "card", 4.5], ["accent", "accent-soft", 4.5],
  ];
  // Chart bars are graphics, not text: WCAG asks 3:1 against what they sit on. They sit on the soft track inside a card.
  const bars: Array<[string, string, number]> = [["bar", "accent-soft", 3], ["bar-2", "accent-soft", 3], ["bar-3", "accent-soft", 3], ["bar", "card", 3], ["bar-2", "card", 3], ["bar-3", "card", 3]];
  for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
    for (const [fg, bg, min] of bars) {
      it(`${name}: chart colour ${fg} on ${bg} (3:1)`, () => {
        expect(theme[fg], `missing token ${fg}`).toBeTruthy();
        expect(ratio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(min);
      });
    }
  }
  // Line charts: eight colours, each also has its own marker shape. A line or marker is a graphic, so 3:1 against the card.
  for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
    for (let i = 1; i <= 8; i++) {
      it(`${name}: line colour ${i} on the card (3:1)`, () => {
        expect(theme[`line-${i}`], `missing token line-${i}`).toBeTruthy();
        expect(ratio(theme[`line-${i}`], theme["card"])).toBeGreaterThanOrEqual(3);
      });
    }
    it(`${name}: the eight line colours are all different, and the grid is visible but quiet`, () => {
      expect(new Set(Array.from({ length: 8 }, (_, k) => theme[`line-${k + 1}`])).size).toBe(8);
      expect(ratio(theme["grid"], theme["card"])).toBeGreaterThan(1.1);
      expect(ratio(theme["grid"], theme["card"])).toBeLessThan(3);
    });
  }
  it("the three series colours are clearly different from each other in both themes", () => {
    for (const theme of [light, dark]) {
      expect(ratio(theme["bar"], theme["bar-2"])).toBeGreaterThan(1.05);
      expect(ratio(theme["bar"], theme["bar-3"])).toBeGreaterThan(1.05);
      expect(new Set([theme["bar"], theme["bar-2"], theme["bar-3"]]).size).toBe(3);
    }
  });
  for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
    for (const [fg, bg, min] of pairs) {
      it(`${name}: ${fg} on ${bg}`, () => {
        expect(theme[fg], `missing token ${fg}`).toBeTruthy();
        expect(theme[bg], `missing token ${bg}`).toBeTruthy();
        expect(ratio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(min);
      });
    }
  }
  it("the contrast helper itself is right (black on white is 21:1)", () => {
    expect(Math.round(ratio("#000000", "#ffffff"))).toBe(21);
    expect(ratio("#777777", "#777777")).toBeCloseTo(1, 5);
  });
});

describe("the dark theme overrides every colour token that light defines", () => {
  it("no colour is left light-only", () => {
    const darkOnly = tokens(darkBlock);
    const shared = Object.keys(light).filter((k) => !["radius", "shadow"].includes(k));
    const missing = shared.filter((k) => !(k in darkOnly));
    expect(missing).toEqual([]);
  });
});

describe("pages do not hard-code colours", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = dir + "/" + f;
      return statSync(p).isDirectory() ? files(p) : /\.(tsx|ts)$/.test(f) ? [p] : [];
    });
  }
  it("no hex colour appears in app/ or components/ source", () => {
    const hits = [...files(root + "app"), ...files(root + "components")].filter((f) => /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/.test(readFileSync(f, "utf8").replace(/&#\d+;/g, "")));
    expect(hits).toEqual([]);
  });
  it("the mobile layout rules exist (single column, tables scroll)", () => {
    expect(css).toMatch(/@media \(max-width: 600px\)/);
    expect(css).toMatch(/\.tablewrap \{[^}]*overflow-x: auto/);
  });
});
