/**
 * QuranDisplay.tsx
 *
 * Two view modes:
 * 1. SCROLL VIEW (default) — original flowing layout
 * 2. BOOK VIEW — Real Mushaf layout:
 *    - Large justified text filling the entire page
 *    - 15 lines per page like Madinah Mushaf
 *    - Text justified edge-to-edge (text-align: justify)
 *    - Bismillah only on right page for first spread
 *    - Dense, tight line spacing matching a physical Quran
 */

import { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { type QuranWord } from "@/lib/quranApi";
import {
  getWordTajweedInfo,
  type TajweedInfo,
  TAJWEED_RULES,
} from "@/lib/tajweedUtils";
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

// ── Dark mode hook ────────────────────────────────────────────────────────────

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

// ── Tajweed colour map ────────────────────────────────────────────────────────

const TAJWEED_COLORS: Record<string, { light: string; dark: string }> = {
  "tajweed-ghunna": { light: "#c0392b", dark: "#e74c3c" },
  "tajweed-qalqalah": { light: "#27ae60", dark: "#2ecc71" },
  "tajweed-madd": { light: "#2471a3", dark: "#5dade2" },
  "tajweed-ikhfa": { light: "#d35400", dark: "#e67e22" },
  "tajweed-idgham": { light: "#148f77", dark: "#1abc9c" },
  "tajweed-iqlab": { light: "#7d3c98", dark: "#a569bd" },
};

function getTC(cls: string, isDark: boolean): string {
  return isDark
    ? (TAJWEED_COLORS[cls]?.dark ?? "inherit")
    : (TAJWEED_COLORS[cls]?.light ?? "inherit");
}

// ── Tajweed legend panel ──────────────────────────────────────────────────────

function TajweedLegend({
  onClose,
  isDark,
}: {
  onClose: () => void;
  isDark: boolean;
}) {
  return (
    <div
      className="absolute top-full left-0 mt-2 z-50 w-80 rounded-xl border border-border shadow-2xl overflow-hidden"
      style={{ background: isDark ? "hsl(160 18% 8%)" : "#fff" }}
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
              style={{ background: getTC(info.color, isDark) }}
            />
            <div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span
                  className="text-sm font-semibold"
                  style={{ color: getTC(info.color, isDark) }}
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
}

// ── Main component ────────────────────────────────────────────────────────────

export function QuranDisplay({
  words,
  currentIndex,
  wordStatuses,
  showPending,
  surahName,
  surahEnglishName,
  surahNumber,
  tajweedStatuses,
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

  // ── Shared styling ──────────────────────────────────────────────────────
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
          style={{ color: isDark ? "hsl(45 70% 55%)" : "hsl(45 65% 38%)" }}
        >
          بسم الله
        </div>
        <p className="text-muted-foreground text-sm">Select a Surah to begin</p>
      </div>
    );
  }

  // ── Group into ayahs ────────────────────────────────────────────────────
  const ayahs = new Map<number, QuranWord[]>();
  for (const w of words) {
    const arr = ayahs.get(w.ayahNumber) ?? [];
    arr.push(w);
    ayahs.set(w.ayahNumber, arr);
  }

  // ── Group into Mushaf pages (for book view) ─────────────────────────────
  const pageMap = new Map<number, QuranWord[]>();
  for (const w of words) {
    if (w.page == null) continue;
    const arr = pageMap.get(w.page) ?? [];
    arr.push(w);
    pageMap.set(w.page, arr);
  }
  const pageNumbers = Array.from(pageMap.keys()).sort((a, b) => a - b);
  const hasPages = pageNumbers.length > 0;

  // ── Render a single word ────────────────────────────────────────────────
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
    const nextWord =
      wi < ayahWords.length - 1
        ? ayahWords[wi + 1]
        : ayahs.get(ayahNum + 1)?.[0];
    const tajweed = getWordTajweedInfo(word.text, nextWord?.text);
    const isHoverDimmed = hoveredRule && tajweed?.color !== hoveredRule;
    const tajweedAcoustic = tajweedStatuses?.get(word.globalIndex);

    let wordColor: string | undefined;
    if (state === "current") wordColor = undefined;
    else if (state === "correct") {
      wordColor = tajweedAcoustic?.has_violation
        ? isDark
          ? "#f39c12"
          : "#e67e22"
        : isDark
          ? "#2ecc71"
          : "#1e8449";
    } else if (state === "incorrect")
      wordColor = isDark ? "#e74c3c" : "#c0392b";
    else if (tajweed) wordColor = getTC(tajweed.color, isDark);

    return (
      <span
        key={word.globalIndex}
        ref={isCurrent ? currentWordRef : undefined}
        className={cn(
          "relative inline-block transition-colors duration-150 cursor-default mx-[0.12em]",
          state === "current" &&
            "bg-highlight text-highlight-foreground rounded px-0.5 shadow-lg glow-pulse",
          state === "incorrect" && "animate-[shake_0.3s_ease-in-out]",
          isHoverDimmed && "opacity-20",
        )}
        style={state !== "current" ? { color: wordColor } : undefined}
        onMouseEnter={() =>
          tajweed && (setHoveredRule(tajweed.color), setHoveredInfo(tajweed))
        }
        onMouseLeave={() => (setHoveredRule(null), setHoveredInfo(null))}
      >
        {word.text}
        {state === "correct" && tajweedAcoustic && (
          <TajweedBadge status={tajweedAcoustic} isDark={isDark} />
        )}
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

  // ── Render ayah (with hide-ahead logic) ─────────────────────────────────
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

  // ══════════════════════════════════════════════════════════════════════════
  // SCROLL VIEW — original
  // ══════════════════════════════════════════════════════════════════════════
  const renderScrollView = () => {
    const currentAyah = words[currentIndex]?.ayahNumber ?? 1;
    const ayahKeys = Array.from(ayahs.keys());
    const currentAyahIdx = ayahKeys.indexOf(currentAyah);
    const startIdx = Math.max(0, currentAyahIdx - 2);
    const endIdx = Math.min(ayahKeys.length - 1, currentAyahIdx + 6);
    const visible = ayahKeys.slice(startIdx, endIdx + 1);

    return (
      <div
        className="relative rounded-2xl overflow-hidden shadow-2xl"
        style={{
          background: pageBackground,
          border: `1px solid ${borderGold}`,
        }}
      >
        <div
          className="absolute inset-3 rounded-xl pointer-events-none z-0"
          style={{ border: `1px solid ${borderGold}` }}
        />

        {surahNumber && surahNumber !== 1 && surahNumber !== 9 && (
          <div
            className="relative z-10 text-center pt-6 pb-4 font-quran text-2xl md:text-3xl"
            style={{
              color: goldColor,
              borderBottom: `1px solid ${borderGold}`,
            }}
          >
            بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
          </div>
        )}

        <div
          className="relative z-10 overflow-y-auto px-8 md:px-14 py-8"
          style={{ maxHeight: "45vh" }}
          dir="rtl"
        >
          {startIdx > 0 && (
            <p
              className="text-center text-muted-foreground/30 text-xs font-sans mb-6"
              dir="ltr"
            >
              ↑ {startIdx} earlier {startIdx === 1 ? "ayah" : "ayahs"}
            </p>
          )}
          <p
            className="text-right font-quran"
            style={{
              fontSize: "clamp(1.4rem, 3.5vw, 2.2rem)",
              lineHeight: "3.2",
              color: isDark ? "hsl(44 20% 80%)" : "hsl(30 20% 20%)",
            }}
          >
            {visible.map((n) => renderAyah(n, ayahs.get(n)!))}
          </p>
          {endIdx < ayahKeys.length - 1 && (
            <p
              className="text-center text-muted-foreground/30 text-xs font-sans mt-6"
              dir="ltr"
            >
              ↓ {ayahKeys.length - 1 - endIdx} more
            </p>
          )}
        </div>

        <div
          className="relative z-10 h-px mx-10 mb-4"
          style={{
            background: `linear-gradient(to right, transparent, ${borderGold}, transparent)`,
          }}
        />
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════════════════
  // BOOK VIEW — Real Mushaf layout
  // ══════════════════════════════════════════════════════════════════════════
  const renderBookView = () => {
    if (!hasPages) {
      return (
        <p className="text-center text-muted-foreground text-sm py-8">
          Page data not available.
        </p>
      );
    }

    const autoPageIdx = pageNumbers.indexOf(
      words[currentIndex]?.page ?? pageNumbers[0],
    );
    const activeIdx = manualPageIdx ?? (autoPageIdx >= 0 ? autoPageIdx : 0);

    // Right page = current (this is what you see on the right when holding a Quran)
    // Left page = next page
    const rightPageNum = pageNumbers[activeIdx];
    const leftPageNum =
      activeIdx + 1 < pageNumbers.length ? pageNumbers[activeIdx + 1] : null;

    const canPrev = activeIdx > 0;
    const canNext = activeIdx + 1 < pageNumbers.length;

    // Is first spread of this surah? Show bismillah on right page only
    const isFirstSpread = activeIdx === 0;

    // ── Render one Mushaf page ────────────────────────────────────────────
    const renderOnePage = (pgNum: number, showBismillah: boolean) => {
      const pgWords = pageMap.get(pgNum) ?? [];
      const pgAyahs = new Map<number, QuranWord[]>();
      for (const w of pgWords) {
        const a = pgAyahs.get(w.ayahNumber) ?? [];
        a.push(w);
        pgAyahs.set(w.ayahNumber, a);
      }

      return (
        <div className="flex flex-col h-full">
          {/* Surah name header for first page */}
          {showBismillah &&
            surahNumber &&
            surahNumber !== 1 &&
            surahNumber !== 9 && (
              <div
                className="text-center py-2 font-quran shrink-0"
                style={{
                  color: goldColor,
                  borderBottom: `1px solid ${borderGold}`,
                  fontSize: "clamp(1rem, 2vw, 1.4rem)",
                }}
              >
                بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
              </div>
            )}

          {/* Page content — the key: large justified text, fills the page */}
          <div
            className="flex-1 overflow-hidden px-4 sm:px-5 py-3 font-quran mushaf-page"
            dir="rtl"
            style={{
              /*
               * MUSHAF TEXT STYLING:
               * - Justified both sides (like printed Quran)
               * - Large text that fills the width
               * - Line height tuned so ~15 lines fit the page height
               * - text-align-last: justify for the last line too
               */
              fontSize: "clamp(1rem, 1.8vw, 1.35rem)",
              lineHeight: "2.15",
              textAlign: "justify",
              textAlignLast: "justify",
              wordSpacing: "0.12em",
              color: isDark ? "hsl(44 20% 82%)" : "hsl(30 20% 18%)",
            }}
          >
            {Array.from(pgAyahs.entries()).map(([n, ws]) => renderAyah(n, ws))}
          </div>

          {/* Page number at bottom */}
          <div className="text-center pb-1 shrink-0">
            <span
              className="text-[10px] font-sans"
              style={{ color: goldColor, opacity: 0.5 }}
            >
              {pgNum}
            </span>
          </div>
        </div>
      );
    };

    return (
      <div className="flex flex-col gap-2">
        {/* ── The open book ── */}
        <div
          className="relative rounded-xl overflow-hidden shadow-2xl"
          style={{
            background: pageBackground,
            border: `1px solid ${borderGold}`,
            /* Fixed aspect — tall enough for 15 lines of Arabic at the chosen font size */
            height: "min(72vh, 600px)",
          }}
        >
          {/* Inner decorative border */}
          <div
            className="absolute inset-[6px] rounded-lg pointer-events-none z-0"
            style={{ border: `1px solid ${borderGold}` }}
          />

          {/*
            Two-page spread:
            In a physical Quran held open, you see RIGHT page on the right, LEFT page on the left.
            We use dir="ltr" flex so the DOM order matches visual order: [LEFT] [RIGHT]
          */}
          <div className="relative z-10 flex h-full" dir="ltr">
            {/* LEFT page (next page) — hidden on mobile */}
            {leftPageNum !== null ? (
              <div className="flex-1 hidden md:flex flex-col h-full min-w-0">
                {renderOnePage(leftPageNum, false)}
              </div>
            ) : (
              /* Empty left page when there's no next page */
              <div
                className="flex-1 hidden md:block"
                style={{ background: pageBackground }}
              />
            )}

            {/* Spine / center binding */}
            <div
              className="w-[2px] shrink-0 hidden md:block z-20"
              style={{
                background: `linear-gradient(to bottom, transparent 2%, ${isDark ? "rgba(180,140,60,0.3)" : "rgba(120,90,20,0.25)"} 15%, ${isDark ? "rgba(180,140,60,0.3)" : "rgba(120,90,20,0.25)"} 85%, transparent 98%)`,
              }}
            />

            {/* RIGHT page (current page) */}
            <div className="flex-1 flex flex-col h-full min-w-0">
              {renderOnePage(rightPageNum, isFirstSpread)}
            </div>
          </div>
        </div>

        {/* ── Page navigation ── */}
        <div className="flex items-center justify-center gap-4" dir="ltr">
          <button
            onClick={() => {
              if (canPrev) setManualPageIdx(activeIdx - 1);
            }}
            disabled={!canPrev}
            className="p-2 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-all disabled:opacity-20"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-muted-foreground/50 font-sans min-w-[60px] text-center">
            {leftPageNum ? `${leftPageNum} – ` : ""}
            {rightPageNum}
          </span>
          <button
            onClick={() => {
              if (canNext) setManualPageIdx(activeIdx + 1);
            }}
            disabled={!canNext}
            className="p-2 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-all disabled:opacity-20"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3" dir="rtl">
          {surahName && (
            <span className="font-quran text-2xl" style={{ color: goldColor }}>
              {surahName}
            </span>
          )}
          {surahEnglishName && (
            <span className="text-sm text-muted-foreground font-sans">
              {surahEnglishName}
              {surahNumber && (
                <span className="ml-1 opacity-40">· {surahNumber}</span>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0" dir="ltr">
          {hasPages && (
            <button
              onClick={() =>
                setViewMode((v) => (v === "scroll" ? "book" : "scroll"))
              }
              className={cn(
                "flex items-center gap-1.5 text-xs transition-colors border rounded-lg px-3 py-1.5",
                viewMode === "book"
                  ? "text-foreground border-border bg-card"
                  : "text-muted-foreground border-border/50 hover:text-foreground hover:border-border",
              )}
              title={
                viewMode === "scroll"
                  ? "Switch to Book View"
                  : "Switch to Scroll View"
              }
            >
              {viewMode === "scroll" ? (
                <BookOpen className="w-3.5 h-3.5" />
              ) : (
                <AlignJustify className="w-3.5 h-3.5" />
              )}
              {viewMode === "scroll" ? "Book" : "Scroll"}
            </button>
          )}

          <div className="relative">
            <button
              onClick={() => setShowLegend((s) => !s)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors border border-border/50 hover:border-border rounded-lg px-3 py-1.5"
            >
              <Info className="w-3.5 h-3.5" />
              Tajweed
            </button>
            {showLegend && (
              <TajweedLegend
                onClose={() => setShowLegend(false)}
                isDark={isDark}
              />
            )}
          </div>
        </div>
      </div>

      {/* Hovered rule info — absolute, no layout shift */}
      <div className="relative" style={{ height: 0 }}>
        <div
          className={cn(
            "absolute left-0 right-0 z-30 transition-all duration-200 pointer-events-none",
            hoveredInfo
              ? "opacity-100 translate-y-0"
              : "opacity-0 -translate-y-1",
          )}
        >
          {hoveredInfo && (
            <div
              className="mx-1 flex items-center gap-3 bg-card border border-border/50 rounded-lg px-4 py-2 shadow-lg"
              dir="ltr"
            >
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: getTC(hoveredInfo.color, isDark) }}
              />
              <span
                className="text-sm font-semibold shrink-0"
                style={{ color: getTC(hoveredInfo.color, isDark) }}
              >
                {hoveredInfo.label}
              </span>
              <span className="font-quran text-base text-muted-foreground shrink-0">
                {hoveredInfo.arabic}
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {hoveredInfo.description}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Active view */}
      {viewMode === "scroll" ? renderScrollView() : renderBookView()}

      {/* Tajweed legend row */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1"
        dir="ltr"
      >
        <span className="text-xs text-muted-foreground/40 font-sans shrink-0">
          Tajweed:
        </span>
        {Object.values(TAJWEED_RULES).map((info) => (
          <button
            key={info.rule}
            className={cn(
              "flex items-center gap-1.5 text-xs font-sans transition-opacity duration-150",
              hoveredRule && hoveredRule !== info.color
                ? "opacity-30"
                : "opacity-100",
            )}
            onMouseEnter={() => {
              setHoveredRule(info.color);
              setHoveredInfo(info);
            }}
            onMouseLeave={() => {
              setHoveredRule(null);
              setHoveredInfo(null);
            }}
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: getTC(info.color, isDark) }}
            />
            <span style={{ color: getTC(info.color, isDark) }}>
              {info.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
