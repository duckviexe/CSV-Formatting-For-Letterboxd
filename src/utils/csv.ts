/**
 * Letterboxd official import format helpers
 * Spec: Title, Year, Directors, Rating, Rating10, WatchedDate, Rewatch, Tags, Review,
 *       LetterboxdURI/url, tmdbID, imdbID
 */

export type ExportColumn =
  | "LetterboxdURI"
  | "tmdbID"
  | "imdbID"
  | "Title"
  | "Year"
  | "Directors"
  | "Rating"
  | "Rating10"
  | "WatchedDate"
  | "Rewatch"
  | "Tags"
  | "Review";

export const ALL_EXPORT_COLUMNS: ExportColumn[] = [
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

/** Identity columns — at least one required by Letterboxd */
export const IDENTITY_COLUMNS: ExportColumn[] = [
  "LetterboxdURI",
  "tmdbID",
  "imdbID",
  "Title",
];

export interface LetterboxdRow {
  letterboxdUri: string;
  tmdbId: string;
  imdbId: string;
  title: string;
  year: string;
  directors: string;
  rating: string; // 0.5–5
  rating10: string; // 1–10 (kept if source was 10-scale and user prefers)
  watchedDate: string; // YYYY-MM-DD
  rewatch: string; // true / false / ""
  tags: string;
  review: string;
}

export interface DetectedColumns {
  letterboxdUri?: string;
  tmdbId?: string;
  imdbId?: string;
  title?: string;
  year?: string;
  directors?: string;
  rating?: string;
  rating10?: string;
  watchedDate?: string;
  rewatch?: string;
  tags?: string;
  review?: string;
}

export interface ParseResult {
  rows: LetterboxdRow[];
  warnings: string[];
  detectedColumns: DetectedColumns;
  originalHeaders: string[];
  skippedRows: number;
  /** Which logical fields have any non-empty data */
  populatedFields: ExportColumn[];
}

type FieldKey = keyof DetectedColumns;

const FIELD_ALIASES: Record<FieldKey, string[]> = {
  letterboxdUri: [
    "letterboxduri",
    "letterboxd uri",
    "letterboxd url",
    "url",
    "uri",
    "boxd",
    "boxd it",
    "letterboxd link",
    "lb url",
    "lb uri",
  ],
  tmdbId: [
    "tmdbid",
    "tmdb id",
    "tmdb",
    "tmdb_id",
    "themoviedb",
    "the movie db",
  ],
  imdbId: [
    "imdbid",
    "imdb id",
    "imdb",
    "imdb_id",
    "const", // IMDb export uses Const for tt IDs
    "imdbconst",
  ],
  title: [
    "title",
    "name",
    "film",
    "movie",
    "movie title",
    "film title",
    "film name",
    "movie name",
    "letterboxd title",
    "primary title",
    "original title",
    "work title",
    "title type", // skip preference — handled carefully
  ],
  year: [
    "year",
    "release year",
    "release_year",
    "year released",
    "start year",
    "yr",
    // NOTE: do NOT include bare "release" / "released" / "date" —
    // those often hold full calendar dates and must map to WatchedDate or be inferred.
  ],
  directors: [
    "directors",
    "director",
    "directed by",
    "dir",
    "filmmaker",
    "filmmakers",
  ],
  rating: [
    "rating",
    "ratings",
    "stars",
    "my rating",
    "user rating",
    "your rating",
    "letterboxd rating",
    "lb rating",
    "star rating",
    "rate",
  ],
  rating10: [
    "rating10",
    "rating 10",
    "score",
    "my score",
    "score10",
    "score 10",
    "out of 10",
    "rating out of 10",
    "vote",
    "votes",
    "imdb rating",
  ],
  watchedDate: [
    "watcheddate",
    "watched date",
    "date watched",
    "diary date",
    "viewing date",
    "watch date",
    "date rated",
    "rated date",
    "logged date",
    "entry date",
    "log date",
    "day watched",
    "watched on",
    "viewed",
    "viewed on",
    "viewed date",
    "when watched",
    "date added",
    "added date",
    "created",
    "created date",
    "logged",
    "watched",
    "date",
    // Full release timestamps people sometimes log as watch dates
    "release date",
    "released",
    "release",
    "premiere",
  ],
  rewatch: [
    "rewatch",
    "is rewatch",
    "rewatched",
    "re watch",
    "re-watch",
  ],
  tags: [
    "tags",
    "tag",
    "genres", // sometimes people dump tags here
    "labels",
    "keywords",
  ],
  review: [
    "review",
    "reviews",
    "notes",
    "note",
    "comment",
    "comments",
    "text",
    "body",
    "content",
    "description",
  ],
};

// Prefer not mapping generic "date" / "score" if better headers exist — handled by order

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

/** Parse a single CSV line respecting quoted fields (RFC-style "" escapes + backslash) */
export function parseCsvLine(line: string, delimiter = ","): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (inQuotes) {
      if (char === "\\" && (next === '"' || next === "\\")) {
        current += next;
        i++;
      } else if (char === '"') {
        if (next === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 15).join("\n");
  const candidates: { delim: string; score: number }[] = [
    { delim: ",", score: 0 },
    { delim: ";", score: 0 },
    { delim: "\t", score: 0 },
    { delim: "|", score: 0 },
  ];

  for (const c of candidates) {
    const lines = sample.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) continue;
    const counts = lines.map(
      (l) => parseCsvLine(l, c.delim).filter((f) => f.length > 0).length
    );
    const first = counts[0];
    const consistent = counts.every((n) => n === first && n > 1);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    c.score = consistent ? avg * 10 : avg;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].score > 1 ? candidates[0].delim : ",";
}

function normalizeHeader(h: string): string {
  return h
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/\s+/g, " ");
}

