import {
  cleanTitle,
  extractYear,
  normalizeImdbId,
  normalizeLetterboxdUri,
  normalizeRewatch,
  normalizeTmdbId,
  normalizeWatchedDate,
  parseRatingValue,
  type ExportColumn,
  type LetterboxdRow,
} from "./csv";

export type TokenRole =
  | "ignore"
  | "title"
  | "year"
  | "rating"
  | "rating10"
  | "watchedDate"
  | "watchedDay"
  | "directors"
  | "tags"
  | "review"
  | "imdbID"
  | "tmdbID"
  | "letterboxdURI"
  | "rewatch";

export const TOKEN_ROLES: { id: TokenRole; label: string; hint: string }[] = [
  { id: "ignore", label: "Ignore", hint: "Skip this part" },
  { id: "title", label: "Title", hint: "Film name" },
  { id: "year", label: "Year", hint: "Release year YYYY" },
  { id: "rating", label: "Rating 0.5–5", hint: "Letterboxd stars" },
  { id: "rating10", label: "Rating 1–10", hint: "Out of ten" },
  { id: "watchedDate", label: "Watched date", hint: "Full date" },
  {
    id: "watchedDay",
    label: "Watched day only",
    hint: "Just the day number (1–31)",
  },
  { id: "directors", label: "Directors", hint: "Director name(s)" },
  { id: "tags", label: "Tags", hint: "Comma-separated tags" },
  { id: "review", label: "Review", hint: "Review / notes text" },
  { id: "imdbID", label: "imdbID", hint: "tt1234567" },
  { id: "tmdbID", label: "tmdbID", hint: "Numeric TMDB id" },
  { id: "letterboxdURI", label: "Letterboxd URI", hint: "boxd.it/…" },
  { id: "rewatch", label: "Rewatch", hint: "true / false" },
];

export type SplitMode =
  | "auto"
  | "comma"
  | "semicolon"
  | "tab"
  | "pipe"
  | "space"
  | "regex";

export interface AdvancedToken {
  index: number;
  raw: string;
  role: TokenRole;
  suggested: TokenRole;
}

export interface TokenizeResult {
  lines: string[][];
  tokensFromFirst: AdvancedToken[];
  headerSkipped: boolean;
  headerCells: string[];
}

function emptyRow(): LetterboxdRow {
  return {
    letterboxdUri: "",
    tmdbId: "",
    imdbId: "",
    title: "",
    year: "",
    directors: "",
    rating: "",
    rating10: "",
    watchedDate: "",
    rewatch: "",
    tags: "",
    review: "",
  };
}

/* ---------------- header awareness ---------------- */

const HEADER_ROLE_PATTERNS: [RegExp, TokenRole][] = [
  [/(letterboxd|boxd|uri|url|link)/i, "letterboxdURI"],
  [/(tmdb|themoviedb)/i, "tmdbID"],
  [/(imdb|const)/i, "imdbID"],
  [/rewatch/i, "rewatch"],
  [/(watch|diary|log|view|rated)/i, "watchedDate"],
  [/year/i, "year"],
  [/(date|release|premiere)/i, "watchedDate"],
  [/(director|directed|filmmaker)/i, "directors"],
  [/(tag|genre|label|keyword)/i, "tags"],
  [/(review|note|comment|description)/i, "review"],
  [/(rating\s*10|score|out of 10|vote)/i, "rating10"],
  [/(rating|star|rate)/i, "rating"],
  [/(title|name|film|movie)/i, "title"],
];

export function roleFromHeader(header: string): TokenRole | null {
  if (!header || !header.trim()) return null;
  for (const [re, role] of HEADER_ROLE_PATTERNS) {
    if (re.test(header)) return role;
  }
  return null;
}

