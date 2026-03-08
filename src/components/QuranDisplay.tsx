/**
 * QuranDisplay.tsx
 *
 * Key changes in this version:
 * 1. CHARACTER-LEVEL tajweed coloring — uses charStart/charEnd from server
 *    annotations to color only the specific letter(s), not the whole word.
 *    Matches the standard Madina Mushaf coloring scheme.
 * 2. IMPROVED current-word highlight — gold underline + subtle background
 *    that's clearly visible on Arabic text in both light and dark modes.
 * 3. POST-RECITATION states: correct words show green (or amber if violation).
 */

import { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { type QuranWord } from "@/lib/quranApi";
import { TAJWEED_RULES, type TajweedInfo } from "@/lib/tajweedUtils";
import {
  Info,
  X,
  BookOpen,
  AlignJustify,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { TajweedBadge } from "@/components/TajweedIndicator";
import type { WordTajweedStatus } from "@/hooks/useTajweedAnalysis";

// ── Dark mode hook ─────────────────────────────────────────────────────────────

function useDarkMode() {
  const [isDark, setIsDark] = useState(
    () => !document.documentElement.classList.contains("light"),
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(!document.documentElement.classList.contains("light")),
    );
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

// ── Tajweed colour map ─────────────────────────────────────────────────────────
// Matches standard Madina Mushaf colors

const CATEGORY_COLORS: Record<string, { light: string; dark: string }> = {
  ghunna: { light: "#c0392b", dark: "#e74c3c" }, // red
  qalqalah: { light: "#27ae60", dark: "#2ecc71" }, // green
  madd: { light: "#2471a3", dark: "#5dade2" }, // blue
  ikhfa: { light: "#d35400", dark: "#e67e22" }, // orange
  idgham: { light: "#148f77", dark: "#1abc9c" }, // teal
  iqlab: { light: "#7d3c98", dark: "#a569bd" }, // purple
  lam_shams: { light: "#148f77", dark: "#1abc9c" }, // teal (same as idgham)
};

function getCategoryColor(category: string, isDark: boolean): string {
  const c = CATEGORY_COLORS[category];
  if (!c) return "inherit";
  return isDark ? c.dark : c.light;
}

// ── Character-level tajweed annotation ────────────────────────────────────────

interface CharAnnotation {
  color: string; // resolved CSS color
  category: string;
  rule: string;
  description: string;
  arabicName: string;
}

/**
 * Build a per-character color map from server rule annotations.
 * charStart/charEnd index into the word's Unicode codepoint array.
 * A single character can only have one color (first rule wins by priority).
 */
function buildCharColorMap(
  wordText: string,
  serverRules: any[],
  isDark: boolean,
): Map<number, CharAnnotation> {
  const map = new Map<number, CharAnnotation>();
  if (!serverRules || serverRules.length === 0) return map;

  // Priority order: higher priority rules color their chars last (overwrite)
  // so we iterate in reverse priority — lower priority first
  const priorityOrder = [
    "lam_shams",
    "ikhfa",
    "ikhfa_shafawi",
    "idgham_ghunnah",
    "idgham_no_ghunnah",
    "idgham_shafawi",
    "iqlab",
    "qalqalah",
    "madd_2",
    "madd_246",
    "madd_munfasil",
    "madd_muttasil",
    "madd_6",
    "ghunnah",
  ];

  const sorted = [...serverRules].sort((a, b) => {
    const ai = priorityOrder.indexOf(a.rule);
    const bi = priorityOrder.indexOf(b.rule);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const rule of sorted) {
    const color = getCategoryColor(rule.category, isDark);
    if (color === "inherit") continue;

    const annotation: CharAnnotation = {
      color,
      category: rule.category,
      rule: rule.rule,
      description: rule.description,
      arabicName: rule.arabicName,
    };

    // charStart/charEnd are byte/char indices into the word string
    const start = rule.charStart ?? 0;
    const end = rule.charEnd ?? wordText.length;

    for (let i = start; i < end; i++) {
      map.set(i, annotation);
    }
  }

  return map;
}

/**
 * Render a word string as a series of <span>s, each character individually
 * colored according to its tajweed annotation.
 *
 * When the word is "current" (being recited), ALL characters use the
 * current-word foreground color (gold) — tajweed colors are suppressed.
 *
 * When "correct" or "incorrect", the recitation state color overrides tajweed
 * EXCEPT for the specific tajweed-colored characters which keep their color
 * (matching Mushaf behavior: even after reciting, you can see which letters
 * had rules).
 *
 * When "pending", only the tajweed letters are colored; the rest inherit.
 */
function renderWordChars(
  wordText: string,
  charColorMap: Map<number, CharAnnotation>,
  state: "pending" | "current" | "correct" | "incorrect",
  recitationColor: string | undefined, // green/amber/red after recitation
  isDark: boolean,
): React.ReactNode {
  const chars = [...wordText]; // proper Unicode codepoint split

  if (state === "current") {
    // Current word: all chars in the highlight foreground — no tajweed colors
    return (
      <>
        {chars.map((ch, i) => (
          <span key={i}>{ch}</span>
        ))}
      </>
    );
  }

  return (
    <>
      {chars.map((ch, i) => {
        const annotation = charColorMap.get(i);

        if (state === "correct" || state === "incorrect") {
          // After recitation: use recitation color for non-annotated chars,
          // tajweed color for annotated chars
          const color = annotation ? annotation.color : recitationColor;
          return (
            <span
              key={i}
              style={color ? { color } : undefined}
              title={annotation?.description}
            >
              {ch}
            </span>
          );
        }

        // Pending: only tajweed-annotated chars are colored
        if (annotation) {
          return (
            <span
              key={i}
              style={{ color: annotation.color }}
              title={annotation.description}
            >
              {ch}
            </span>
          );
        }
        return <span key={i}>{ch}</span>;
      })}
    </>
  );
}

// ── Legend panel ──────────────────────────────────────────────────────────────

function TajweedLegend({
  onClose,
  isDark,
}: {
  onClose: () => void;
  isDark: boolean;
}) {
  const bg = isDark ? "hsl(160 18% 8%)" : "#fff";
  return (
    <div
      className="absolute top-full left-0 mt-2 z-50 w-80 rounded-xl border border-border shadow-2xl overflow-hidden"
      style={{ background: bg }}
      dir="ltr"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground">
          Tajweed Colour Guide
        </span>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="divide-y divide-border/40 max-h-96 overflow-y-auto">
        {Object.values(TAJWEED_RULES).map((info) => (
          <div key={info.rule} className="px-4 py-3 flex gap-3">
            <div
              className="w-3 h-3 rounded-full shrink-0 mt-1"
              style={{ background: getCategoryColor(info.rule, isDark) }}
            />
            <div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span
                  className="text-sm font-semibold"
                  style={{ color: getCategoryColor(info.rule, isDark) }}
                >
                  {info.label}
                </span>
                <span className="font-quran text-base text-muted-foreground">
                  {info.arabic}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {info.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface WordStatus {
  state: "pending" | "current" | "correct" | "incorrect";
  retries: number;
}

interface QuranDisplayProps {
  words: QuranWord[];
  currentIndex: number;
  wordStatuses: Map<number, WordStatus>;
  showPending: boolean;
  surahName?: string;
  surahEnglishName?: string;
  surahNumber?: number;
  tajweedStatuses?: Map<number, WordTajweedStatus>;
  tajweedRules?: Map<number, any[]>;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function QuranDisplay({
  words,
  currentIndex,
  wordStatuses,
  showPending,
  surahName,
  surahEnglishName,
  surahNumber,
  tajweedStatuses,
  tajweedRules,
}: QuranDisplayProps) {
  const currentWordRef = useRef<HTMLSpanElement>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [hoveredRule, setHoveredRule] = useState<string | null>(null);
  const [hoveredInfo, setHoveredInfo] = useState<TajweedInfo | null>(null);
  const [viewMode, setViewMode] = useState<"scroll" | "book">("scroll");
  const [manualPageIdx, setManualPageIdx] = useState<number | null>(null);
  const isDark = useDarkMode();

  useEffect(() => {
    setManualPageIdx(null);
  }, [surahNumber, viewMode]);

  useEffect(() => {
    if (viewMode === "scroll") {
      currentWordRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [currentIndex, viewMode]);

  const pageBackground = isDark
    ? "linear-gradient(160deg, hsl(40 20% 7%) 0%, hsl(40 15% 5%) 100%)"
    : "linear-gradient(160deg, #fdf8f0 0%, #f9f1df 100%)";
  const borderGold = isDark ? "rgba(180,140,60,0.18)" : "rgba(150,110,30,0.2)";
  const goldColor = isDark ? "hsl(45 70% 55%)" : "hsl(45 65% 35%)";

  if (words.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div
          className="font-quran text-5xl opacity-20"
          style={{ color: goldColor }}
        >
          بسم الله
        </div>
        <p className="text-muted-foreground text-sm">Select a Surah to begin</p>
      </div>
    );
  }

  // Group into ayahs
  const ayahs = new Map<number, QuranWord[]>();
  for (const w of words) {
    const arr = ayahs.get(w.ayahNumber) ?? [];
    arr.push(w);
    ayahs.set(w.ayahNumber, arr);
  }

  // Group into pages
  const pageMap = new Map<number, QuranWord[]>();
  for (const w of words) {
    if (w.page == null) continue;
    const arr = pageMap.get(w.page) ?? [];
    arr.push(w);
    pageMap.set(w.page, arr);
  }
  const pageNumbers = Array.from(pageMap.keys()).sort((a, b) => a - b);
  const hasPages = pageNumbers.length > 0;

  // ── Render a single word ──────────────────────────────────────────────────
  const renderWord = (
    word: QuranWord,
    wi: number,
    ayahWords: QuranWord[],
    ayahNum: number,
  ) => {
    const isCurrent = word.globalIndex === currentIndex;
    const status = wordStatuses.get(word.globalIndex);
    const state = status?.state ?? "pending";
    const retries = status?.retries ?? 0;

    // Get server-side char-level annotations
    const serverRules = tajweedRules?.get(word.globalIndex) ?? [];
    const charColorMap = buildCharColorMap(word.text, serverRules, isDark);

    // Primary tajweed category for hover dimming (use first rule's category)
    const primaryCategory = serverRules[0]?.category ?? null;
    const isHoverDimmed = hoveredRule && primaryCategory !== hoveredRule;

    // Acoustic verification result
    const tajweedAcoustic = tajweedStatuses?.get(word.globalIndex);

    // Recitation state color (applied to non-annotated chars after recitation)
    let recitationColor: string | undefined;
    if (state === "correct") {
      recitationColor = tajweedAcoustic?.has_violation
        ? isDark
          ? "#f39c12"
          : "#e67e22" // amber = tajweed violation
        : isDark
          ? "#2ecc71"
          : "#1e8449"; // green = correct
    } else if (state === "incorrect") {
      recitationColor = isDark ? "#e74c3c" : "#c0392b";
    }

    // Tooltip for hover over a word that has tajweed rules
    const primaryRule = serverRules[0];
    const hoverHandler = primaryRule
      ? {
          onMouseEnter: () => {
            setHoveredRule(primaryCategory);
            setHoveredInfo({
              rule: primaryRule.rule,
              color: getCategoryColor(primaryCategory, isDark),
              label: primaryRule.arabicName || primaryRule.rule,
              arabic: primaryRule.arabicName,
              description: primaryRule.description,
            } as TajweedInfo);
          },
          onMouseLeave: () => {
            setHoveredRule(null);
            setHoveredInfo(null);
          },
        }
      : {};

    return (
      <span
        key={word.globalIndex}
        ref={isCurrent ? currentWordRef : undefined}
        className={cn(
          "relative inline-block cursor-default mx-[0.12em]",
          // Current word: gold underline highlight, clearly visible on Arabic
          isCurrent && "current-word-highlight",
          state === "incorrect" && "animate-[shake_0.3s_ease-in-out]",
          isHoverDimmed && "opacity-20",
        )}
        {...hoverHandler}
      >
        {renderWordChars(
          word.text,
          charColorMap,
          state,
          recitationColor,
          isDark,
        )}

        {/* Acoustic tajweed badge (dot) shown after recitation */}
        {state === "correct" && tajweedAcoustic && (
          <TajweedBadge status={tajweedAcoustic} isDark={isDark} />
        )}

        {/* Retry counter */}
        {isCurrent && retries > 0 && (
          <sup
            className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[8px] font-sans rounded-full px-0.5 border"
            style={{
              color: "#e74c3c",
              borderColor: "#e74c3c55",
              background: isDark ? "hsl(160 18% 6%)" : "#fff",
            }}
          >
            {retries}×
          </sup>
        )}
      </span>
    );
  };

  // ── Render ayah ────────────────────────────────────────────────────────────
  const renderAyah = (ayahNum: number, ayahWords: QuranWord[]) => {
    const isAheadOfCurrent = ayahWords[0].globalIndex > currentIndex;
    const isFullyPending = ayahWords.every(
      (w) =>
        (wordStatuses.get(w.globalIndex)?.state ?? "pending") === "pending",
    );
    const shouldHide = isAheadOfCurrent && isFullyPending && !showPending;

    if (shouldHide) {
      return (
        <span key={ayahNum} className="inline">
          <span
            className="inline-block mx-2 font-quran"
            style={{ color: goldColor, fontSize: "0.7em", opacity: 0.5 }}
          >
            ﴿{ayahNum}﴾
          </span>
        </span>
      );
    }
    return (
      <span key={ayahNum}>
        {ayahWords.map((w, wi) => renderWord(w, wi, ayahWords, ayahNum))}
        <span
          className="inline-block mx-1 font-quran"
          style={{ color: goldColor, fontSize: "0.7em" }}
        >
          ﴿{ayahNum}﴾
        </span>
      </span>
    );
  };

  // ── Scroll view ────────────────────────────────────────────────────────────
  const renderScrollView = () => {
    const currentAyah = words[currentIndex]?.ayahNumber ?? 1;
    const allAyahNums = Array.from(ayahs.keys());

    return (
      <div
        className="rounded-2xl p-6 md:p-8 relative"
        style={{
          background: pageBackground,
          border: `1px solid ${borderGold}`,
        }}
      >
        {surahName && (
          <div className="text-center mb-6">
            <div className="font-quran text-2xl" style={{ color: goldColor }}>
              {surahName}
            </div>
            {surahEnglishName && (
              <div className="text-xs text-muted-foreground mt-1 font-sans">
                {surahEnglishName}
              </div>
            )}
          </div>
        )}
        <div
          className="font-quran text-right leading-[2.8] text-[1.5rem] md:text-[1.75rem]"
          dir="rtl"
          style={{ color: isDark ? "hsl(44 20% 82%)" : "hsl(30 15% 18%)" }}
        >
          {allAyahNums.map((n) => renderAyah(n, ayahs.get(n)!))}
        </div>
      </div>
    );
  };

  // ── Book view ──────────────────────────────────────────────────────────────
  const renderBookView = () => {
    if (!hasPages) return renderScrollView();

    const currentPageIdx =
      manualPageIdx !== null
        ? manualPageIdx
        : Math.max(
            0,
            pageNumbers.findIndex((p) => {
              const pw = pageMap.get(p)!;
              return pw.some((w) => w.globalIndex >= currentIndex);
            }),
          );

    const pageNum = pageNumbers[currentPageIdx];
    const pageWords = pageMap.get(pageNum) ?? [];

    // Group page words into ayahs
    const pageAyahs = new Map<number, QuranWord[]>();
    for (const w of pageWords) {
      const arr = pageAyahs.get(w.ayahNumber) ?? [];
      arr.push(w);
      pageAyahs.set(w.ayahNumber, arr);
    }

    return (
      <div className="flex flex-col gap-3">
        <div
          className="rounded-2xl p-6 md:p-8 relative min-h-[60vh]"
          style={{
            background: pageBackground,
            border: `1px solid ${borderGold}`,
          }}
        >
          <div
            className="font-quran text-right leading-[3] text-[1.5rem] md:text-[1.75rem]"
            dir="rtl"
            style={{ color: isDark ? "hsl(44 20% 82%)" : "hsl(30 15% 18%)" }}
          >
            {Array.from(pageAyahs.entries()).map(([n, aw]) =>
              renderAyah(n, aw),
            )}
          </div>
          <div className="text-center mt-4 text-xs text-muted-foreground font-sans">
            {pageNum}
          </div>
        </div>
        <div className="flex items-center justify-center gap-4" dir="ltr">
          <button
            onClick={() => setManualPageIdx(Math.max(0, currentPageIdx - 1))}
            disabled={currentPageIdx === 0}
            className="p-2 rounded-lg border border-border hover:bg-accent disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-muted-foreground">
            Page {pageNum} · {currentPageIdx + 1}/{pageNumbers.length}
          </span>
          <button
            onClick={() =>
              setManualPageIdx(
                Math.min(pageNumbers.length - 1, currentPageIdx + 1),
              )
            }
            disabled={currentPageIdx === pageNumbers.length - 1}
            className="p-2 rounded-lg border border-border hover:bg-accent disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  };

  // ── Full render ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4" dir="ltr">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between flex-wrap gap-2"
        dir="ltr"
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode("scroll")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-sans border transition-colors",
              viewMode === "scroll"
                ? "bg-accent border-border text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <AlignJustify className="w-3.5 h-3.5" /> Scroll
          </button>
          <button
            onClick={() => setViewMode("book")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-sans border transition-colors",
              viewMode === "book"
                ? "bg-accent border-border text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <BookOpen className="w-3.5 h-3.5" /> Book
          </button>
        </div>

        {/* Tajweed legend trigger + inline chips */}
        <div className="relative flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowLegend((s) => !s)}
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
          {showLegend && (
            <TajweedLegend
              onClose={() => setShowLegend(false)}
              isDark={isDark}
            />
          )}

          {/* Compact inline legend chips */}
          {Object.values(TAJWEED_RULES).map((info) => (
            <button
              key={info.rule}
              className={cn(
                "flex items-center gap-1 text-xs font-sans transition-opacity",
                hoveredRule && hoveredRule !== info.rule
                  ? "opacity-20"
                  : "opacity-100",
              )}
              onMouseEnter={() => {
                setHoveredRule(info.rule);
                setHoveredInfo(info);
              }}
              onMouseLeave={() => {
                setHoveredRule(null);
                setHoveredInfo(null);
              }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: getCategoryColor(info.rule, isDark) }}
              />
              <span style={{ color: getCategoryColor(info.rule, isDark) }}>
                {info.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Hovered rule tooltip bar */}
      {hoveredInfo && (
        <div
          className="text-xs font-sans px-3 py-2 rounded-lg border border-border"
          style={{ background: isDark ? "hsl(160 18% 10%)" : "#f9f9f9" }}
          dir="ltr"
        >
          <span
            className="font-semibold"
            style={{ color: getCategoryColor(hoveredInfo.rule ?? "", isDark) }}
          >
            {hoveredInfo.label}
          </span>
          <span className="mx-2 text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            {hoveredInfo.description}
          </span>
        </div>
      )}

      {viewMode === "scroll" ? renderScrollView() : renderBookView()}
    </div>
  );
}
