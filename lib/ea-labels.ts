// Label tables for EA's numeric codes, for the bilingual UI and AI reports.
//
// PROVENANCE: the code -> English meaning mappings come from the proclubs-sdk@0.3.4 source
// (reference/proclubs-sdk/dist/metadata.js). We have NOT confirmed them against EA; only a few were
// consistent with our own samples (see notes). The Traditional Cantonese (zh) wording is our own
// translation and has not been reviewed by a native speaker. Unknown codes return null, never a guess.
//
// NOT covered because neither the SDK nor our samples explain them: matches `result`, overallStats
// `lastMatchN` codes (1 and 3 are only inferred), the loss code, proPos, proStyle, prevGoals.

export type Locale = "en" | "zh";
type Labels = Record<string, { en: string; zh: string }>;

function lookup(table: Labels, code: unknown, locale: Locale): string | null {
  if (code === null || code === undefined) return null;
  const key = String(code).trim();
  return Object.hasOwn(table, key) ? table[key][locale] : null;
}

/**
 * `currentDivision` / `bestDivision` (lower number = better). Our samples used "5" and "6", which map to
 * Division 4 and Division 5 here.
 */
const DIVISIONS: Labels = {
  "1": { en: "Elite", zh: "精英組" },
  "2": { en: "Division 1", zh: "第一組" },
  "3": { en: "Division 2", zh: "第二組" },
  "4": { en: "Division 3", zh: "第三組" },
  "5": { en: "Division 4", zh: "第四組" },
  "6": { en: "Division 5", zh: "第五組" },
};
export const divisionLabel = (code: unknown, locale: Locale) => lookup(DIVISIONS, code, locale);

/** `reputationtier`. */
const REPUTATION: Labels = {
  "0": { en: "Hometown Heroes", zh: "鄉里英雄" },
  "1": { en: "Emerging Stars", zh: "新星" },
  "2": { en: "Well Known", zh: "小有名氣" },
  "3": { en: "World Renown", zh: "世界知名" },
};
export const reputationLabel = (code: unknown, locale: Locale) => lookup(REPUTATION, code, locale);

/** `bestFinishGroup` / playoff results. */
const PLAYOFF_RESULT: Labels = {
  "1": { en: "Champion", zh: "冠軍" },
  "2": { en: "Runner-Up", zh: "亞軍" },
  "3": { en: "Competitive", zh: "具競爭力" },
  "4": { en: "Mid-Table", zh: "中游" },
  "5": { en: "Also-ran", zh: "未能入圍" },
  "6": { en: "Participant", zh: "參賽者" },
};
export const playoffResultLabel = (code: unknown, locale: Locale) => lookup(PLAYOFF_RESULT, code, locale);

/** Response `matchType` code. "1" matched our league-match sample. 3 and 5 are SDK-only. */
const MATCH_TYPE_CODES: Labels = {
  "1": { en: "League match", zh: "聯賽" },
  "3": { en: "Playoff match", zh: "季後賽" },
  "5": { en: "Friendly match", zh: "友誼賽" },
};
export const matchTypeCodeLabel = (code: unknown, locale: Locale) => lookup(MATCH_TYPE_CODES, code, locale);

/** Player `namespace` in match payloads (0 on friendlies, so unlabelled there). */
const PLATFORM_FAMILY: Labels = {
  "1": { en: "PlayStation", zh: "PlayStation" },
  "2": { en: "Xbox", zh: "Xbox" },
  "3": { en: "PC", zh: "PC" },
  "4": { en: "Nintendo", zh: "Nintendo" },
};
export const platformFamilyLabel = (code: unknown, locale: Locale) => lookup(PLATFORM_FAMILY, code, locale);

/** Position strings seen in our samples (`favoritePosition`, match `pos`, `positionCount` keys). */
const POSITIONS: Labels = {
  goalkeeper: { en: "Goalkeeper", zh: "守門員" },
  defender: { en: "Defender", zh: "後衛" },
  midfielder: { en: "Midfielder", zh: "中場" },
  forward: { en: "Forward", zh: "前鋒" },
};
export const positionLabel = (code: unknown, locale: Locale) => lookup(POSITIONS, code, locale);
