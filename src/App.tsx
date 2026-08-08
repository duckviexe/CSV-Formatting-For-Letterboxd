import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  applyAdvancedMapping,
  MONTHS,
  rolesToExportColumns,
  TOKEN_ROLES,
  tokenizeLines,
  type SplitMode,
  type TokenRole,
} from "./utils/advanced";
import {
  ALL_EXPORT_COLUMNS,
  estimateSizeBytes,
  getDefaultColumns,
  IDENTITY_COLUMNS,
  parseMessyCsv,
  toLetterboxdCsv,
  toWatchlistCsv,
  type ExportColumn,
  type LetterboxdRow,
  type ParseResult,
} from "./utils/csv";
import { downloadCsvFile } from "./utils/download";

const EXAMPLE_CSV = `Film Name,Release Year,My Score,Date Watched,Director,Tags,Review
Top Gun,1986,10,2020-05-01,Tony Scott,"action, 80s",Still rules.
Gremlins,1984,9,12/24/2021,Joe Dante,christmas,Don't feed them after midnight.
Paris Texas,1984,8,15/03/2019,Wim Wenders,road movie,A masterpiece.
The Matrix (1999),,9,Jan 10 2022,"Lana Wachowski, Lilly Wachowski",sci-fi,
Inception,2010,9,2018-07-04T22:15:00Z,Christopher Nolan,,
`;

const EXAMPLE_ADVANCED = `Title,Year,Rating,Day
Top Gun,1986,5,11
Gremlins,1984,4.5,24
Paris Texas,1984,4,15
The Matrix,1999,4.5,3
Inception,2010,5,7
`;

const MARQUEE =
  "LETTERBOXD IMPORT FORMAT ★ TITLE,YEAR,RATING ★ WATCHLIST = TITLE,YEAR ONLY ★ UTF-8 · COMMAS · NO SPACES AFTER COMMAS ★ MAX 1MB ★ NO UNDO AFTER CONFIRM ★ ";

type Mode = "csv" | "advanced";
type Source = "paste" | "file" | null;

const PANEL = "border-[3px] border-ink bg-white shadow-[8px_8px_0_0_#0c0c0c]";
const BTN =
  "inline-flex items-center justify-center gap-2 border-[3px] border-ink font-display text-sm uppercase tracking-wide transition-all duration-150 disabled:pointer-events-none disabled:opacity-40";
const PUSH =
  "shadow-[5px_5px_0_0_#0c0c0c] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_#0c0c0c] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none";

const COLUMN_HELP: Record<ExportColumn, string> = {
  LetterboxdURI: "Film or diary URI (boxd.it / letterboxd.com)",
  tmdbID: "Numeric TMDB ID",
  imdbID: "IMDb id (tt0086567)",
  Title: "Film title (best-guess match)",
  Year: "YYYY — improves title matching",
  Directors: "Comma-separated; quoted when needed",
  Rating: "0.5–5 in half-star steps",
  Rating10: "Integer 1–10 (converted by Letterboxd)",
  WatchedDate: "YYYY-MM-DD diary entry",
  Rewatch: "true/false when WatchedDate is set",
  Tags: "Comma-separated diary tags",
  Review: "Review text/HTML (diary if dated)",
};