/** A row like "Title,Year,Rating" — words only, matching known field names */
export function looksLikeHeaderRow(cells: string[]): boolean {
  const nonEmpty = cells.filter((c) => c.trim());
  if (nonEmpty.length === 0) return false;
  const matches = nonEmpty.filter((c) => roleFromHeader(c) !== null).length;
  const hasNumeric = nonEmpty.some((c) =>
    /^(?:\d+(?:\.\d+)?|(?:19|20)\d{2})$/.test(c.trim())
  );
  return (
    matches >= 1 && matches >= Math.ceil(nonEmpty.length * 0.5) && !hasNumeric
  );
}

/* ---------------- value guessing ---------------- */

export function isDayOnlyToken(value: string): boolean {
  const v = value.trim();
  if (!/^\d{1,2}$/.test(v)) return false;
  const n = parseInt(v, 10);
  return n >= 1 && n <= 31;
}

export function isYearToken(value: string): boolean {
  return /^(?:19|20)\d{2}$/.test(value.trim());
}

export function guessTokenRole(
  value: string,
  index: number,
  all: string[]
): TokenRole {
  const v = value.trim();
  if (!v) return "ignore";

  if (/tt\d{7,}/i.test(v)) return "imdbID";
  if (/boxd\.it|letterboxd\.com/i.test(v)) return "letterboxdURI";
  if (normalizeWatchedDate(v)) return "watchedDate";
  if (isYearToken(v)) return "year";

  if (/[★⭐]/.test(v) || /^\d+(?:\.\d+)?\s*\/\s*[510]$/.test(v)) return "rating";

  if (/^\d+(?:\.\d+)?$/.test(v)) {
    const n = parseFloat(v);
    // Bare integers 1–31 → watched day (per user rule: "11" means a day)
    if (Number.isInteger(n) && isDayOnlyToken(v) && !v.includes(".")) {
      return "watchedDay";
    }
    if (n > 0 && n <= 5) return "rating";
    if (n > 5 && n <= 10) return "rating10";
    if (n > 10 && String(Math.floor(n)).length <= 6) return "tmdbID";
  }

  if (/^(true|false|yes|no|rewatch)$/i.test(v)) return "rewatch";

  if (/[a-zA-Z]{2,}/.test(v)) {
    const textIdx = all.findIndex((t) => /[a-zA-Z]{2,}/.test(t));
    if (textIdx === index) return "title";
    if (v.length > 40) return "review";
    return "directors";
  }

  return "ignore";
}

/* ---------------- splitting ---------------- */

export function splitLine(
  line: string,
  mode: SplitMode,
  regexSource = ""
): string[] {
  const s = line.replace(/^\uFEFF/, "").trim();
  if (!s) return [];

  if (mode === "regex" && regexSource) {
    try {
      return s
        .split(new RegExp(regexSource))
        .map((t) => t.trim())
        .filter(Boolean);
    } catch {
      return [s];
    }
  }

  if (mode === "comma") return splitCsvish(s, ",");
  if (mode === "semicolon") return splitCsvish(s, ";");
  if (mode === "tab")
    return s
      .split("\t")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  if (mode === "pipe")
    return s
      .split("|")
      .map((t) => t.trim())
      .filter(Boolean);
  if (mode === "space")
    return s
      .split(/\s{2,}|\t+/)
      .map((t) => t.trim())
      .filter(Boolean);

  // auto-detect
  if (s.includes("\t"))
    return s
      .split("\t")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  const semi = (s.match(/;/g) || []).length;
  const comma = (s.match(/,/g) || []).length;
  if (semi >= 1 && semi >= comma) return splitCsvish(s, ";");
  if (comma >= 1) return splitCsvish(s, ",");
  if (s.includes("|"))
    return s
      .split("|")
      .map((t) => t.trim())
      .filter(Boolean);
  if (/\s{2,}/.test(s))
    return s
      .split(/\s{2,}/)
      .map((t) => t.trim())
      .filter(Boolean);
  return splitFreeform(s);
}

