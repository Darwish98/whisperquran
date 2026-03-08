/**
 * QuranDisplay.tsx — Production rewrite
 *
 * Changes vs previous version:
 * 1. Character-level tajweed coloring using charStart/charEnd from server
 * 2. current-word-highlight CSS class (gold underline + glow, no background)
 * 3. Correct word: green for unannotated chars, tajweed colors kept on letters
 * 4. TajweedBadge shown inline after each correct word that has acoustic results
 *    — badge keyed by word.globalIndex (matches useTajweedAnalysis fix)
 * 5. TajweedScoreBar shown below text after ayah analysis
 * 6. tajweedScore + tajweedResult passed in as props (wired in Index.tsx)
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
import { TajweedBadge, TajweedScoreBar } from "@/components/TajweedIndicator";
import type {
  WordTajweedStatus,
  TajweedViolation,
} from "@/hooks/useTajweedAnalysis";

// ── Dark mode ─────────────────────────────────────────────────────────────────

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

// ── Colors ────────────────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, { light: string; dark: string }> = {
  ghunna: { light: "#c0392b", dark: "#e74c3c" },
  qalqalah: { light: "#1e8449", dark: "#2ecc71" },
  madd: { light: "#1a5276", dark: "#5dade2" },
  ikhfa: { light: "#a04000", dark: "#e67e22" },
  idgham: { light: "#0e6655", dark: "#1abc9c" },
  iqlab: { light: "#6c3483", dark: "#a569bd" },
  lam_shams: { light: "#0e6655", dark: "#1abc9c" },
};

function catColor(cat: string, isDark: boolean): string {
  return isDark
    ? (CAT_COLORS[cat]?.dark ?? "inherit")
    : (CAT_COLORS[cat]?.light ?? "inherit");
}

// ── Char-level color map ──────────────────────────────────────────────────────

interface CharAnnotation {
  color: string;
  category: string;
  rule: string;
}

export interface ServerRule {
  rule: string;
  category: string;
  charStart?: number;
  charEnd?: number;
  description: string;
  arabicName: string;
  harakatCount?: number;
}

function buildCharMap(
  text: string,
  rules: ServerRule[],
  isDark: boolean,
): Map<number, CharAnnotation> {
  const map = new Map<number, CharAnnotation>();
  if (!rules?.length) return map;

  const priority = [
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

  const sorted = [...rules].sort(
    (a, b) =>
      (priority.indexOf(a.rule) + 1 || 99) -
      (priority.indexOf(b.rule) + 1 || 99),
  );

  for (const rule of sorted) {
    const color = catColor(rule.category, isDark);
    if (color === "inherit") continue;
    const start = rule.charStart ?? 0;
    const end = rule.charEnd ?? text.length;
    for (let i = start; i < end; i++) {
      map.set(i, { color, category: rule.category, rule: rule.rule });
    }
  }
  return map;
}

// ── Word character renderer ───────────────────────────────────────────────────

function WordChars({
  text,
  charMap,
  state,
  recitationColor,
}: {
  text: string;
  charMap: Map<number, CharAnnotation>;
  state: "pending" | "current" | "correct" | "incorrect";
  recitationColor?: string;
}) {
  const chars = [...text];

  if (state === "current") {
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
        const ann = charMap.get(i);
        if (state === "correct" || state === "incorrect") {
          const color = ann?.color ?? recitationColor;
          return (
            <span key={i} style={color ? { color } : undefined}>
              {ch}
            </span>
          );
        }
        // pending: only tajweed chars colored
        return ann ? (
          <span key={i} style={{ color: ann.color }}>
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        );
      })}
    </>
  );
}

// ── Legend panel ──────────────────────────────────────────────────────────────

function Legend({ onClose, isDark }: { onClose: () => void; isDark: boolean }) {
  return (
    <div
      className="absolute top-full left-0 mt-2 z-50 w-80 rounded-xl border border-border shadow-2xl overflow-hidden"
      style={{ background: isDark ? "hsl(160 18% 8%)" : "#fff" }}
      dir="ltr"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold">Tajweed Colour Guide</span>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="divide-y divide-border/40 max-h-80 overflow-y-auto">
        {Object.values(TAJWEED_RULES).map((info) => (
          <div key={info.rule} className="px-4 py-3 flex gap-3">
            <div
              className="w-3 h-3 rounded-full shrink-0 mt-0.5"
              style={{ background: catColor(info.rule, isDark) }}
            />
            <div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span
                  className="text-sm font-semibold"
                  style={{ color: catColor(info.rule, isDark) }}
                >
                  {info.label}
                </span>
                <span className="font-quran text-base opacity-60">
                  {info.arabic}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
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
  /** Keyed by globalIndex — from useTajweedAnalysis with globalIndexOffset fix */
  tajweedStatuses?: Map<number, WordTajweedStatus>;
  tajweedRules?: Map<number, ServerRule[]>;
  tajweedScore?: number | null;
  tajweedResult?: {
    rules_checked: number;
    violations: TajweedViolation[];
  } | null;
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
  tajweedScore,
  tajweedResult,
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
  const textColor = isDark ? "hsl(44 20% 82%)" : "hsl(30 15% 18%)";

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

  const ayahs = new Map<number, QuranWord[]>();
  for (const w of words) {
    const arr = ayahs.get(w.ayahNumber) ?? [];
    arr.push(w);
    ayahs.set(w.ayahNumber, arr);
  }

  const pageMap = new Map<number, QuranWord[]>();
  for (const w of words) {
    if (w.page == null) continue;
    const arr = pageMap.get(w.page) ?? [];
    arr.push(w);
    pageMap.set(w.page, arr);
  }
  const pageNumbers = Array.from(pageMap.keys()).sort((a, b) => a - b);

  // ── Word renderer ────────────────────────────────────────────────────────
  const renderWord = (word: QuranWord) => {
    const isCurrent = word.globalIndex === currentIndex;
    const status = wordStatuses.get(word.globalIndex);
    const state = status?.state ?? "pending";
    const retries = status?.retries ?? 0;

    const serverRules = tajweedRules?.get(word.globalIndex) ?? [];
    const charMap = buildCharMap(word.text, serverRules, isDark);
    const primaryCat = serverRules[0]?.category ?? null;
    const isHoverDimmed = hoveredRule && primaryCat !== hoveredRule;

    const tajweedAcoustic = tajweedStatuses?.get(word.globalIndex);

    let recitationColor: string | undefined;
    if (state === "correct") {
      recitationColor = tajweedAcoustic?.has_violation
        ? isDark
          ? "#f39c12"
          : "#e67e22"
        : isDark
          ? "#2ecc71"
          : "#1e8449";
    } else if (state === "incorrect") {
      recitationColor = isDark ? "#e74c3c" : "#c0392b";
    }

    const hoverHandlers = primaryCat
      ? {
          onMouseEnter: () => {
            const rule = serverRules[0];
            setHoveredRule(primaryCat);
            setHoveredInfo({
              rule: rule.rule,
              color: catColor(primaryCat, isDark),
              label: rule.arabicName || rule.rule,
              arabic: rule.arabicName,
              description: rule.description,
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
          "relative inline-block cursor-default mx-[0.1em]",
          isCurrent && "current-word-highlight",
          state === "incorrect" && "animate-[shake_0.3s_ease-in-out]",
          isHoverDimmed && "opacity-20",
        )}
        {...hoverHandlers}
      >
        <WordChars
          text={word.text}
          charMap={charMap}
          state={state}
          recitationColor={recitationColor}
        />

        {isCurrent && retries > 0 && (
          <sup
            className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-sans rounded-full px-1 border leading-none py-0.5"
            style={{
              color: "#e74c3c",
              borderColor: "#e74c3c44",
              background: isDark ? "hsl(160 18% 6%)" : "#fff",
            }}
          >
            {retries}×
          </sup>
        )}

        {state === "correct" && tajweedAcoustic && (
          <TajweedBadge status={tajweedAcoustic} isDark={isDark} />
        )}
      </span>
    );
  };

  // ── Ayah renderer ─────────────────────────────────────────────────────────
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
            style={{ color: goldColor, fontSize: "0.65em", opacity: 0.4 }}
          >
            ﴿{ayahNum}﴾
          </span>
        </span>
      );
    }

    return (
      <span key={ayahNum}>
        {ayahWords.map((w) => renderWord(w))}
        <span
          className="inline-block mx-1 font-quran"
          style={{ color: goldColor, fontSize: "0.65em", opacity: 0.7 }}
        >
          ﴿{ayahNum}﴾
        </span>
      </span>
    );
  };

  const quranTextStyle: React.CSSProperties = {
    fontFamily: "'Amiri', serif",
    direction: "rtl",
    textAlign: "justify",
    lineHeight: 3,
    fontSize: "clamp(1.3rem, 2.5vw, 1.75rem)",
    color: textColor,
  };

  const renderScrollView = () => (
    <div
      className="rounded-2xl p-6 md:p-8"
      style={{ background: pageBackground, border: `1px solid ${borderGold}` }}
    >
      {surahName && (
        <div className="text-center mb-6">
          <div className="font-quran text-2xl" style={{ color: goldColor }}>
            {surahName}
          </div>
          {surahEnglishName && (
            <div className="text-xs text-muted-foreground mt-1">
              {surahEnglishName}
            </div>
          )}
        </div>
      )}
      <div style={quranTextStyle}>
        {Array.from(ayahs.entries()).map(([n, aw]) => renderAyah(n, aw))}
      </div>
    </div>
  );

  const renderBookView = () => {
    if (!pageNumbers.length) return renderScrollView();

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
    const pageAyahs = new Map<number, QuranWord[]>();
    for (const w of pageWords) {
      const arr = pageAyahs.get(w.ayahNumber) ?? [];
      arr.push(w);
      pageAyahs.set(w.ayahNumber, arr);
    }

    return (
      <div className="flex flex-col gap-3">
        <div
          className="rounded-2xl p-6 md:p-8 min-h-[60vh]"
          style={{
            background: pageBackground,
            border: `1px solid ${borderGold}`,
          }}
        >
          <div style={quranTextStyle}>
            {Array.from(pageAyahs.entries()).map(([n, aw]) =>
              renderAyah(n, aw),
            )}
          </div>
          <div className="text-center mt-3 text-xs text-muted-foreground">
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

  return (
    <div className="flex flex-col gap-3" dir="ltr">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          {(["scroll", "book"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-sans border transition-colors",
                viewMode === mode
                  ? "bg-accent border-border text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {mode === "scroll" ? (
                <AlignJustify className="w-3.5 h-3.5" />
              ) : (
                <BookOpen className="w-3.5 h-3.5" />
              )}
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        <div className="relative flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => setShowLegend((s) => !s)}
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
          {showLegend && (
            <Legend onClose={() => setShowLegend(false)} isDark={isDark} />
          )}

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
                className="w-2 h-2 rounded-full inline-block"
                style={{ background: catColor(info.rule, isDark) }}
              />
              <span style={{ color: catColor(info.rule, isDark) }}>
                {info.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Hovered rule description bar */}
      {hoveredInfo && (
        <div
          className="text-xs font-sans px-3 py-2 rounded-lg border border-border"
          style={{ background: isDark ? "hsl(160 18% 10%)" : "#f7f7f7" }}
          dir="ltr"
        >
          <span
            className="font-semibold"
            style={{ color: catColor(hoveredInfo.rule ?? "", isDark) }}
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

      {/* Tajweed score bar shown after ayah analysis completes */}
      {tajweedScore != null && tajweedResult && (
        <TajweedScoreBar
          score={tajweedScore}
          rulesChecked={tajweedResult.rules_checked}
          violations={tajweedResult.violations.length}
          isDark={isDark}
        />
      )}
    </div>
  );
}
