import { describe, expect, it } from "vitest";
import { COMMON, DEFAULT_LANG, LANGS, fill, htmlLang, isLang, otherLang, parseLang, pick, safeBack } from "@/lib/i18n";

describe("language choice", () => {
  it("Cantonese is the default, and only the two supported languages are accepted", () => {
    expect(DEFAULT_LANG).toBe("zh");
    expect([...LANGS]).toEqual(["zh", "en"]);
    for (const v of ["zh", "en"]) expect(isLang(v)).toBe(true);
    for (const v of ["", "fr", "EN", "zh-HK", null, undefined, 5, [], {}, "__proto__"]) expect(isLang(v), String(v)).toBe(false);
  });
  it("parseLang falls back to Cantonese for anything else", () => {
    expect(parseLang("en")).toBe("en");
    expect(parseLang("zh")).toBe("zh");
    for (const v of ["", "fr", "EN", null, undefined, 5, "<script>"]) expect(parseLang(v), String(v)).toBe("zh");
  });
  it("the html lang attribute and the other language", () => {
    expect(htmlLang("zh")).toBe("zh-HK");
    expect(htmlLang("en")).toBe("en");
    expect(otherLang("zh")).toBe("en");
    expect(otherLang("en")).toBe("zh");
  });
  it("pick returns exactly one side", () => {
    expect(pick({ en: "Search", zh: "搜尋" }, "en")).toBe("Search");
    expect(pick({ en: "Search", zh: "搜尋" }, "zh")).toBe("搜尋");
  });
});

describe("fill", () => {
  it("replaces named placeholders, repeats, and leaves unknown ones visible", () => {
    expect(fill("{a} and {b} and {a}", { a: 1, b: "x" })).toBe("1 and x and 1");
    expect(fill("hello {missing}", { a: 1 })).toBe("hello {missing}");
    expect(fill("no placeholders")).toBe("no placeholders");
  });
  it("does not treat inherited object keys as values", () => {
    expect(fill("{toString} {constructor}", {})).toBe("{toString} {constructor}");
  });
});

describe("safeBack (the Referer header is untrusted)", () => {
  const origin = "https://app.example.com";
  it("returns to the page the visitor was on, with its query", () => {
    expect(safeBack("https://app.example.com/analysis?clubs=1.nx", origin)).toBe("/analysis?clubs=1.nx");
    expect(safeBack("https://app.example.com/", origin)).toBe("/");
  });
  it("goes home for a missing, junk or other-site referer", () => {
    for (const r of [null, undefined, "", "not a url", "https://evil.example.com/x", "http://app.example.com/x", "javascript:alert(1)", "https://app.example.com.evil.com/"]) {
      expect(safeBack(r, origin), String(r)).toBe("/");
    }
  });
  it("never loops back onto the switch route", () => {
    expect(safeBack("https://app.example.com/lang?to=en", origin)).toBe("/");
  });
  it("never returns a protocol-relative or absolute URL", () => {
    for (const r of ["https://app.example.com//evil.com/x", "https://app.example.com/\\evil.com"]) {
      const out = safeBack(r, origin);
      expect(out.startsWith("//"), r).toBe(false);
      expect(out.startsWith("/"), r).toBe(true);
    }
  });
});

describe("shared strings", () => {
  it("every shared string has both languages and no placeholder braces", () => {
    for (const [k, v] of Object.entries(COMMON)) {
      expect(v.en.length, k).toBeGreaterThan(0);
      expect(v.zh.length, k).toBeGreaterThan(0);
      expect(v.en + v.zh, k).not.toMatch(/[{}]/);
    }
  });
  it("the language switch shows the OTHER language's name", () => {
    expect(COMMON.switchTo.zh).toBe("English");
    expect(COMMON.switchTo.en).toBe("中文");
  });
});

import * as UI from "@/lib/ui-text";
import { describeHomeError, waitText } from "@/lib/public-text";
import { METRIC_LABEL, BOARD_LABEL } from "@/lib/club-compare";

const hasChinese = (s: string) => /[㐀-鿿]/.test(s);
const hasLatinWord = (s: string) => /[A-Za-z]{4,}/.test(s);

describe("every page string has both languages (the app shows ONE language, so a gap would show as blank text)", () => {
  for (const [group, strings] of Object.entries(UI)) {
    for (const [key, v] of Object.entries(strings as Record<string, { en: string; zh: string }>)) {
      it(`${group}.${key}`, () => {
        expect(typeof v.en).toBe("string");
        expect(typeof v.zh).toBe("string");
        expect(v.en.trim().length, "en empty").toBeGreaterThan(0);
        expect(v.zh.trim().length, "zh empty").toBeGreaterThan(0);
        // placeholders must match between languages, or one language would show a raw {name}
        const ph = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
        expect(ph(v.zh), "placeholders differ").toBe(ph(v.en));
      });
    }
  }
});

