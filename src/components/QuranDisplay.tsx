/**
 * QuranDisplay.tsx
 *
 * Renders the Quran text in a Mushaf-style layout with tajweed colouring.
 *
 * HIDE AYAHS FIX:
 * When showPending=false, ayahs ahead of the current position are:
 * - Completely hidden (no text rendered at all, no blur, no placeholders)
 * - Only the ayah number marker ﴿N﴾ is shown
 */

import { useRef, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { type QuranWord } from '@/lib/quranApi';
import { getWordTajweedInfo, type TajweedInfo, TAJWEED_RULES } from '@/lib/tajweedUtils';
import { Info, X } from 'lucide-react';

// ── Dark mode hook ────────────────────────────────────────────────────────────

function useDarkMode() {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains('dark')),
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

// ── Tajweed colour map ────────────────────────────────────────────────────────

const TAJWEED_COLORS: Record<string, { light: string; dark: string }> = {
  'tajweed-ghunna':   { light: '#c0392b', dark: '#e74c3c' },
  'tajweed-qalqalah': { light: '#27ae60', dark: '#2ecc71' },
  'tajweed-madd':     { light: '#2471a3', dark: '#5dade2' },
  'tajweed-ikhfa':    { light: '#d35400', dark: '#e67e22' },
  'tajweed-idgham':   { light: '#148f77', dark: '#1abc9c' },
  'tajweed-iqlab':    { light: '#7d3c98', dark: '#a569bd' },
};

function getTC(cls: string, isDark: boolean): string {
  return isDark ? (TAJWEED_COLORS[cls]?.dark ?? 'inherit') : (TAJWEED_COLORS[cls]?.light ?? 'inherit');
}

// ── Tajweed legend panel ──────────────────────────────────────────────────────

function TajweedLegend({ onClose, isDark }: { onClose: () => void; isDark: boolean }) {
  return (
    <div
      className="absolute top-full left-0 mt-2 z-50 w-80 rounded-xl border border-border shadow-2xl overflow-hidden"
      style={{ background: isDark ? 'hsl(160 18% 8%)' : '#fff' }}
      dir="ltr"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground">Tajweed Colour Guide</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
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
                <span className="text-sm font-semibold" style={{ color: getTC(info.color, isDark) }}>
                  {info.label}
                </span>
                <span className="font-quran text-base text-muted-foreground">{info.arabic}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{info.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface WordStatus {
  state: 'pending' | 'current' | 'correct' | 'incorrect';
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
}: QuranDisplayProps) {
  const currentWordRef = useRef<HTMLSpanElement>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [hoveredRule, setHoveredRule] = useState<string | null>(null);
  const [hoveredInfo, setHoveredInfo] = useState<TajweedInfo | null>(null);
  const isDark = useDarkMode();

  useEffect(() => {
    currentWordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentIndex]);

  if (words.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="font-quran text-5xl opacity-20" style={{ color: isDark ? 'hsl(45 70% 55%)' : 'hsl(45 65% 38%)' }}>
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

  const currentAyah = words[currentIndex]?.ayahNumber ?? 1;
  const ayahKeys = Array.from(ayahs.keys());
  const currentAyahIdx = ayahKeys.indexOf(currentAyah);
  const startAyahIdx = Math.max(0, currentAyahIdx - 2);
  const endAyahIdx = Math.min(ayahKeys.length - 1, currentAyahIdx + 6);
  const visibleAyahs = ayahKeys.slice(startAyahIdx, endAyahIdx + 1);

  const pageBackground = isDark
    ? 'linear-gradient(160deg, hsl(40 20% 7%) 0%, hsl(40 15% 5%) 100%)'
    : 'linear-gradient(160deg, #fdf8f0 0%, #f9f1df 100%)';

  const borderGold = isDark ? 'rgba(180,140,60,0.18)' : 'rgba(150,110,30,0.2)';
  const goldColor = isDark ? 'hsl(45 70% 55%)' : 'hsl(45 65% 35%)';

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-3">

      {/* ── Header row ── */}
      <div className="flex items-center justify-between px-1">
        {/* Surah title */}
        <div className="flex items-center gap-3" dir="rtl">
          {surahName && (
            <span className="font-quran text-2xl" style={{ color: goldColor }}>
              {surahName}
            </span>
          )}
          {surahEnglishName && (
            <span className="text-sm text-muted-foreground font-sans">
              {surahEnglishName}
              {surahNumber && <span className="ml-1 opacity-40">· {surahNumber}</span>}
            </span>
          )}
        </div>

        {/* Legend button */}
        <div className="relative shrink-0" dir="ltr">
          <button
            onClick={() => setShowLegend(s => !s)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors border border-border/50 hover:border-border rounded-lg px-3 py-1.5"
          >
            <Info className="w-3.5 h-3.5" />
            Tajweed Guide
          </button>
          {showLegend && (
            <TajweedLegend onClose={() => setShowLegend(false)} isDark={isDark} />
          )}
        </div>
      </div>

      {/* ── Hovered rule info bar ── */}
      <div className={cn('transition-all duration-200 overflow-hidden', hoveredInfo ? 'max-h-16 opacity-100' : 'max-h-0 opacity-0')}>
        {hoveredInfo && (
          <div className="mx-1 flex items-center gap-3 bg-card border border-border/50 rounded-lg px-4 py-2" dir="ltr">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: getTC(hoveredInfo.color, isDark) }}
            />
            <span className="text-sm font-semibold shrink-0" style={{ color: getTC(hoveredInfo.color, isDark) }}>
              {hoveredInfo.label}
            </span>
            <span className="font-quran text-base text-muted-foreground shrink-0">{hoveredInfo.arabic}</span>
            <span className="text-xs text-muted-foreground truncate">{hoveredInfo.description}</span>
          </div>
        )}
      </div>

      {/* ── Mushaf page ── */}
      <div
        className="relative rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: pageBackground, border: `1px solid ${borderGold}` }}
      >
        {/* Inner decorative border */}
        <div
          className="absolute inset-3 rounded-xl pointer-events-none z-0"
          style={{ border: `1px solid ${borderGold}` }}
        />

        {/* Bismillah header — shown on all surahs except Fatiha (already in text) and Tawbah */}
        {surahNumber && surahNumber !== 1 && surahNumber !== 9 && (
          <div
            className="relative z-10 text-center pt-6 pb-4 font-quran text-2xl md:text-3xl"
            style={{ color: goldColor, borderBottom: `1px solid ${borderGold}` }}
          >
            بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
          </div>
        )}

        {/* Text scroll area */}
        <div
          className="relative z-10 overflow-y-auto px-8 md:px-14 py-8"
          style={{ maxHeight: '45vh' }}
          dir="rtl"
        >
          {startAyahIdx > 0 && (
            <p className="text-center text-muted-foreground/30 text-xs font-sans mb-6" dir="ltr">
              ↑ {startAyahIdx} earlier {startAyahIdx === 1 ? 'ayah' : 'ayahs'}
            </p>
          )}

          {/*
            Mushaf layout: all words flow inline, just like a real Quran page.
            Each ayah is an inline <span>, words wrap naturally across lines.
            
            HIDE AYAHS: When showPending=false, future ayahs render ONLY the
            ayah number — no text, no blur, no placeholders.
          */}
          <p
            className="text-right font-quran"
            style={{
              fontSize: 'clamp(1.4rem, 3.5vw, 2.2rem)',
              lineHeight: '3.2',
              color: isDark ? 'hsl(44 20% 80%)' : 'hsl(30 20% 20%)',
            }}
          >
            {visibleAyahs.map((ayahNum) => {
              const ayahWords = ayahs.get(ayahNum)!;
              const isAheadOfCurrent = ayahWords[0].globalIndex > currentIndex;
              const isFullyPending = ayahWords.every(
                w => (wordStatuses.get(w.globalIndex)?.state ?? 'pending') === 'pending'
              );
              
              // HIDE AYAHS FIX: When showPending=false and ayah is ahead+pending,
              // completely hide all Arabic text — only show ayah number
              const shouldHide = isAheadOfCurrent && isFullyPending && !showPending;

              if (shouldHide) {
                // Render ONLY the ayah number marker — no text at all
                return (
                  <span key={ayahNum} className="inline">
                    <span
                      className="inline-block mx-2 font-quran"
                      style={{ color: goldColor, fontSize: '0.75em', opacity: 0.5 }}
                    >
                      ﴿{ayahNum}﴾
                    </span>
                  </span>
                );
              }

              return (
                <span key={ayahNum}>
                  {ayahWords.map((word, wi) => {
                    const isCurrent = word.globalIndex === currentIndex;
                    const status = wordStatuses.get(word.globalIndex);
                    const state = status?.state ?? 'pending';
                    const retries = status?.retries ?? 0;

                    // Next word for tajweed context
                    const nextWord = wi < ayahWords.length - 1
                      ? ayahWords[wi + 1]
                      : ayahs.get(ayahNum + 1)?.[0];

                    const tajweed = getWordTajweedInfo(word.text, nextWord?.text);
                    const isHoverDimmed = hoveredRule && tajweed?.color !== hoveredRule;

                    // Resolve text colour
                    let wordColor: string | undefined;
                    if (state === 'current') {
                      wordColor = undefined; // className handles it
                    } else if (state === 'correct') {
                      wordColor = isDark ? '#2ecc71' : '#1e8449';
                    } else if (state === 'incorrect') {
                      wordColor = isDark ? '#e74c3c' : '#c0392b';
                    } else if (tajweed) {
                      wordColor = getTC(tajweed.color, isDark);
                    }

                    return (
                      <span
                        key={word.globalIndex}
                        ref={isCurrent ? currentWordRef : undefined}
                        className={cn(
                          'relative inline-block transition-all duration-150 cursor-default mx-[0.15em]',
                          state === 'current' && 'bg-highlight text-highlight-foreground rounded-md px-1 scale-110 shadow-lg glow-pulse',
                          state === 'incorrect' && 'animate-[shake_0.3s_ease-in-out]',
                          isHoverDimmed && 'opacity-20',
                        )}
                        style={state !== 'current' ? { color: wordColor } : undefined}
                        onMouseEnter={() => tajweed && (setHoveredRule(tajweed.color), setHoveredInfo(tajweed))}
                        onMouseLeave={() => (setHoveredRule(null), setHoveredInfo(null))}
                      >
                        {word.text}

                        {/* Retry counter */}
                        {isCurrent && retries > 0 && (
                          <sup
                            className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-sans rounded-full px-1 border"
                            style={{ color: '#e74c3c', borderColor: '#e74c3c55', background: isDark ? 'hsl(160 18% 6%)' : '#fff' }}
                          >
                            {retries}×
                          </sup>
                        )}
                      </span>
                    );
                  })}

                  {/* Ayah end marker */}
                  <span
                    className="inline-block mx-1 font-quran"
                    style={{ color: goldColor, fontSize: '0.75em' }}
                  >
                    ﴿{ayahNum}﴾
                  </span>
                </span>
              );
            })}
          </p>

          {endAyahIdx < ayahKeys.length - 1 && (
            <p className="text-center text-muted-foreground/30 text-xs font-sans mt-6" dir="ltr">
              ↓ {ayahKeys.length - 1 - endAyahIdx} more {ayahKeys.length - 1 - endAyahIdx === 1 ? 'ayah' : 'ayahs'}
            </p>
          )}
        </div>

        {/* Bottom ornament */}
        <div
          className="relative z-10 h-px mx-10 mb-4"
          style={{ background: `linear-gradient(to right, transparent, ${borderGold}, transparent)` }}
        />
      </div>

      {/* ── Compact colour legend row ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1" dir="ltr">
        <span className="text-xs text-muted-foreground/40 font-sans shrink-0">Tajweed:</span>
        {Object.values(TAJWEED_RULES).map((info) => (
          <button
            key={info.rule}
            className={cn(
              'flex items-center gap-1.5 text-xs font-sans transition-opacity duration-150',
              hoveredRule && hoveredRule !== info.color ? 'opacity-30' : 'opacity-100',
            )}
            onMouseEnter={() => (setHoveredRule(info.color), setHoveredInfo(info))}
            onMouseLeave={() => (setHoveredRule(null), setHoveredInfo(null))}
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: getTC(info.color, isDark) }}
            />
            <span style={{ color: getTC(info.color, isDark) }}>{info.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