function splitCsvish(line: string, delim: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const n = line[i + 1];
    if (inQuotes) {
      if (c === '"' && n === '"') {
        current += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      fields.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  fields.push(current.trim());
  return fields.filter((f, i) => f.length > 0 || i === 0);
}

function splitFreeform(s: string): string[] {
  const parts: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    parts.push((m[1] ?? m[2]).trim());
  }
  return parts.filter(Boolean);
}

/* ---------------- tokenizing ---------------- */

export function tokenizeLines(
  text: string,
  mode: SplitMode,
  regexSource = ""
): TokenizeResult {
  const all = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => splitLine(l, mode, regexSource));

  if (all.length === 0) {
    return { lines: [], tokensFromFirst: [], headerSkipped: false, headerCells: [] };
  }

  // Skip a header row (e.g. "Title,Year,Rating") so it never becomes a film
  let headerCells: string[] = [];
  let headerSkipped = false;
  let lines = all;
  if (all.length > 1 && looksLikeHeaderRow(all[0])) {
    headerCells = all[0];
    lines = all.slice(1);
    headerSkipped = true;
  }

  if (lines.length === 0) {
    return { lines, tokensFromFirst: [], headerSkipped, headerCells };
  }

  const width = Math.max(
    ...lines.map((l) => l.length),
    headerCells.length
  );

  const tokens: AdvancedToken[] = [];
  for (let i = 0; i < width; i++) {
    const values = lines.map((l) => l[i] ?? "").filter(Boolean);
    const headerName = headerCells[i] ?? "";
    const guessSource = values[0] ?? "";
    const allForGuess = values.length ? values : [guessSource];

    const fromHeader = headerSkipped ? roleFromHeader(headerName) : null;
    let suggested: TokenRole;
    if (fromHeader) {
      suggested = fromHeader;
    } else {
      suggested = guessTokenRole(guessSource, i, allForGuess);
      // Whole column of bare 1–31 integers → day-only column
      if (values.length > 0) {
        const dayRatio =
          values.filter((v) => isDayOnlyToken(v)).length / values.length;
        if (dayRatio >= 0.5) suggested = "watchedDay";
      }
    }

    tokens.push({
      index: i,
      raw: headerName || guessSource || `(column ${i + 1})`,
      role: suggested,
      suggested,
    });
  }

  if (!tokens.some((t) => t.role === "title")) {
    const textTok = tokens.find((t) => /[a-zA-Z]{2,}/.test(t.raw));
    if (textTok) {
      textTok.role = "title";
      textTok.suggested = "title";
    }
  }

  return { lines, tokensFromFirst: tokens, headerSkipped, headerCells };
}

/* ---------------- mapping ---------------- */