describe("the Cantonese side is Chinese and the English side is not mixed with it", () => {
  it("every English string has no Chinese characters", () => {
    for (const [group, strings] of Object.entries(UI)) {
      for (const [key, v] of Object.entries(strings as Record<string, { en: string; zh: string }>)) {
        // the language switch label is the one place English text shows the other language's NAME
        if (group === "COMMON") continue;
        expect(hasChinese(v.en), `${group}.${key}`).toBe(false);
      }
    }
  });
  it("every Cantonese string with real words contains Chinese (not just an English copy)", () => {
    const allowedEnglishOnly = new Set(["HOME.platformNx", "CLUB.platformNx", "CLUB.platformGen5", "ASK.langEn", "MEMBER_COLS.motm"]);
    for (const [group, strings] of Object.entries(UI)) {
      for (const [key, v] of Object.entries(strings as Record<string, { en: string; zh: string }>)) {
        if (allowedEnglishOnly.has(`${group}.${key}`)) continue;
        if (hasLatinWord(v.en) && v.zh === v.en) throw new Error(`${group}.${key} is not translated`);
      }
    }
  });
});

describe("existing wording tables used by the pages", () => {
  it("home errors and wait text give one language each", () => {
    const e = describeHomeError("none")!;
    expect(hasChinese(e.zh)).toBe(true);
    expect(hasChinese(e.en)).toBe(false);
    expect(waitText(45).zh).toBe("45 秒");
  });
  it("metric and board labels exist in both languages", () => {
    for (const v of [...Object.values(METRIC_LABEL), ...Object.values(BOARD_LABEL)]) {
      expect(v.en.length).toBeGreaterThan(0);
      expect(hasChinese(v.zh)).toBe(true);
    }
  });
});

import { ACCOUNT, initialsOf } from "@/lib/i18n";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("app name (user decision 2026-11-13)", () => {
  it("is 'ProClubs 速查' in Cantonese and 'ProClubs Tracker' in English", () => {
    expect(COMMON.brand.zh).toBe("ProClubs 速查");
    expect(COMMON.brand.en).toBe("ProClubs Tracker");
  });
  it("the old name is gone from the app and the progress pages", () => {
    const read = (f: string) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), "utf8");
    for (const f of ["lib/i18n.ts", "progress-render.js", "progress.en.html", "progress.zh-HK.html", "app/layout.tsx"]) {
      expect(read(f), f).not.toMatch(/FC 2X|Statistic Tracker|球會追蹤|數據追蹤器/);
    }
  });
});

describe("initialsOf (avatar fallback)", () => {
  it("one character for a Chinese name, two capital letters otherwise", () => {
    expect(initialsOf("陳大文")).toBe("陳");
    expect(initialsOf("charles chan")).toBe("CH");
    expect(initialsOf("x")).toBe("X");
  });
  it("falls back to the email, then to a question mark", () => {
    expect(initialsOf(null, "ab@example.com")).toBe("AB");
    expect(initialsOf("   ", "zz@example.com")).toBe("ZZ");
    expect(initialsOf(null, null)).toBe("?");
    expect(initialsOf("", "")).toBe("?");
  });
});

describe("account menu text", () => {
  it("has both languages, the sign-out label is a real translation, and nothing has placeholders", () => {
    for (const [k, v] of Object.entries(ACCOUNT)) {
      expect(v.en.length, k).toBeGreaterThan(0);
      expect(/[㐀-鿿]/.test(v.zh), k).toBe(true);
      expect(/[㐀-鿿]/.test(v.en), k).toBe(false);
      expect(v.en + v.zh).not.toMatch(/[{}]/);
    }
    expect(ACCOUNT.signOut.en).toBe("Sign out");
  });
});

describe("header layout (read from source: pages are not rendered in tests)", () => {
  const read = (f: string) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), "utf8");
  const header = read("components/SiteHeader.tsx");
  it("the language switch and the account control sit together in the right-hand group", () => {
    const right = header.slice(header.indexOf('className="header-right"'));
    expect(right).toMatch(/lang-switch/);
    expect(right).toMatch(/AccountMenu/);
    expect(right).toMatch(/signin-link/);
    expect(right.indexOf("lang-switch")).toBeLessThan(right.indexOf("AccountMenu"));
  });
  it("Sign out is inside the account menu, not in the header itself", () => {
    expect(read("components/AccountMenu.tsx")).toMatch(/ACCOUNT\.signOut/);
    expect(header).not.toMatch(/ACCOUNT\.signOut/);
  });
  it("a signed-out visitor sees a Sign in link only when login is configured", () => {
    expect(header).toMatch(/authConfigured\(\) \? \(\s*<form action=\{signInAction\}>\s*<button type="submit" className="signin-link"/);
  });
  it("the account page no longer has its own Sign out (it lives in the menu)", () => {
    expect(read("app/profile/page.tsx")).not.toMatch(/signOut|PROFILE\.signOut/);
  });
});

import { LINES } from "@/lib/ui-text";
describe("line chart wording", () => {
  it("has both languages, English without Chinese, and the placeholder matches", () => {
    for (const [k, v] of Object.entries(LINES)) {
      expect(v.en.length, k).toBeGreaterThan(0);
      expect(v.zh.length, k).toBeGreaterThan(0);
      expect(/[\u3400-\u9fff]/.test(v.en), k).toBe(false);
    }
    expect(LINES.hiddenCount.en).toContain("{n}");
    expect(LINES.hiddenCount.zh).toContain("{n}");
    expect(/[\u3400-\u9fff]/.test(LINES.tapHint.zh)).toBe(true);
  });
});