export default function App() {
  const [mode, setMode] = useState<Mode>("csv");
  const [rawInput, setRawInput] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [source, setSource] = useState<Source>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [doneName, setDoneName] = useState<string | null>(null);
  const [selectedCols, setSelectedCols] = useState<ExportColumn[] | null>(null);
  const [colsTouched, setColsTouched] = useState(false);
  const [ratingMode, setRatingMode] = useState<"auto" | "rating" | "rating10">(
    "auto"
  );
  const [downloading, setDownloading] = useState<"full" | "watchlist" | null>(
    null
  );
  const fileRef = useRef<HTMLInputElement>(null);

  // Advanced mode state — persists across mode switches
  const [splitMode, setSplitMode] = useState<SplitMode>("auto");
  const [tokenRoles, setTokenRoles] = useState<TokenRole[]>([]);
  const [rolesTouched, setRolesTouched] = useState(false);
  const [dayMonth, setDayMonth] = useState<number | "">("");
  const [dayYear, setDayYear] = useState<number | "">(new Date().getFullYear());

  /* ---------- CSV auto parse ---------- */
  const csvResult: ParseResult | null = useMemo(() => {
    if (!rawInput.trim()) return null;
    return parseMessyCsv(rawInput);
  }, [rawInput]);

  /* ---------- Advanced pipeline ---------- */
  const advancedTokenized = useMemo(() => {
    if (!rawInput.trim()) {
      return {
        lines: [] as string[][],
        tokensFromFirst: [] as ReturnType<
          typeof tokenizeLines
        >["tokensFromFirst"],
        headerSkipped: false,
        headerCells: [] as string[],
      };
    }
    return tokenizeLines(rawInput, splitMode);
  }, [rawInput, splitMode]);

  useEffect(() => {
    if (!rolesTouched) {
      setTokenRoles(advancedTokenized.tokensFromFirst.map((t) => t.role));
    } else if (
      advancedTokenized.tokensFromFirst.length > 0 &&
      tokenRoles.length !== advancedTokenized.tokensFromFirst.length
    ) {
      const next = advancedTokenized.tokensFromFirst.map(
        (t, i) => tokenRoles[i] ?? t.role
      );
      setTokenRoles(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advancedTokenized]);

  const activeRoles: TokenRole[] = useMemo(
    () =>
      tokenRoles.length === advancedTokenized.tokensFromFirst.length &&
      tokenRoles.length > 0
        ? tokenRoles
        : advancedTokenized.tokensFromFirst.map((t) => t.role),
    [tokenRoles, advancedTokenized]
  );

  const advancedMapped = useMemo(() => {
    if (advancedTokenized.lines.length === 0) {
      return {
        rows: [] as LetterboxdRow[],
        warnings: [] as string[],
        needsMonthYear: false,
      };
    }
    return applyAdvancedMapping(
      advancedTokenized.lines,
      activeRoles,
      dayMonth === "" ? null : dayMonth,
      dayYear === "" ? null : dayYear
    );
  }, [advancedTokenized, activeRoles, dayMonth, dayYear]);

  const advancedActive = rolesTouched && advancedMapped.rows.length > 0;

  const resultRows: LetterboxdRow[] = useMemo(() => {
    if (mode === "advanced") return advancedMapped.rows;
    if (advancedActive) return advancedMapped.rows;
    return csvResult?.rows ?? [];
  }, [mode, advancedMapped, advancedActive, csvResult]);

  const resultWarnings: string[] = useMemo(() => {
    if (mode === "advanced" || advancedActive) return advancedMapped.warnings;
    return csvResult?.warnings ?? [];
  }, [mode, advancedMapped, advancedActive, csvResult]);

  const populatedDefaultCols = useMemo<ExportColumn[]>(() => {
    if (mode === "advanced" || advancedActive) {
      return rolesToExportColumns(activeRoles);
    }
    return csvResult && csvResult.rows.length > 0
      ? getDefaultColumns(csvResult.rows)
      : (["Title", "Year", "Rating"] as ExportColumn[]);
  }, [mode, advancedActive, activeRoles, csvResult]);

  /* Reset only when the input changes — never on mode switch */
  useEffect(() => {
    setColsTouched(false);
    setRolesTouched(false);
    setDownloadError(null);
    setDoneName(null);
  }, [rawInput]);

  useEffect(() => {
    if (resultRows.length === 0) {
      setSelectedCols(null);
      return;
    }
    if (!colsTouched) {
      setSelectedCols(populatedDefaultCols);
    }
  }, [resultRows, colsTouched, populatedDefaultCols]);

  const activeColumns: ExportColumn[] = useMemo(() => {
    if (resultRows.length === 0) return ["Title", "Year", "Rating"];
    let cols = selectedCols ?? populatedDefaultCols;

    if (ratingMode === "rating") {
      cols = cols.filter((c) => c !== "Rating10");
      if (
        !cols.includes("Rating") &&
        resultRows.some((r) => r.rating || r.rating10)
      ) {
        cols = insertAfter(cols, "Year", "Rating");
      }
    } else if (ratingMode === "rating10") {
      cols = cols.filter((c) => c !== "Rating");
      if (
        !cols.includes("Rating10") &&
        resultRows.some((r) => r.rating || r.rating10)
      ) {
        cols = insertAfter(cols, "Year", "Rating10");
      }
    }
    return cols;
  }, [resultRows, selectedCols, ratingMode, populatedDefaultCols]);

  const exportRows: LetterboxdRow[] = useMemo(() => {
    if (ratingMode === "auto") return resultRows;
    return resultRows.map((r) => {
      const copy = { ...r };
      if (ratingMode === "rating") {
        if (!copy.rating && copy.rating10) {
          const n = parseInt(copy.rating10, 10);
          if (!Number.isNaN(n)) {
            const half = Math.round(n) / 2;
            copy.rating = Number.isInteger(half)
              ? String(half)
              : half.toFixed(1);
          }
        }
        copy.rating10 = "";
      } else if (ratingMode === "rating10") {
        if (!copy.rating10 && copy.rating) {
          const n = parseFloat(copy.rating);
          if (!Number.isNaN(n)) copy.rating10 = String(Math.round(n * 2));
        }
        copy.rating = "";
      }
      return copy;
    });
  }, [resultRows, ratingMode]);

  const outputCsv = useMemo(() => {
    if (exportRows.length === 0) return "";
    return toLetterboxdCsv(exportRows, activeColumns);
  }, [exportRows, activeColumns]);

  const watchlist = useMemo(
    () =>
      exportRows.length > 0
        ? toWatchlistCsv(exportRows)
        : { csv: "", count: 0 },
    [exportRows]
  );

  const fileSize = outputCsv ? estimateSizeBytes(outputCsv) : 0;
  const overSize = fileSize > 1_000_000;

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setRawInput(String(reader.result ?? ""));
      setFileName(file.name);
      setSource("file");
    };
    reader.readAsText(file);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onPasteChange = (value: string) => {
    setRawInput(value);
    setSource("paste");
    setFileName(null);
  };

  const loadExample = () => {
    setRawInput(
      (mode === "advanced" ? EXAMPLE_ADVANCED : EXAMPLE_CSV).trim() + "\n"
    );
    setSource("paste");
    setFileName(null);
  };

  const clearAll = () => {
    setRawInput("");
    setFileName(null);
    setSource(null);
    setCopied(false);
    setDownloadError(null);
    setDoneName(null);
    setSelectedCols(null);
    setColsTouched(false);
    setRolesTouched(false);
    setTokenRoles([]);
    setDayMonth("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleDownload = async (kind: "full" | "watchlist") => {
    setDownloadError(null);
    setDoneName(null);

    const csv = kind === "full" ? outputCsv : watchlist.csv;
    if (!csv) {
      setDownloadError("Nothing to download yet — add some rows first.");
      return;
    }
    if (kind === "full" && overSize) {
      setDownloadError(
        "File is over Letterboxd’s 1MB limit. Remove columns or split the file."
      );
      return;
    }

    const stem = fileName
      ? fileName.replace(/\.(csv|tsv|txt)$/i, "")
      : "letterboxd";
    const name =
      kind === "full" ? `${stem}-import.csv` : `${stem}-watchlist.csv`;

    setDownloading(kind);
    try {
      const res = await downloadCsvFile(csv, name);
      if (res.ok) {
        setDoneName(name);
        window.setTimeout(() => setDoneName(null), 4000);
      } else if (res.reason !== "cancelled") {
        setDownloadError(
          "Automatic download was blocked here — use Copy, then paste into a .csv file."
        );
      }
    } catch {
      setDownloadError("Download failed — use Copy, then paste into a .csv file.");
    } finally {
      setDownloading(null);
    }
  };

  const handleCopy = async () => {
    if (!outputCsv) return;
    try {
      await navigator.clipboard.writeText(outputCsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = outputCsv;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setDownloadError("Copy failed — select the raw CSV preview and copy manually.");
      }
      document.body.removeChild(ta);
    }
  };

  const toggleColumn = (col: ExportColumn) => {
    setColsTouched(true);
    const current = activeColumns;
    if (current.includes(col)) {
      const next = current.filter((c) => c !== col);
      const stillHasIdentity = next.some((c) =>
        (IDENTITY_COLUMNS as string[]).includes(c)
      );
      if (!stillHasIdentity) return;
      setSelectedCols(next);
    } else {
      const next = ALL_EXPORT_COLUMNS.filter(
        (c) => c === col || current.includes(c)
      );
      setSelectedCols(next);
    }
  };

  const setRoleAt = (index: number, role: TokenRole) => {
    setRolesTouched(true);
    setTokenRoles((prev) => {
      const base =
        prev.length === advancedTokenized.tokensFromFirst.length
          ? [...prev]
          : advancedTokenized.tokensFromFirst.map((t) => t.role);
      base[index] = role;
      return base;
    });
  };

  const previewColumns = activeColumns.filter((c) =>
    exportRows.some((r) => rowDisplay(r, c))
  );
  const tableCols =
    previewColumns.length > 0 ? previewColumns : activeColumns.slice(0, 4);

  const needsDayMonthYear =
    mode === "advanced" &&
    (advancedMapped.needsMonthYear || activeRoles.includes("watchedDay"));

  const dayTokenSample =
    advancedTokenized.tokensFromFirst.find(
      (_, i) => activeRoles[i] === "watchedDay"
    )?.raw || "11";

  const watchlistPreview = watchlist.csv
    ? watchlist.csv.split("\n").slice(0, 4).join("\n")
    : "";

  return (
    <div className="min-h-screen bg-cy font-sans text-ink selection:bg-yolk selection:text-ink">
      {/* ---------- ambient layers ---------- */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="bg-blueprint absolute inset-0" />
        {/* film strips */}
        <div className="absolute inset-y-0 left-2 hidden w-7 lg:block">
          <div className="absolute inset-y-0 left-0 w-[3px] bg-ink/25" />
          <div className="absolute inset-y-0 right-0 w-[3px] bg-ink/25" />
          <div className="film-holes animate-strip absolute inset-0" />
        </div>
        <div className="absolute inset-y-0 right-2 hidden w-7 lg:block">
          <div className="absolute inset-y-0 left-0 w-[3px] bg-ink/25" />
          <div className="absolute inset-y-0 right-0 w-[3px] bg-ink/25" />
          <div className="film-holes animate-strip absolute inset-0" />
        </div>
        {/* poster watermark */}
        <div className="text-outline absolute -bottom-10 -right-6 hidden select-none font-display text-[11rem] leading-none tracking-tighter md:block">
          CSV
        </div>
      </div>

      {/* ---------- top bar ---------- */}
      <header className="sticky top-0 z-40 border-b-[3px] border-ink bg-cy">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <LogoMark className="h-7 w-16 shrink-0 drop-shadow-[3px_3px_0_rgba(12,12,12,0.85)]" />
            <div>
              <h1 className="font-display text-lg leading-none uppercase tracking-tight sm:text-xl">
                CSV Formatter
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cydark">
                messy lists → letterboxd
                <span className="animate-blink ml-1 inline-block">▊</span>
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            <span className="-rotate-1 border-[3px] border-ink bg-yolk px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide shadow-[4px_4px_0_0_#0c0c0c] sm:text-[11px]">
              ★ Best use with Web scrapper extension from Google Chrome
            </span>

            <div className="inline-flex border-[3px] border-ink bg-white shadow-[4px_4px_0_0_#0c0c0c]">
              <button
                type="button"
                onClick={() => setMode("csv")}
                className={`px-3.5 py-1.5 font-display text-xs uppercase tracking-wide transition-colors ${
                  mode === "csv"
                    ? "bg-ink text-cy"
                    : "text-ink hover:bg-cysoft"
                }`}
              >
                CSV auto
              </button>
              <button
                type="button"
                onClick={() => setMode("advanced")}
                className={`border-l-[3px] border-ink px-3.5 py-1.5 font-display text-xs uppercase tracking-wide transition-colors ${
                  mode === "advanced"
                    ? "bg-ink text-cy"
                    : "text-ink hover:bg-cysoft"
                }`}
              >
                Advanced
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ---------- marquee ---------- */}
      <div className="relative z-10 overflow-hidden border-b-[3px] border-ink bg-ink py-1.5">
        <div className="animate-marquee flex w-max whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.22em] text-cy">
          <span>{MARQUEE.repeat(2)}</span>
          <span aria-hidden>{MARQUEE.repeat(2)}</span>
        </div>
      </div>

      <main className="relative z-10 mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-2">
          {/* ================= INPUT ================= */}
          <Reveal>
            <section className={`flex h-full flex-col ${PANEL}`}>
              <div className="flex items-center justify-between gap-2 border-b-[3px] border-ink bg-ink px-4 py-2.5">
                <h2 className="font-display text-sm uppercase tracking-wider text-cy">
                  {mode === "csv" ? "▸ Input" : "▸ Advanced input"}
                </h2>
                <div className="flex items-center gap-2">
                  {source && (
                    <span className="hidden max-w-[120px] truncate font-mono text-[10px] uppercase text-cy/60 sm:inline">
                      {source === "file" && fileName ? fileName : "pasted"}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={loadExample}
                    className="border-2 border-cy/60 px-2.5 py-1 font-mono text-[11px] uppercase text-cy transition-colors hover:bg-cy hover:text-ink"
                  >
                    Example
                  </button>
                  <button
                    type="button"
                    onClick={clearAll}
                    disabled={!rawInput}
                    className="border-2 border-cy/40 px-2.5 py-1 font-mono text-[11px] uppercase text-cy/70 transition-colors hover:bg-cy hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {mode === "csv" && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className={`mx-4 mt-4 flex items-center justify-between gap-4 border-[3px] border-dashed border-ink px-4 py-5 transition-colors ${
                    dragOver ? "bg-yolk" : "bg-cysoft hover:bg-[#c4efd6]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <UploadIcon className="h-7 w-7 shrink-0" />
                    <div>
                      <p className="font-display text-sm uppercase">
                        Drop a CSV here
                      </p>
                      <p className="font-mono text-[11px] text-cydark">
                        letterboxd · imdb · tsv · spreadsheets
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className={`${BTN} ${PUSH} shrink-0 bg-white px-4 py-2 text-xs`}
                  >
                    Browse
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.tsv,.txt,text/csv,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                    }}
                  />
                </div>
              )}

              <div className="flex flex-1 flex-col p-4 pt-3">
                <label className="mb-2 font-mono text-[11px] uppercase tracking-wider text-cydark">
                  {mode === "csv"
                    ? "// paste csv or messy data"
                    : "// one film per line, any separator"}
                </label>
                <textarea
                  value={rawInput}
                  onChange={(e) => onPasteChange(e.target.value)}
                  placeholder={
                    mode === "csv"
                      ? `Title,Year,Rating\nTop Gun,1986,5\n"Paris, Texas",1984,4`
                      : `Top Gun 1986 5 11\nGremlins 1984 4.5 24`
                  }
                  spellCheck={false}
                  className="min-h-[180px] flex-1 resize-y border-[3px] border-ink bg-white px-3 py-2.5 font-mono text-xs leading-relaxed transition-shadow placeholder:text-ink/30 focus:shadow-[4px_4px_0_0_#ff8000] focus:outline-none sm:text-sm"
                />

                {/* -------- advanced controls -------- */}
                {mode === "advanced" && rawInput.trim() && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-cydark">
                        // split by
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(
                          [
                            ["auto", "Auto"],
                            ["comma", "Comma"],
                            ["semicolon", "Semicolon"],
                            ["tab", "Tab"],
                            ["pipe", "Pipe"],
                            ["space", "Spaces"],
                          ] as const
                        ).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => {
                              setSplitMode(id);
                              setRolesTouched(false);
                            }}
                            className={`border-2 border-ink px-2.5 py-1 font-mono text-[11px] uppercase transition-colors ${
                              splitMode === id
                                ? "bg-ink text-cy"
                                : "bg-white hover:bg-cysoft"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {advancedTokenized.headerSkipped && (
                      <p className="border-[3px] border-ink bg-mint px-3 py-2 font-mono text-xs shadow-[4px_4px_0_0_#0c0c0c]">
                        ✓ Header row skipped ({advancedTokenized.headerCells.join(", ")})
                        — it never enters your film list.
                      </p>
                    )}

                    <div>
                      <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-cydark">
                        // map each part — say what every element is
                      </p>
                      <p className="mb-3 text-xs leading-relaxed text-ink/60">
                        Bare numbers like{" "}
                        <code className="border border-ink bg-cysoft px-1 font-mono">
                          11
                        </code>{" "}
                        are read as a watched <strong>day</strong> — set month &
                        year once below and every row gets a full date.
                      </p>
                      <div className="space-y-2">
                        {advancedTokenized.tokensFromFirst.map((tok, i) => {
                          const role = activeRoles[i] ?? tok.role;
                          const samples = advancedTokenized.lines
                            .slice(0, 4)
                            .map((l) => l[i])
                            .filter(Boolean);
                          return (
                            <div
                              key={i}
                              className="flex flex-col gap-2 border-[3px] border-ink bg-white p-3 shadow-[4px_4px_0_0_#0c0c0c] transition-transform hover:-translate-y-0.5 sm:flex-row sm:items-center"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="font-mono text-[10px] uppercase tracking-wider text-cydark">
                                  part {i + 1}
                                </div>
                                <div className="truncate font-mono text-sm font-medium">
                                  {tok.raw || "—"}
                                </div>
                                {samples.length > 1 && (
                                  <div className="mt-0.5 truncate font-mono text-[10px] text-ink/40">
                                    e.g. {samples.slice(0, 3).join(" · ")}
                                  </div>
                                )}
                              </div>
                              <select
                                value={role}
                                onChange={(e) =>
                                  setRoleAt(i, e.target.value as TokenRole)
                                }
                                className={`w-full shrink-0 border-[3px] border-ink px-3 py-2 font-mono text-xs focus:outline-none sm:w-48 ${
                                  role === "watchedDay"
                                    ? "bg-yolk"
                                    : "bg-cysoft focus:bg-white"
                                }`}
                              >
                                {TOKEN_ROLES.map((r) => (
                                  <option key={r.id} value={r.id} title={r.hint}>
                                    {r.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                        {advancedTokenized.tokensFromFirst.length === 0 && (
                          <p className="font-mono text-xs text-ink/50">
                            // no tokens detected yet
                          </p>
                        )}
                      </div>
                    </div>

                    {needsDayMonthYear && (
                      <div className="border-[3px] border-ink bg-yolk p-4 shadow-[6px_6px_0_0_#0c0c0c]">
                        <p className="font-display text-sm uppercase">
                          ⚠ Day-only watched dates
                        </p>
                        <p className="mb-3 mt-1 text-xs leading-relaxed text-ink/70">
                          A field holds just the day (
                          <code className="font-mono font-bold">
                            {dayTokenSample}
                          </code>
                          ). Pick the month and year once — every row becomes a
                          full <code className="font-mono">YYYY-MM-DD</code>{" "}
                          WatchedDate.
                        </p>
                        <div className="flex flex-wrap gap-3">
                          <label className="flex flex-col gap-1 font-mono text-[11px] uppercase">
                            Month
                            <select
                              value={dayMonth === "" ? "" : String(dayMonth)}
                              onChange={(e) =>
                                setDayMonth(
                                  e.target.value === ""
                                    ? ""
                                    : parseInt(e.target.value, 10)
                                )
                              }
                              className="border-[3px] border-ink bg-white px-3 py-2 font-sans text-sm normal-case focus:outline-none"
                            >
                              <option value="">Select month…</option>
                              {MONTHS.map((m) => (
                                <option key={m.value} value={m.value}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1 font-mono text-[11px] uppercase">
                            Year
                            <input
                              type="number"
                              min={1900}
                              max={2100}
                              value={dayYear === "" ? "" : dayYear}
                              onChange={(e) =>
                                setDayYear(
                                  e.target.value === ""
                                    ? ""
                                    : parseInt(e.target.value, 10)
                                )
                              }
                              placeholder="2024"
                              className="w-28 border-[3px] border-ink bg-white px-3 py-2 font-sans text-sm focus:outline-none"
                            />
                          </label>
                        </div>
                        {dayMonth !== "" && dayYear !== "" && (
                          <p className="mt-3 border-2 border-ink bg-white px-3 py-2 font-mono text-xs">
                            day <strong>{dayTokenSample}</strong> →{" "}
                            <strong>
                              {String(dayYear)}-
                              {String(dayMonth).padStart(2, "0")}-
                              {String(parseInt(dayTokenSample, 10) || 1).padStart(2, "0")}
                            </strong>{" "}
                            on every row
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </Reveal>

          {/* ================= OUTPUT ================= */}
          <Reveal delay={120}>
            <section className={`flex h-full flex-col ${PANEL}`}>
              <div className="flex items-center justify-between gap-2 border-b-[3px] border-ink bg-ink px-4 py-2.5">
                <h2 className="font-display text-sm uppercase tracking-wider text-cy">
                  ▸ Letterboxd output
                </h2>
                <div className="flex items-center gap-2">
                  {mode === "csv" && advancedActive && (
                    <button
                      type="button"
                      onClick={() => setMode("advanced")}
                      className="border-2 border-cy/60 px-2 py-0.5 font-mono text-[10px] uppercase text-cy transition-colors hover:bg-cy hover:text-ink"
                      title="This output comes from your Advanced mapping — click to edit"
                    >
                      adv mapping
                    </button>
                  )}
                  {exportRows.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 border-2 border-ink bg-mint px-2 py-0.5 font-mono text-[11px] font-bold">
                      <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-ink" />
                      {exportRows.length} rows
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-1 flex-col p-4">
                {!rawInput.trim() ? (
                  <EmptyState mode={mode} />
                ) : exportRows.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
                    <p className="font-display text-sm uppercase">No valid rows yet</p>
                    <p className="mt-1 max-w-xs font-mono text-xs text-ink/50">
                      {mode === "advanced"
                        ? "// map at least one part to Title (or an ID)"
                        : "// needs Title, imdbID, tmdbID or LetterboxdURI"}
                    </p>
                    {resultWarnings.length > 0 && (
                      <div className="mt-4 max-w-sm space-y-1 text-left">
                        {resultWarnings.map((w, i) => (
                          <p key={i} className="font-mono text-xs text-ink/70">
                            ⚠ {w}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {mode === "csv" && !advancedActive && csvResult && (
                      <div className="mb-3">
                        <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-cydark">
                          // detected source columns
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {(
                            Object.entries(csvResult.detectedColumns) as [
                              string,
                              string | undefined,
                            ][]
                          ).map(
                            ([k, v]) =>
                              v && (
                                <span
                                  key={k}
                                  className="inline-flex items-center gap-1 border-2 border-ink bg-[#c9f7d8] px-2 py-0.5 font-mono text-[11px]"
                                >
                                  <span className="text-ink/50">{k}</span>
                                  <span className="max-w-[100px] truncate font-bold">
                                    {v}
                                  </span>
                                </span>
                              )
                          )}
                        </div>
                      </div>
                    )}

                    {resultWarnings.length > 0 && (
                      <div className="mb-3 space-y-1.5 border-[3px] border-ink bg-[#fff3a3] px-3 py-2.5 shadow-[4px_4px_0_0_#0c0c0c]">
                        {resultWarnings.map((w, i) => (
                          <p key={i} className="flex gap-2 font-mono text-xs">
                            <span className="shrink-0 font-bold">⚠</span>
                            {w}
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="mb-3 border-[3px] border-ink bg-cysoft p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="font-mono text-[11px] uppercase tracking-wider text-cydark">
                          // export columns
                        </p>
                        <div className="inline-flex border-2 border-ink bg-white">
                          {(
                            [
                              ["auto", "Auto"],
                              ["rating", "0.5–5"],
                              ["rating10", "/10"],
                            ] as const
                          ).map(([id, label], idx) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setRatingMode(id)}
                              className={`${idx > 0 ? "border-l-2 border-ink" : ""} px-2 py-1 font-mono text-[11px] transition-colors ${
                                ratingMode === id
                                  ? "bg-ink text-cy"
                                  : "hover:bg-cysoft"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {ALL_EXPORT_COLUMNS.map((col) => {
                          const on = activeColumns.includes(col);
                          return (
                            <button
                              key={col}
                              type="button"
                              title={COLUMN_HELP[col]}
                              onClick={() => toggleColumn(col)}
                              className={`border-2 border-ink px-2 py-1 font-mono text-[11px] transition-all ${
                                on
                                  ? "bg-lb text-white shadow-[2px_2px_0_0_#0c0c0c]"
                                  : "bg-white text-ink/45 hover:bg-cysoft hover:text-ink"
                              }`}
                            >
                              {col}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mb-4 max-h-[280px] overflow-auto border-[3px] border-ink">
                      <table className="w-full min-w-[480px] text-left text-sm">
                        <thead className="sticky top-0 z-10 bg-ink">
                          <tr className="font-mono text-[10px] uppercase tracking-wider text-cy">
                            <th className="px-2 py-2.5 font-medium">#</th>
                            {tableCols.map((c) => (
                              <th key={c} className="px-2 py-2.5 font-medium">
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y-2 divide-ink/10 bg-white">
                          {exportRows.map((row, i) => (
                            <tr key={i} className="transition-colors hover:bg-cysoft">
                              <td className="px-2 py-2 font-mono text-xs text-ink/40">
                                {i + 1}
                              </td>
                              {tableCols.map((c) => (
                                <td
                                  key={c}
                                  className="max-w-[160px] truncate px-2 py-2 text-xs"
                                  title={rowDisplay(row, c)}
                                >
                                  {formatCell(row, c)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <details className="mb-4 border-[3px] border-ink bg-ink">
                      <summary className="cursor-pointer px-3 py-2 font-mono text-xs uppercase tracking-wider text-cy transition-colors hover:text-yolk">
                        ▸ raw csv ({formatBytes(fileSize)})
                      </summary>
                      <pre className="max-h-40 select-text overflow-auto border-t-2 border-cy/30 p-3 font-mono text-[11px] leading-relaxed text-mint">
                        {outputCsv}
                      </pre>
                    </details>

                    {downloadError && (
                      <p className="mb-3 border-[3px] border-ink bg-danger px-3 py-2 font-mono text-xs font-bold text-white shadow-[4px_4px_0_0_#0c0c0c]">
                        ✕ {downloadError}
                      </p>
                    )}
                    {doneName && !downloadError && (
                      <p className="mb-3 border-[3px] border-ink bg-mint px-3 py-2 font-mono text-xs shadow-[4px_4px_0_0_#0c0c0c]">
                        ✓ <strong>{doneName}</strong> on the way — check your
                        downloads folder.
                      </p>
                    )}

                    <div className="mt-auto space-y-3">
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => void handleDownload("full")}
                          disabled={!outputCsv || overSize || downloading !== null}
                          className={`${BTN} ${PUSH} flex-1 bg-lb px-5 py-3 text-white sm:flex-none`}
                        >
                          <DownloadIcon className="h-4 w-4" />
                          {downloading === "full"
                            ? "Saving…"
                            : "Download CSV"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopy()}
                          disabled={!outputCsv}
                          className={`${BTN} ${PUSH} flex-1 bg-white px-5 py-3 sm:flex-none`}
                        >
                          {copied ? (
                            <>
                              <CheckIcon className="h-4 w-4 text-[#009a3d]" />
                              Copied
                            </>
                          ) : (
                            <>
                              <CopyIcon className="h-4 w-4" />
                              Copy
                            </>
                          )}
                        </button>
                      </div>

                      {/* watchlist export */}
                      <div className="border-[3px] border-ink bg-cysoft p-4 shadow-[5px_5px_0_0_#0c0c0c]">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-display text-sm uppercase">
                              Watchlist version
                            </p>
                            <p className="mt-1 max-w-md text-xs leading-relaxed text-ink/70">
                              Letterboxd only files a CSV to your{" "}
                              <strong>Watchlist</strong> when it’s a clean list
                              of titles — a date or rating column turns it into
                              a Diary import. This strips everything down to{" "}
                              <code className="border border-ink bg-white px-1 font-mono">
                                Title,Year
                              </code>{" "}
                              ({watchlist.count} title
                              {watchlist.count !== 1 ? "s" : ""}). On the import
                              page, select{" "}
                              <strong>“Import to Watchlist”</strong> before
                              Check&nbsp;and&nbsp;Confirm.
                            </p>
                            {watchlistPreview && (
                              <pre className="mt-2 max-w-full overflow-x-auto border-2 border-ink bg-white p-2 font-mono text-[10px] leading-relaxed text-ink/70">
                                {watchlistPreview}
                                {watchlist.count > 3 ? "\n…" : ""}
                              </pre>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleDownload("watchlist")}
                            disabled={watchlist.count === 0 || downloading !== null}
                            className={`${BTN} ${PUSH} shrink-0 bg-ink px-4 py-3 text-cy`}
                          >
                            <BookmarkIcon className="h-4 w-4" />
                            {downloading === "watchlist"
                              ? "Saving…"
                              : "Watchlist CSV"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </section>
          </Reveal>
        </div>

        {/* ================= HOW ADVANCED WORKS ================= */}
        <Reveal className="mt-12">
          <section className={PANEL}>
            <div className="border-b-[3px] border-ink bg-ink px-5 py-3">
              <h3 className="font-display text-base uppercase tracking-wide text-cy">
                How Advanced works
              </h3>
            </div>
            <div className="space-y-3 p-5">
              {[
                {
                  n: "01",
                  t: "Paste your lines",
                  d: "One film per line, any separator — spaces, commas, tabs, pipes. Scraped straight off a page? Paste it raw.",
                  code: "Top Gun 1986 5 11",
                },
                {
                  n: "02",
                  t: "Label each element",
                  d: "We split the line and guess — you confirm each part: Title, Year, Rating, Watched day… Column headers are detected and skipped automatically.",
                  code: "Part 3 → Rating",
                },
                {
                  n: "03",
                  t: "Day-only dates get completed",
                  d: "A bare number like 11 is read as the watched day. Pick the month and year once — every row becomes a full Letterboxd WatchedDate.",
                  code: "11 + March + 2024 → 2024-03-11",
                },
              ].map((step) => (
                <div
                  key={step.n}
                  className="group flex flex-col gap-3 border-[3px] border-ink bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_#0c0c0c] sm:flex-row sm:items-center"
                >
                  <span className="font-display text-3xl text-lb">{step.n}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-sm uppercase">{step.t}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink/60">
                      {step.d}
                    </p>
                  </div>
                  <code className="shrink-0 border-2 border-ink bg-ink px-3 py-1.5 font-mono text-[11px] text-mint">
                    {step.code}
                  </code>
                </div>
              ))}
            </div>
          </section>
        </Reveal>

        {/* ================= SPEC ================= */}
        <Reveal className="mt-6" delay={100}>
          <section className="border-[3px] border-ink bg-ink text-white shadow-[8px_8px_0_0_rgba(12,12,12,0.35)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b-[3px] border-cy/30 px-5 py-3">
              <h3 className="font-display text-base uppercase tracking-wide text-cy">
                Letterboxd import columns
              </h3>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cy/50">
                per official docs
              </p>
            </div>
            <div className="grid gap-x-6 gap-y-1 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ["LetterboxdURI", "optional URI match (boxd.it/…)"],
                  ["tmdbID", "optional numeric TMDB id"],
                  ["imdbID", "optional tt… IMDb id"],
                  ["Title", "title match when no ID/URI"],
                  ["Year", "YYYY — better title matching"],
                  ["Directors", "comma-separated names"],
                  ["Rating", "0.5–5 half-star decimals"],
                  ["Rating10", "integers 1–10"],
                  ["WatchedDate", "YYYY-MM-DD diary date"],
                  ["Rewatch", "true / false with diary"],
                  ["Tags", "comma-separated tags"],
                  ["Review", "review text / list notes"],
                ] as const
              ).map(([col, desc]) => (
                <div
                  key={col}
                  className="flex items-baseline gap-2 border-b border-white/10 py-1.5"
                >
                  <code className="shrink-0 font-mono text-xs font-bold text-yolk">
                    {col}
                  </code>
                  <span className="truncate font-mono text-[11px] text-white/50">
                    {desc}
                  </span>
                </div>
              ))}
            </div>
            <div className="grid gap-4 border-t-[3px] border-cy/30 p-5 sm:grid-cols-2">
              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cy/60">
                  diary / profile file
                </p>
                <pre className="overflow-x-auto border-2 border-cy/40 bg-black/40 p-3 font-mono text-xs leading-relaxed text-mint">
{`Title,Year,Rating,WatchedDate
Top Gun,1986,5,2024-03-11
"Paris, Texas",1984,4,2024-03-15`}
                </pre>
              </div>
              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cy/60">
                  watchlist file — no dates, no ratings
                </p>
                <pre className="overflow-x-auto border-2 border-yolk/50 bg-black/40 p-3 font-mono text-xs leading-relaxed text-yolk">
{`Title,Year
Top Gun,1986
Gremlins,1984
Inception,2010`}
                </pre>
              </div>
            </div>
            <p className="px-5 pb-5 font-mono text-[11px] leading-relaxed text-white/40">
              UTF-8 · comma delimiters (no space after commas) · at least one of
              LetterboxdURI / tmdbID / imdbID / Title · 1MB max · import via
              Settings → Import & Export. There is no undo after confirmation.
            </p>
          </section>
        </Reveal>

        <footer className="mt-12 border-[3px] border-ink bg-ink px-5 py-4 shadow-[6px_6px_0_0_rgba(12,12,12,0.35)]">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center">
            <LogoMark className="h-4 w-10 opacity-90" />
            <p className="font-mono text-[11px] uppercase tracking-wider text-cy">
              ★ works best with the Web scrapper extension for Google Chrome ★
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}

/* ---------------- small pieces ---------------- */

function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.08 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-500 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 56 24" className={className} aria-hidden>
      <g style={{ mixBlendMode: "multiply" }}>
        <circle cx="13" cy="12" r="9.5" fill="#40bcf4" />
        <circle cx="28" cy="12" r="9.5" fill="#00e054" />
        <circle cx="43" cy="12" r="9.5" fill="#ff8000" />
      </g>
    </svg>
  );
}

function insertAfter(
  cols: ExportColumn[],
  after: ExportColumn,
  item: ExportColumn
): ExportColumn[] {
  if (cols.includes(item)) return cols;
  const i = cols.indexOf(after);
  if (i === -1) return [...cols, item];
  return [...cols.slice(0, i + 1), item, ...cols.slice(i + 1)];
}

function rowDisplay(row: LetterboxdRow, col: ExportColumn): string {
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

function formatCell(row: LetterboxdRow, col: ExportColumn) {
  const v = rowDisplay(row, col);
  if (!v) return <span className="text-ink/25">—</span>;
  if (col === "Rating" || col === "Rating10") {
    return (
      <span className="font-mono font-bold text-lb">
        {v}
        {col === "Rating" && <span className="ml-0.5 text-[10px]">★</span>}
      </span>
    );
  }
  if (col === "WatchedDate") {
    return <span className="font-mono font-bold text-cydark">{v}</span>;
  }
  return v;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function EmptyState({ mode }: { mode: Mode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center border-[3px] border-dashed border-ink/30 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center border-[3px] border-ink bg-cysoft shadow-[4px_4px_0_0_#0c0c0c]">
        <FilmIcon className="h-6 w-6" />
      </div>
      <p className="font-display text-sm uppercase">Waiting for input</p>
      <p className="mt-1 max-w-xs font-mono text-xs text-ink/50">
        {mode === "advanced"
          ? "// paste freeform lines, map each part, download"
          : "// drop or paste a csv to build an import file"}
      </p>
    </div>
  );
}

function FilmIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
      <line x1="7" y1="2" x2="7" y2="22" />
      <line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="2" y1="7" x2="7" y2="7" />
      <line x1="2" y1="17" x2="7" y2="17" />
      <line x1="17" y1="17" x2="22" y2="17" />
      <line x1="17" y1="7" x2="22" y2="7" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function BookmarkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