export function buildWatchedDateFromDay(
  day: string,
  month: number,
  year: number
): string {
  const d = parseInt(String(day).trim(), 10);
  if (!Number.isFinite(d) || d < 1 || d > 31) return "";
  if (!Number.isFinite(month) || month < 1 || month > 12) return "";
  if (!Number.isFinite(year) || year < 1900 || year > 2100) return "";
  const dt = new Date(year, month - 1, d);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== d
  ) {
    return "";
  }
  const mm = String(month).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export function applyAdvancedMapping(
  lines: string[][],
  roles: TokenRole[],
  dayMonth: number | null,
  dayYear: number | null
): { rows: LetterboxdRow[]; warnings: string[]; needsMonthYear: boolean } {
  const warnings: string[] = [];
  const rows: LetterboxdRow[] = [];
  const needsMonthYear = roles.includes("watchedDay");
  let missingDayContext = 0;
  let skipped = 0;

  for (const parts of lines) {
    const row = emptyRow();
    let dayOnly = "";

    for (let i = 0; i < roles.length; i++) {
      const role = roles[i];
      const raw = (parts[i] ?? "").trim();
      if (!raw || role === "ignore") continue;

      switch (role) {
        case "title":
          row.title = row.title ? `${row.title} ${raw}` : raw;
          break;
        case "year":
          row.year = extractYear(raw) || raw;
          break;
        case "rating": {
          const p = parseRatingValue(raw, false);
          if (p.rating5) row.rating = p.rating5;
          else if (p.rating10) {
            const n = parseInt(p.rating10, 10);
            if (!Number.isNaN(n)) {
              const half = Math.round(n) / 2;
              row.rating = Number.isInteger(half) ? String(half) : half.toFixed(1);
            }
          }
          break;
        }
        case "rating10": {
          const p = parseRatingValue(raw, true);
          row.rating10 =
            p.rating10 ||
            (p.rating5 ? String(Math.round(parseFloat(p.rating5) * 2)) : "");
          break;
        }
        case "watchedDate":
          row.watchedDate = normalizeWatchedDate(raw) || row.watchedDate;
          break;
        case "watchedDay":
          dayOnly = raw;
          break;
        case "directors":
          row.directors = row.directors ? `${row.directors}, ${raw}` : raw;
          break;
        case "tags":
          row.tags = row.tags ? `${row.tags}, ${raw}` : raw;
          break;
        case "review":
          row.review = row.review ? `${row.review} ${raw}` : raw;
          break;
        case "imdbID":
          row.imdbId = normalizeImdbId(raw);
          break;
        case "tmdbID":
          row.tmdbId = normalizeTmdbId(raw);
          break;
        case "letterboxdURI":
          row.letterboxdUri = normalizeLetterboxdUri(raw);
          break;
        case "rewatch":
          row.rewatch = normalizeRewatch(raw);
          break;
      }
    }

    if (row.title) {
      if (!row.year) {
        const y = extractYear(row.title);
        if (y) {
          row.year = y;
          row.title = cleanTitle(row.title);
        }
      } else {
        row.title = cleanTitle(row.title);
      }
    }

    if (dayOnly) {
      if (dayMonth != null && dayYear != null) {
        const built = buildWatchedDateFromDay(dayOnly, dayMonth, dayYear);
        if (built) row.watchedDate = built;
        else missingDayContext++;
      } else {
        missingDayContext++;
      }
    }

    if (!row.title && !row.imdbId && !row.tmdbId && !row.letterboxdUri) {
      skipped++;
      continue;
    }

    rows.push(row);
  }

  if (skipped) warnings.push(`Skipped ${skipped} line(s) with no title/ID.`);
  if (needsMonthYear && (dayMonth == null || dayYear == null)) {
    warnings.push(
      "Day-only watched dates found (e.g. \"11\"). Pick a month and year to build full YYYY-MM-DD dates."
    );
  } else if (missingDayContext > 0) {
    warnings.push(
      `Could not build ${missingDayContext} watched date(s) from day-only values — check month/year.`
    );
  }

  return { rows, warnings, needsMonthYear };
}

export function rolesToExportColumns(roles: TokenRole[]): ExportColumn[] {
  const set = new Set<ExportColumn>();
  for (const r of roles) {
    switch (r) {
      case "title":
        set.add("Title");
        break;
      case "year":
        set.add("Year");
        break;
      case "rating":
        set.add("Rating");
        break;
      case "rating10":
        set.add("Rating10");
        break;
      case "watchedDate":
      case "watchedDay":
        set.add("WatchedDate");
        break;
      case "directors":
        set.add("Directors");
        break;
      case "tags":
        set.add("Tags");
        break;
      case "review":
        set.add("Review");
        break;
      case "imdbID":
        set.add("imdbID");
        break;
      case "tmdbID":
        set.add("tmdbID");
        break;
      case "letterboxdURI":
        set.add("LetterboxdURI");
        break;
      case "rewatch":
        set.add("Rewatch");
        break;
    }
  }
  if (
    ![...set].some((c) =>
      ["Title", "imdbID", "tmdbID", "LetterboxdURI"].includes(c)
    )
  ) {
    set.add("Title");
  }
  const order: ExportColumn[] = [
    "LetterboxdURI",
    "tmdbID",
    "imdbID",
    "Title",
    "Year",
    "Directors",
    "Rating",
    "Rating10",
    "WatchedDate",
    "Rewatch",
    "Tags",
    "Review",
  ];
  return order.filter((c) => set.has(c));
}

export const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];
