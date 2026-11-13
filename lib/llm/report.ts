// The ONLY shape an LLM answer may take, plus a strict validator. Model output is untrusted text: it is
// parsed as JSON, checked field by field, clamped and returned as plain strings/numbers. We never render
// model-written HTML, links or script; our own fixed components draw the report.
// Strictness rule: anything outside the schema is rejected, not "repaired".

export const REPORT_VERSION = 1;
export const SECTION_KINDS = ["summary", "findings", "player_changes", "caveats"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export interface ReportSection {
  kind: SectionKind;
  title: string;
  items: string[];
}

export interface ReportTable {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface ReportChart {
  title: string;
  /** "bar": one number per label. */
  kind: "bar";
  unit: string;
  labels: string[];
  values: number[];
}

export interface Report {
  version: typeof REPORT_VERSION;
  /** "en" or "zh" (Traditional Cantonese) as requested. */
  language: "en" | "zh";
  headline: string;
  sections: ReportSection[];
  tables: ReportTable[];
  charts: ReportChart[];
  /** True if the model says the data was too thin for real conclusions. */
  insufficientData: boolean;
}

export type ReportResult = { ok: true; report: Report } | { ok: false; error: string };

const LIMITS = {
  headline: 200,
  title: 120,
  item: 600,
  cell: 120,
  unit: 24,
  sections: 6,
  items: 8,
  tables: 3,
  columns: 8,
  rows: 30,
  charts: 3,
  points: 30,
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Plain text only. Rejects markup characters so a rendered string can never become HTML or a link. */
function text(v: unknown, max: number, what: string, errors: string[], allowEmpty = false): string {
  if (typeof v !== "string") {
    errors.push(`${what} must be a string`);
    return "";
  }
  const t = v.replace(/\s+/g, " ").trim();
  if (t === "" && !allowEmpty) errors.push(`${what} must not be empty`);
  if (t.length > max) errors.push(`${what} is longer than ${max} characters`);
  if (/[<>]/.test(t) || /\bjavascript:/i.test(t)) errors.push(`${what} contains markup`);
  return t.slice(0, max);
}

function arr(v: unknown, max: number, what: string, errors: string[]): unknown[] {
  if (!Array.isArray(v)) {
    errors.push(`${what} must be an array`);
    return [];
  }
  if (v.length > max) errors.push(`${what} has more than ${max} entries`);
  return v.slice(0, max);
}

/** Pulls the first top-level JSON object out of text that may be wrapped in ```json fences or prose. */
export function extractJson(raw: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = (fence ? fence[1] : raw).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the outermost braces.
    const a = candidate.indexOf("{");
    const b = candidate.lastIndexOf("}");
    if (a === -1 || b <= a) throw new Error("no JSON object found");
    return JSON.parse(candidate.slice(a, b + 1));
  }
}

export function parseReport(raw: string, expectedLanguage: "en" | "zh"): ReportResult {
  let value: unknown;
  try {
    value = extractJson(raw);
  } catch {
    return { ok: false, error: "model output was not valid JSON" };
  }
  if (!isObj(value)) return { ok: false, error: "model output was not a JSON object" };

  const errors: string[] = [];
  const headline = text(value.headline, LIMITS.headline, "headline", errors);

  const sections = arr(value.sections, LIMITS.sections, "sections", errors).map((s, i): ReportSection => {
    if (!isObj(s)) {
      errors.push(`sections[${i}] must be an object`);
      return { kind: "summary", title: "", items: [] };
    }
    const kind = s.kind;
    if (typeof kind !== "string" || !(SECTION_KINDS as readonly string[]).includes(kind)) {
      errors.push(`sections[${i}].kind must be one of ${SECTION_KINDS.join(", ")}`);
    }
    return {
      kind: (SECTION_KINDS as readonly string[]).includes(kind as string) ? (kind as SectionKind) : "summary",
      title: text(s.title, LIMITS.title, `sections[${i}].title`, errors),
      items: arr(s.items, LIMITS.items, `sections[${i}].items`, errors).map((it, j) => text(it, LIMITS.item, `sections[${i}].items[${j}]`, errors)),
    };
  });

  const tables = arr(value.tables ?? [], LIMITS.tables, "tables", errors).map((t, i): ReportTable => {
    if (!isObj(t)) {
      errors.push(`tables[${i}] must be an object`);
      return { title: "", columns: [], rows: [] };
    }
    const columns = arr(t.columns, LIMITS.columns, `tables[${i}].columns`, errors).map((c, j) => text(c, LIMITS.cell, `tables[${i}].columns[${j}]`, errors));
    const rows = arr(t.rows, LIMITS.rows, `tables[${i}].rows`, errors).map((r, j) => {
      const cells = arr(r, LIMITS.columns, `tables[${i}].rows[${j}]`, errors).map((c, k) => {
        // Cells may be numbers (convenient for the model) but are stored as text.
        const s = typeof c === "number" && Number.isFinite(c) ? String(c) : c;
        return text(s, LIMITS.cell, `tables[${i}].rows[${j}][${k}]`, errors, true);
      });
      if (cells.length !== columns.length) errors.push(`tables[${i}].rows[${j}] has ${cells.length} cells but there are ${columns.length} columns`);
      return cells;
    });
    return { title: text(t.title, LIMITS.title, `tables[${i}].title`, errors), columns, rows };
  });

  const charts = arr(value.charts ?? [], LIMITS.charts, "charts", errors).map((c, i): ReportChart => {
    if (!isObj(c)) {
      errors.push(`charts[${i}] must be an object`);
      return { title: "", kind: "bar", unit: "", labels: [], values: [] };
    }
    if (c.kind !== "bar") errors.push(`charts[${i}].kind must be "bar"`);
    const labels = arr(c.labels, LIMITS.points, `charts[${i}].labels`, errors).map((l, j) => text(l, LIMITS.cell, `charts[${i}].labels[${j}]`, errors));
    const values = arr(c.values, LIMITS.points, `charts[${i}].values`, errors).map((n, j) => {
      if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e9) {
        errors.push(`charts[${i}].values[${j}] must be a finite number`);
        return 0;
      }
      return n;
    });
    if (labels.length !== values.length) errors.push(`charts[${i}] has ${labels.length} labels but ${values.length} values`);
    return { title: text(c.title, LIMITS.title, `charts[${i}].title`, errors), kind: "bar", unit: text(c.unit ?? "", LIMITS.unit, `charts[${i}].unit`, errors, true), labels, values };
  });

  if (value.language !== expectedLanguage) errors.push(`language must be "${expectedLanguage}"`);
  if (typeof value.insufficientData !== "boolean") errors.push("insufficientData must be true or false");
  if (sections.length === 0) errors.push("sections must not be empty");

  if (errors.length > 0) return { ok: false, error: errors.slice(0, 6).join("; ") };
  return {
    ok: true,
    report: {
      version: REPORT_VERSION,
      language: expectedLanguage,
      headline,
      sections,
      tables,
      charts,
      insufficientData: value.insufficientData as boolean,
    },
  };
}