function findColumnIndex(
  headers: string[],
  aliases: string[],
  used: Set<number>,
  fuzzy = true
): number {
  const normalized = headers.map(normalizeHeader);

  // Exact match first
  for (const alias of aliases) {
    const idx = normalized.findIndex((h, i) => !used.has(i) && h === alias);
    if (idx !== -1) return idx;
  }

  if (!fuzzy) return -1;

  // Fuzzy only for longer aliases to avoid "release" eating "release year"
  for (const alias of aliases) {
    if (alias.length < 5) continue;
    const idx = normalized.findIndex(
      (h, i) =>
        !used.has(i) &&
        (h === alias ||
          h.startsWith(alias + " ") ||
          h.endsWith(" " + alias) ||
          h.includes(" " + alias + " "))
    );
    if (idx !== -1) return idx;
  }

  return -1;
}

export function extractYear(value: string): string {
  if (!value) return "";
  const paren = value.match(/\((\d{4})\)/);
  if (paren) return paren[1];
  const iso = value.match(/\b((?:19|20)\d{2})\b/);
  if (iso) return iso[1];
  return "";
}

export function cleanTitle(value: string): string {
  if (!value) return "";
  return value
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Snap to Letterboxd half-star 0.5–5 */
function snapToHalf(n: number): number {
  const clamped = Math.max(0.5, Math.min(5, n));
  return Math.round(clamped * 2) / 2;
}

function formatHalf(n: number): string {
  if (n <= 0) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Parse a rating cell.
 * Returns { rating5, rating10 } — fills the scale that best matches the source.
 */
export function parseRatingValue(
  value: string,
  prefer10Column = false
): { rating5: string; rating10: string } {
  if (!value || !value.trim()) return { rating5: "", rating10: "" };

  let raw = value.trim();

  // Star glyphs
  const fullStars = (raw.match(/[★⭐]/g) || []).length;
  if (fullStars > 0) {
    const half =
      /[½]/.test(raw) ||
      raw.includes("1/2") ||
      (raw.match(/[☆]/g) || []).length > 0;
    const n = Math.min(5, fullStars + (half ? 0.5 : 0));
    return { rating5: formatHalf(n), rating10: "" };
  }

  // Fraction a/b
  const fraction = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const num = parseFloat(fraction[1]);
    const den = parseFloat(fraction[2]);
    if (den === 10) {
      const r10 = Math.round(Math.max(1, Math.min(10, num)));
      return {
        rating5: prefer10Column ? "" : formatHalf(snapToHalf(r10 / 2)),
        rating10: prefer10Column ? String(r10) : "",
      };
    }
    if (den === 5) {
      return { rating5: formatHalf(snapToHalf(num)), rating10: "" };
    }
    if (den > 0) {
      return {
        rating5: formatHalf(snapToHalf((num / den) * 5)),
        rating10: "",
      };
    }
  }

  // Percentage
  if (/%\s*$/.test(raw)) {
    const n = parseFloat(raw.replace("%", "").replace(",", "."));
    if (!Number.isNaN(n)) {
      return { rating5: formatHalf(snapToHalf((n / 100) * 5)), rating10: "" };
    }
  }

  raw = raw.replace(/stars?/i, "").replace(/,/g, ".").trim();
  const num = parseFloat(raw);
  if (Number.isNaN(num) || num <= 0) return { rating5: "", rating10: "" };

  // 0–100
  if (num > 10) {
    return { rating5: formatHalf(snapToHalf((num / 100) * 5)), rating10: "" };
  }

  // Clearly 10-scale (integers 6–10, or flagged)
  if (num > 5 || prefer10Column) {
    if (prefer10Column || (Number.isInteger(num) && num >= 1 && num <= 10)) {
      const r10 = Math.round(Math.max(1, Math.min(10, num)));
      // Also produce Rating when not exclusively rating10 source
      if (prefer10Column) {
        return { rating5: "", rating10: String(r10) };
      }
      return { rating5: formatHalf(snapToHalf(num / 2)), rating10: "" };
    }
  }

  // 0.5–5 scale
  return { rating5: formatHalf(snapToHalf(num)), rating10: "" };
}

function pad2(n: number | string): string {
  return String(n).padStart(2, "0");
}

function ymd(y: number | string, m: number | string, d: number | string): string {
  const year = typeof y === "string" ? parseInt(y, 10) : y;
  const month = typeof m === "string" ? parseInt(m, 10) : m;
  const day = typeof d === "string" ? parseInt(d, 10) : d;
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    year < 1900 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return "";
  }
  // Validate calendar date
  const dt = new Date(year, month - 1, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return "";
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Excel serial date (days since 1899-12-30, with Excel's 1900 leap-year bug) */
function fromExcelSerial(n: number): string {
  if (!Number.isFinite(n) || n < 1 || n > 80000) return "";
  // Excel epoch starts 1899-12-30
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + Math.floor(n) * 86400000;
  const dt = new Date(ms);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function expandTwoDigitYear(yy: number): number {
  // 00–39 → 2000–2039, 40–99 → 1940–1999
  return yy <= 39 ? 2000 + yy : 1900 + yy;
}

/** True if string looks like a full calendar date (not just a year) */
export function looksLikeFullDate(value: string): boolean {
  if (!value || !value.trim()) return false;
  return normalizeWatchedDate(value) !== "";
}

/**
 * Truncate timestamps to YYYY-MM-DD calendar date (Letterboxd WatchedDate).
 * Supports ISO, slashes, dots, named months, Excel serials, and datetimes.
 */
export function normalizeWatchedDate(value: string): string {
  if (value == null) return "";
  let v = String(value).trim();
  if (!v) return "";

  // Strip surrounding quotes leftovers
  v = v.replace(/^["']|["']$/g, "").trim();

  // Excel serial (integer or float)
  if (/^\d{4,5}(?:\.\d+)?$/.test(v)) {
    const n = parseFloat(v);
    // Pure years like 1984 / 2020 should NOT become serials
    if (n >= 20000 && n <= 80000) {
      const serial = fromExcelSerial(n);
      if (serial) return serial;
    }
  }

  // ISO / RFC: 2020-05-01 or 2020-5-1 or with time / timezone
  // e.g. 2020-05-01T14:30:00.000Z, 2020-05-01 14:30:00
  const iso = v.match(
    /^((?:19|20)\d{2})([-/\\.])(\d{1,2})\2(\d{1,2})(?:[T\s].*)?$/i
  );
  if (iso) {
    const got = ymd(iso[1], iso[3], iso[4]);
    if (got) return got;
  }

  // YYYYMMDD
  const compact = v.match(/^((?:19|20)\d{2})(\d{2})(\d{2})(?:\d{6})?$/);
  if (compact) {
    const got = ymd(compact[1], compact[2], compact[3]);
    if (got) return got;
  }

  // DD-MMM-YYYY or DD MMM YYYY (01-Jan-2020, 1 Jan 2020)
  const monMap: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  const dmyMon = v.match(
    /^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})[\s\-/.]+((?:19|20)\d{2}|\d{2})(?:\s+.*)?$/
  );
  if (dmyMon) {
    const mon = monMap[dmyMon[2].toLowerCase()];
    if (mon) {
      let year = parseInt(dmyMon[3], 10);
      if (year < 100) year = expandTwoDigitYear(year);
      const got = ymd(year, mon, dmyMon[1]);
      if (got) return got;
    }
  }

  // MMM DD, YYYY / Month D, YYYY
  const monDy = v.match(
    /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+((?:19|20)\d{2})(?:\s+.*)?$/
  );
  if (monDy) {
    const mon = monMap[monDy[1].toLowerCase()];
    if (mon) {
      const got = ymd(monDy[3], mon, monDy[2]);
      if (got) return got;
    }
  }

  // D/M/YYYY or M/D/YYYY (and -, .) with optional time; 2- or 4-digit year
  const slash = v.match(
    /^(\d{1,2})([/\-.])(\d{1,2})\2(\d{2}|\d{4})(?:\s+.*)?$/
  );
  if (slash) {
    const a = parseInt(slash[1], 10);
    const b = parseInt(slash[3], 10);
    let year = parseInt(slash[4], 10);
    if (year < 100) year = expandTwoDigitYear(year);

    if (a > 12 && b <= 12) {
      // DD/MM/YYYY
      const got = ymd(year, b, a);
      if (got) return got;
    } else if (b > 12 && a <= 12) {
      // MM/DD/YYYY
      const got = ymd(year, a, b);
      if (got) return got;
    } else if (a <= 12 && b <= 12) {
      // Ambiguous — prefer MM/DD/YYYY (US / many CSV exports), fallback DD/MM
      const us = ymd(year, a, b);
      if (us) return us;
      const eu = ymd(year, b, a);
      if (eu) return eu;
    }
  }

  // Fallback: Date.parse for remaining free-text dates
  // Prefer parsing date-only as UTC noon to avoid TZ day-shift
  const dateOnly = v.match(/^([A-Za-z0-9,\s/\-.]+)$/);
  if (dateOnly && /[A-Za-z]/.test(v)) {
    const parsed = Date.parse(v);
    if (!Number.isNaN(parsed)) {
      const d = new Date(parsed);
      const got = ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
      if (got) return got;
    }
  }

  return "";
}

export function normalizeRewatch(value: string): string {
  if (!value || !value.trim()) return "";
  const v = value.trim().toLowerCase();
  if (["true", "yes", "y", "1", "rewatch", "x", "✓", "✔"].includes(v)) {
    return "true";
  }
  if (["false", "no", "n", "0"].includes(v)) {
    return "false";
  }
  return "";
}

export function normalizeImdbId(value: string): string {
  if (!value) return "";
  const v = value.trim();
  const m = v.match(/tt\d{7,}/i);
  if (m) return m[0].toLowerCase();
  if (/^\d{7,8}$/.test(v)) return `tt${v}`;
  return "";
}

export function normalizeTmdbId(value: string): string {
  if (!value) return "";
  const m = value.trim().match(/^\d+$/);
  return m ? m[0] : "";
}

export function normalizeLetterboxdUri(value: string): string {
  if (!value) return "";
  const v = value.trim();
  if (/boxd\.it\//i.test(v) || /letterboxd\.com\//i.test(v)) return v;
  // short code only
  if (/^[a-zA-Z0-9]+$/.test(v) && v.length <= 10) {
    return `https://boxd.it/${v}`;
  }
  return v.startsWith("http") ? v : "";
}

function isHeaderRow(fields: string[]): boolean {
  const joined = fields.map(normalizeHeader);
  let hits = 0;
  for (const aliases of Object.values(FIELD_ALIASES)) {
    for (const a of aliases) {
      if (joined.some((h) => h === a || (a.length >= 4 && h.includes(a)))) {
        hits++;
        break;
      }
    }
  }
  return hits >= 1 && fields.length >= 1;
}

/**
 * After alias matching, look at sample values to decide whether a column
 * is Year (YYYY only) vs WatchedDate (full dates).
 */
function refineYearVsDate(
  map: Partial<Record<FieldKey, number>>,
  headers: string[],
  dataRows: string[][]
): void {
  const sample = dataRows.slice(0, 40);

  const ratioFullDates = (idx: number): number => {
    let total = 0;
    let full = 0;
    let yearOnly = 0;
    for (const row of sample) {
      const c = (row[idx] ?? "").trim();
      if (!c) continue;
      total++;
      if (looksLikeFullDate(c)) full++;
      else if (/^(?:19|20)\d{2}$/.test(c)) yearOnly++;
    }
    if (total === 0) return 0;
    return full / total;
  };

  // If "year" column is mostly full dates, treat it as WatchedDate instead
  if (map.year !== undefined && map.watchedDate === undefined) {
    const r = ratioFullDates(map.year);
    if (r >= 0.4) {
      map.watchedDate = map.year;
      delete map.year;
    }
  }

  // If watchedDate column is mostly bare years, flip to year
  if (map.watchedDate !== undefined && map.year === undefined) {
    const idx = map.watchedDate;
    let total = 0;
    let yearOnly = 0;
    let full = 0;
    for (const row of sample) {
      const c = (row[idx] ?? "").trim();
      if (!c) continue;
      total++;
      if (looksLikeFullDate(c)) full++;
      else if (/^(?:19|20)\d{2}$/.test(c)) yearOnly++;
    }
    if (total > 0 && yearOnly / total >= 0.6 && full / total < 0.2) {
      // Header might be "Release" with only years — keep as year
      const h = normalizeHeader(headers[idx] || "");
      if (
        h === "year" ||
        h.includes("year") ||
        h === "release" ||
        h === "released" ||
        h === "premiere"
      ) {
        map.year = idx;
        delete map.watchedDate;
      }
    }
  }

  // Scan unmapped columns for full dates → WatchedDate
  if (map.watchedDate === undefined) {
    const used = new Set(
      Object.values(map).filter((n): n is number => typeof n === "number")
    );
    let best = -1;
    let bestScore = 0;
    const colCount = Math.max(headers.length, ...sample.map((r) => r.length), 0);
    for (let i = 0; i < colCount; i++) {
      if (used.has(i)) continue;
      const r = ratioFullDates(i);
      if (r > bestScore) {
        bestScore = r;
        best = i;
      }
    }
    if (best >= 0 && bestScore >= 0.4) {
      map.watchedDate = best;
    }
  }

  // Scan unmapped columns for year-only → Year
  if (map.year === undefined) {
    const used = new Set(
      Object.values(map).filter((n): n is number => typeof n === "number")
    );
    let best = -1;
    let bestScore = 0;
    const colCount = Math.max(headers.length, ...sample.map((r) => r.length), 0);
    for (let i = 0; i < colCount; i++) {
      if (used.has(i)) continue;
      let total = 0;
      let yearOnly = 0;
      for (const row of sample) {
        const c = (row[i] ?? "").trim();
        if (!c) continue;
        total++;
        if (/^(?:19|20)\d{2}$/.test(c)) yearOnly++;
      }
      const score = total ? yearOnly / total : 0;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0 && bestScore >= 0.5) {
      map.year = best;
    }
  }
}

function mapHeaders(
  headers: string[],
  dataRows: string[][] = []
): Partial<Record<FieldKey, number>> {
  const used = new Set<number>();
  const map: Partial<Record<FieldKey, number>> = {};

  // Exact matches first across all fields (avoids short alias collisions),
  // then a fuzzy pass for longer names.
  const order: FieldKey[] = [
    "letterboxdUri",
    "tmdbId",
    "imdbId",
    "title",
    "year",
    "watchedDate",
    "directors",
    "rating10",
    "rating",
    "rewatch",
    "tags",
    "review",
  ];

  const bind = (fuzzy: boolean) => {
    for (const key of order) {
      if (map[key] !== undefined) continue;
      let aliases = FIELD_ALIASES[key];
      if (key === "title") {
        aliases = aliases.filter((a) => a !== "title type");
      }
      const idx = findColumnIndex(headers, aliases, used, fuzzy);
      if (idx >= 0) {
        if (
          key === "title" &&
          normalizeHeader(headers[idx]).includes("type")
        ) {
          continue;
        }
        map[key] = idx;
        used.add(idx);
      }
    }
  };

  bind(false);
  bind(true);

  if (dataRows.length > 0) {
    refineYearVsDate(map, headers, dataRows);
  }

  return map;
}

function inferColumnsFromData(
  rows: string[][]
): Partial<Record<FieldKey, number>> {
  const colCount = Math.max(...rows.map((r) => r.length), 0);
  const scores = Array.from({ length: colCount }, () => ({
    title: 0,
    year: 0,
    rating: 0,
    watchedDate: 0,
    imdbId: 0,
    tmdbId: 0,
    directors: 0,
    review: 0,
  }));

  for (const row of rows.slice(0, 60)) {
    for (let i = 0; i < row.length; i++) {
      const cell = row[i].trim();
      if (!cell) continue;

      if (/tt\d{7,}/i.test(cell)) scores[i].imdbId += 5;
      else if (
        /boxd\.it|letterboxd\.com/i.test(cell)
      )
        scores[i].imdbId += 0; // uri handled separately
      else if (/^\d{2,6}$/.test(cell) && parseInt(cell, 10) > 0)
        scores[i].tmdbId += 1;
      else if (
        /^\d{4}-\d{2}-\d{2}/.test(cell) ||
        /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(cell)
      )
        scores[i].watchedDate += 3;
      else if (/\b(19|20)\d{2}\b/.test(cell) && cell.length <= 10)
        scores[i].year += 2;
      else if (/[★⭐]/.test(cell) || /^\d+(\.\d+)?\s*\/\s*10$/.test(cell))
        scores[i].rating += 3;
      else if (/^\d+(\.\d+)?$/.test(cell)) {
        const n = parseFloat(cell);
        if (n >= 0 && n <= 10) scores[i].rating += 2;
      } else if (cell.length > 80) scores[i].review += 2;
      else if (
        cell.includes(",") &&
        /^[A-Za-zÀ-ÿ.\-'\s,]+$/.test(cell) &&
        cell.length < 80
      )
        scores[i].directors += 1;
      else if (cell.length > 1 && /[a-zA-Z]/.test(cell))
        scores[i].title += 2 + Math.min(cell.length / 25, 2);
    }
  }

  const used = new Set<number>();
  const pick = (key: keyof (typeof scores)[0]): number => {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < colCount; i++) {
      if (used.has(i)) continue;
      if (scores[i][key] > bestScore) {
        bestScore = scores[i][key];
        best = i;
      }
    }
    if (best >= 0 && bestScore > 0) {
      used.add(best);
      return best;
    }
    return -1;
  };

  const map: Partial<Record<FieldKey, number>> = {};
  const t = pick("title");
  if (t >= 0) map.title = t;
  const y = pick("year");
  if (y >= 0) map.year = y;
  const r = pick("rating");
  if (r >= 0) map.rating = r;
  const w = pick("watchedDate");
  if (w >= 0) map.watchedDate = w;
  const im = pick("imdbId");
  if (im >= 0) map.imdbId = im;
  const tm = pick("tmdbId");
  if (tm >= 0) map.tmdbId = tm;
  const d = pick("directors");
  if (d >= 0) map.directors = d;
  const rev = pick("review");
  if (rev >= 0) map.review = rev;
  return map;
}

function cell(fields: string[], idx: number | undefined): string {
  if (idx === undefined || idx < 0) return "";
  return fields[idx] ?? "";
}

export function parseMessyCsv(input: string): ParseResult {
  const warnings: string[] = [];
  const text = input.replace(/^\uFEFF/, "").trim();

  if (!text) {
    return {
      rows: [],
      warnings: ["Input is empty."],
      detectedColumns: {},
      originalHeaders: [],
      skippedRows: 0,
      populatedFields: [],
    };
  }

  const delimiter = detectDelimiter(text);
  if (delimiter !== ",") {
    warnings.push(
      `Detected "${delimiter === "\t" ? "tab" : delimiter}" as delimiter — output will use commas (required by Letterboxd).`
    );
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const allRows = lines.map((l) => parseCsvLine(l, delimiter));

  let headers: string[] = [];
  let dataRows: string[][];
  let colMap: Partial<Record<FieldKey, number>>;

  if (isHeaderRow(allRows[0])) {
    headers = allRows[0];
    dataRows = allRows.slice(1);
    colMap = mapHeaders(headers, dataRows);
  } else {
    dataRows = allRows;
    warnings.push("No header row detected — inferred columns from data.");
    colMap = inferColumnsFromData(dataRows);
    refineYearVsDate(colMap, headers, dataRows);
  }

  if (colMap.title === undefined && colMap.imdbId === undefined && colMap.tmdbId === undefined && colMap.letterboxdUri === undefined) {
    if (dataRows[0]?.length >= 1) {
      colMap.title = 0;
      warnings.push("Could not detect an identity column — using first column as Title.");
    }
  }

  const detectedColumns: DetectedColumns = {};
  const label = (idx: number | undefined) =>
    idx !== undefined
      ? headers[idx] || `Column ${idx + 1}`
      : undefined;

  (Object.keys(colMap) as FieldKey[]).forEach((k) => {
    detectedColumns[k] = label(colMap[k]);
  });

  // Detect if rating column is clearly 10-scale from header
  const ratingHeader = (detectedColumns.rating || "").toLowerCase();
  const rating10Header = (detectedColumns.rating10 || "").toLowerCase();
  const ratingColIs10 =
    !colMap.rating10 &&
    (ratingHeader.includes("10") ||
      ratingHeader.includes("score") ||
      ratingHeader.includes("imdb"));

  const yearHeader = normalizeHeader(detectedColumns.year || "");
  const watchedHeader = normalizeHeader(detectedColumns.watchedDate || "");
  const watchedLooksLikeRelease =
    !!watchedHeader &&
    (watchedHeader.includes("release") ||
      watchedHeader === "released" ||
      watchedHeader === "premiere") &&
    !watchedHeader.includes("watch") &&
    !watchedHeader.includes("diary") &&
    !watchedHeader.includes("rated") &&
    !watchedHeader.includes("log");

  const yearHeaderLooksLikeDate =
    yearHeader.includes("date") ||
    yearHeader.includes("watched") ||
    (yearHeader.includes("release") && yearHeader.includes("date"));

  const rows: LetterboxdRow[] = [];
  let skippedRows = 0;
  let dateParseFails = 0;

  for (const fields of dataRows) {
    const row = emptyRow();

    row.letterboxdUri = normalizeLetterboxdUri(
      cell(fields, colMap.letterboxdUri)
    );
    row.tmdbId = normalizeTmdbId(cell(fields, colMap.tmdbId));
    row.imdbId = normalizeImdbId(cell(fields, colMap.imdbId));
    row.title = cell(fields, colMap.title);
    const rawYear = cell(fields, colMap.year);
    const rawWatched = cell(fields, colMap.watchedDate);
    row.directors = cell(fields, colMap.directors).replace(/\s*;\s*/g, ", ");
    row.rewatch = normalizeRewatch(cell(fields, colMap.rewatch));
    row.tags = cell(fields, colMap.tags).replace(/\s*;\s*/g, ", ");
    row.review = cell(fields, colMap.review);

    // WatchedDate: keep full YYYY-MM-DD (never strip day/month down to year)
    if (rawWatched) {
      row.watchedDate = normalizeWatchedDate(rawWatched);
      if (!row.watchedDate && rawWatched.trim()) {
        dateParseFails++;
      }
    }

    // Year column may contain a full date — salvage year (and date if needed)
    if (rawYear) {
      const asDate = normalizeWatchedDate(rawYear);
      if (asDate) {
        if (!row.watchedDate && yearHeaderLooksLikeDate) {
          row.watchedDate = asDate;
        }
        row.year = asDate.slice(0, 4);
      } else {
        row.year = extractYear(rawYear) || "";
      }
    } else {
      row.year = "";
    }

    // Release-date-only column: recover Year, don't invent a diary entry
    if (watchedLooksLikeRelease && row.watchedDate) {
      if (!row.year) row.year = row.watchedDate.slice(0, 4);
      row.watchedDate = "";
    }

    // Year from title fallback, e.g. "The Matrix (1999)"
    if (!row.year && row.title) {
      const fromTitle = extractYear(row.title);
      if (fromTitle) {
        row.year = fromTitle;
        row.title = cleanTitle(row.title);
      } else {
        row.title = cleanTitle(row.title);
      }
    } else {
      row.title = cleanTitle(row.title);
    }
    // Ratings — Letterboxd: if both present, later column wins; we expose both cleanly
    const rawRating10 = cell(fields, colMap.rating10);
    const rawRating = cell(fields, colMap.rating);

    if (rawRating10) {
      const p = parseRatingValue(rawRating10, true);
      row.rating10 = p.rating10 || (p.rating5 ? String(Math.round(parseFloat(p.rating5) * 2)) : "");
    }

    if (rawRating) {
      const p = parseRatingValue(rawRating, ratingColIs10);
      if (p.rating10) row.rating10 = p.rating10;
      if (p.rating5) row.rating = p.rating5;
    }

    // If only rating10 filled from a 10-col, also fine — Letterboxd accepts Rating10 alone
    if (!row.rating && !row.rating10 && ratingColIs10 && rawRating) {
      const p = parseRatingValue(rawRating, true);
      row.rating10 = p.rating10;
    }

    // Must have at least one identity field
    if (
      !row.title &&
      !row.imdbId &&
      !row.tmdbId &&
      !row.letterboxdUri
    ) {
      skippedRows++;
      continue;
    }

    rows.push(row);
  }

  if (skippedRows > 0) {
    warnings.push(
      `Skipped ${skippedRows} row(s) with no Title, imdbID, tmdbID, or LetterboxdURI.`
    );
  }

  if (dateParseFails > 0) {
    warnings.push(
      `Could not parse ${dateParseFails} watched date value(s). Use YYYY-MM-DD, M/D/YYYY, D/M/YYYY, or "Jan 10 2022".`
    );
  }

  const withDates = rows.filter((r) => r.watchedDate).length;
  if (colMap.watchedDate !== undefined && withDates === 0 && rows.length > 0) {
    warnings.push(
      "A date column was detected but no full calendar days were recovered. Check the date format."
    );
  }

  // Deduplicate exact full-row matches
  const seen = new Set<string>();
  const deduped: LetterboxdRow[] = [];
  let dupes = 0;
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) {
      dupes++;
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  if (dupes > 0) {
    warnings.push(`Removed ${dupes} exact duplicate row(s).`);
  }

  // Byte size warning (~1MB Letterboxd limit)
  const rough = toLetterboxdCsv(deduped, getDefaultColumns(deduped));
  if (new Blob([rough]).size > 900_000) {
    warnings.push(
      "Export is near or over Letterboxd’s 1MB file limit — split into multiple files (keep the header row in each)."
    );
  }

  if (
    !deduped.some(
      (r) => r.title || r.imdbId || r.tmdbId || r.letterboxdUri
    ) &&
    deduped.length === 0
  ) {
    warnings.push(
      "Letterboxd requires at least one of: LetterboxdURI, tmdbID, imdbID, or Title."
    );
  }

  if (rating10Header && ratingHeader) {
    warnings.push(
      "Both Rating and Rating10 sources detected. Letterboxd uses whichever column appears last in the file if both have values."
    );
  }

  return {
    rows: deduped,
    warnings,
    detectedColumns,
    originalHeaders: headers,
    skippedRows,
    populatedFields: getPopulatedFields(deduped),
  };
}

function getPopulatedFields(rows: LetterboxdRow[]): ExportColumn[] {
  const has = (fn: (r: LetterboxdRow) => string) =>
    rows.some((r) => fn(r).trim().length > 0);

  const fields: ExportColumn[] = [];
  if (has((r) => r.letterboxdUri)) fields.push("LetterboxdURI");
  if (has((r) => r.tmdbId)) fields.push("tmdbID");
  if (has((r) => r.imdbId)) fields.push("imdbID");
  if (has((r) => r.title)) fields.push("Title");
  if (has((r) => r.year)) fields.push("Year");
  if (has((r) => r.directors)) fields.push("Directors");
  if (has((r) => r.rating)) fields.push("Rating");
  if (has((r) => r.rating10)) fields.push("Rating10");
  if (has((r) => r.watchedDate)) fields.push("WatchedDate");
  if (has((r) => r.rewatch)) fields.push("Rewatch");
  if (has((r) => r.tags)) fields.push("Tags");
  if (has((r) => r.review)) fields.push("Review");
  return fields;
}

export function getDefaultColumns(rows: LetterboxdRow[]): ExportColumn[] {
  const populated = getPopulatedFields(rows);
  // Always ensure at least Title if nothing else
  if (populated.length === 0) return ["Title", "Year", "Rating"];

  // Prefer simple Title,Year,Rating when that's all that matters
  const hasIdentity = populated.some((c) =>
    (IDENTITY_COLUMNS as string[]).includes(c)
  );
  if (!hasIdentity && rows.some((r) => r.title)) {
    return ["Title", ...populated.filter((c) => c !== "Title")];
  }
  return populated;
}

/**
 * Letterboxd CSV escaping:
 * - comma delimiter, no space after comma
 * - quote fields containing commas/quotes/newlines
 * - escape quotes with backslash (\) per Letterboxd docs
 *   (also emit standard "" as safer dual — Letterboxd says backslash)
 */
export function escapeCsvField(value: string): string {
  if (value == null) return "";
  const s = String(value);
  if (
    s.includes(",") ||
    s.includes('"') ||
    s.includes("\n") ||
    s.includes("\r") ||
    s.includes("\\")
  ) {
    // Letterboxd: escape quotes with backslash
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

function rowValue(row: LetterboxdRow, col: ExportColumn): string {
  switch (col) {
    case "LetterboxdURI":
      return row.letterboxdUri;
    case "tmdbID":
      return row.tmdbId;
    case "imdbID":
      return row.imdbId;
    case "Title":
      return row.title;
    case "Year":
      return row.year;
    case "Directors":
      return row.directors;
    case "Rating":
      return row.rating;
    case "Rating10":
      return row.rating10;
    case "WatchedDate":
      return row.watchedDate;
    case "Rewatch":
      return row.rewatch;
    case "Tags":
      return row.tags;
    case "Review":
      return row.review;
    default:
      return "";
  }
}

export function toLetterboxdCsv(
  rows: LetterboxdRow[],
  columns: ExportColumn[]
): string {
  const cols =
    columns.length > 0 ? columns : (["Title", "Year", "Rating"] as ExportColumn[]);

  // Ensure at least one identity column
  const hasIdentity = cols.some((c) =>
    (IDENTITY_COLUMNS as string[]).includes(c)
  );
  const finalCols = hasIdentity ? cols : (["Title", ...cols] as ExportColumn[]);

  const lines = [finalCols.join(",")];
  for (const row of rows) {
    lines.push(finalCols.map((c) => escapeCsvField(rowValue(row, c))).join(","));
  }
  return lines.join("\n") + "\n";
}

export function downloadCsv(
  content: string,
  filename = "letterboxd-import.csv"
): boolean {
  const safeName = (filename || "letterboxd-import.csv").replace(
    /[^\w.\- ()[\]]+/g,
    "_"
  );
  const finalName = safeName.toLowerCase().endsWith(".csv")
    ? safeName
    : `${safeName}.csv`;

  // Prefer data-URI download — works in more embedded/sandboxed browsers
  // than blob: URLs when the download attribute is restricted.
  try {
    const bom = "\uFEFF";
    const dataUri =
      "data:text/csv;charset=utf-8," + encodeURIComponent(bom + content);
    const a = document.createElement("a");
    a.href = dataUri;
    a.setAttribute("download", finalName);
    a.setAttribute("target", "_self");
    a.rel = "noopener";
    a.style.cssText = "display:none;position:fixed;left:-9999px;";
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      try {
        document.body.removeChild(a);
      } catch {
        /* noop */
      }
    }, 1000);
    return true;
  } catch {
    /* try blob next */
  }

  try {
    const bom = "\uFEFF";
    const blob = new Blob([bom, content], {
      type: "text/csv;charset=utf-8;",
    });

    const nav = window.navigator as Navigator & {
      msSaveOrOpenBlob?: (blob: Blob, name: string) => void;
    };
    if (typeof nav.msSaveOrOpenBlob === "function") {
      nav.msSaveOrOpenBlob(blob, finalName);
      return true;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = finalName;
    a.rel = "noopener";
    a.style.cssText = "display:none";
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      try {
        document.body.removeChild(a);
      } catch {
        /* noop */
      }
      URL.revokeObjectURL(url);
    }, 2000);
    return true;
  } catch {
    return false;
  }
}

export function estimateSizeBytes(content: string): number {
  return new Blob([content]).size;
}

/**
 * Watchlist import: Letterboxd files a CSV to the Watchlist only when it is a
 * clean list of titles — any Rating or WatchedDate column turns it into a
 * Diary import. So we strip everything except Title (and optional Year).
 */
export function toWatchlistCsv(
  rows: LetterboxdRow[]
): { csv: string; count: number } {
  const seen = new Set<string>();
  const lines = ["Title,Year"];
  let count = 0;

  for (const row of rows) {
    const title = (row.title || "").trim();
    if (!title) continue;
    const key = `${title.toLowerCase()}|${row.year || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(
      [escapeCsvField(title), escapeCsvField(row.year || "")].join(",")
    );
    count++;
  }

  return { csv: count > 0 ? lines.join("\n") + "\n" : "", count };
}
