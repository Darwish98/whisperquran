import { useEffect, useRef } from 'react';
import type { QuranWord } from '@/lib/quranApi';
import { cn } from '@/lib/utils';

interface WordStatus {
  state: 'pending' | 'current' | 'correct' | 'incorrect';
  retries: number;
}

interface QuranDisplayProps {
  words: QuranWord[];
  currentIndex: number;
  wordStatuses: Map<number, WordStatus>;
  surahName?: string;
  surahEnglishName?: string;
  surahNumber?: number;
}

export function QuranDisplay({
  words,
  currentIndex,
  wordStatuses,
  surahName,
  surahEnglishName,
  surahNumber,
}: QuranDisplayProps) {
  const currentWordRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (currentWordRef.current) {
      currentWordRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });
    }
  }, [currentIndex]);

  if (words.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6 w-full">
        {/* Decorative geometric motif */}
        <div className="relative w-20 h-20 opacity-30">
          <div className="absolute inset-0 border-2 border-gold rotate-45 rounded-sm" />
          <div className="absolute inset-2 border border-gold rotate-[22.5deg] rounded-sm" />
          <div className="absolute inset-4 bg-gold/20 rotate-45 rounded-sm" />
        </div>
        <p className="text-muted-foreground text-lg font-sans tracking-wide">
          اختر سورة للبدء
        </p>
        <p className="text-muted-foreground/50 text-sm font-sans">
          Select a Surah to begin
        </p>
      </div>
    );
  }

  // Group words by ayah
  const ayahs = new Map<number, QuranWord[]>();
  for (const word of words) {
    const existing = ayahs.get(word.ayahNumber) || [];
    existing.push(word);
    ayahs.set(word.ayahNumber, existing);
  }

  const currentAyah = words[currentIndex]?.ayahNumber || 1;
  const ayahKeys = Array.from(ayahs.keys());
  const currentAyahIdx = ayahKeys.indexOf(currentAyah);

  const startAyahIdx = Math.max(0, currentAyahIdx - 2);
  const endAyahIdx = Math.min(ayahKeys.length - 1, currentAyahIdx + 4);
  const visibleAyahs = ayahKeys.slice(startAyahIdx, endAyahIdx + 1);

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-0">
      {/* Surah header */}
      {surahName && (
        <div className="relative mb-8 text-center">
          {/* Ornamental top line */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gold/40 to-gold/20" />
            <div className="w-1.5 h-1.5 rounded-full bg-gold/60" />
            <div className="w-2.5 h-2.5 rotate-45 border border-gold/60" />
            <div className="w-1.5 h-1.5 rounded-full bg-gold/60" />
            <div className="flex-1 h-px bg-gradient-to-l from-transparent via-gold/40 to-gold/20" />
          </div>

          <div className="font-quran text-4xl text-gold glow-gold mb-1">{surahName}</div>
          {surahEnglishName && (
            <div className="text-xs font-sans text-muted-foreground tracking-[0.2em] uppercase">
              {surahEnglishName}
              {surahNumber && <span className="ml-3 opacity-50">#{surahNumber}</span>}
            </div>
          )}

          {/* Ornamental bottom line */}
          <div className="flex items-center gap-3 mt-4">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gold/30 to-gold/10" />
            <div className="w-1.5 h-1.5 rotate-45 border border-gold/40" />
            <div className="flex-1 h-px bg-gradient-to-l from-transparent via-gold/30 to-gold/10" />
          </div>
        </div>
      )}

      {/* Scrollable ayah container */}
      <div className="overflow-y-auto max-h-[58vh] scroll-smooth px-2 pb-6 space-y-1" dir="rtl">
        {startAyahIdx > 0 && (
          <div className="flex items-center gap-2 justify-center py-3" dir="ltr">
            <div className="h-px flex-1 bg-border/30" />
            <span className="text-xs text-muted-foreground/40 font-sans px-2">
              {startAyahIdx} {startAyahIdx === 1 ? 'ayah' : 'ayahs'} above
            </span>
            <div className="h-px flex-1 bg-border/30" />
          </div>
        )}

        {visibleAyahs.map((ayahNum, ayahVisIdx) => {
          const ayahWords = ayahs.get(ayahNum)!;
          const isCurrentAyah = ayahNum === currentAyah;

          return (
            <div
              key={ayahNum}
              className={cn(
                'relative rounded-xl px-6 py-5 transition-all duration-500',
                isCurrentAyah
                  ? 'bg-card/80 border border-gold/20 shadow-[0_0_40px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(180,140,60,0.1)]'
                  : 'bg-transparent border border-transparent',
              )}
            >
              {/* Ayah number badge - sits on the left in RTL */}
              <div
                className={cn(
                  'absolute -left-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full border flex items-center justify-center',
                  'font-sans text-[10px] transition-all duration-300',
                  isCurrentAyah
                    ? 'border-gold/50 bg-card text-gold shadow-[0_0_12px_rgba(180,140,60,0.3)]'
                    : 'border-border/30 bg-background/50 text-muted-foreground/40',
                )}
                dir="ltr"
              >
                {ayahNum}
              </div>

              {/* Words */}
              <div className="flex flex-wrap gap-x-3 gap-y-3 justify-center leading-[2.2]">
                {ayahWords.map((word) => {
                  const status = wordStatuses.get(word.globalIndex);
                  const isCurrent = word.globalIndex === currentIndex;
                  const state = status?.state || 'pending';
                  const retries = status?.retries || 0;

                  return (
                    <span
                      key={word.globalIndex}
                      ref={isCurrent ? currentWordRef : undefined}
                      className={cn(
                        'font-quran relative transition-all duration-200 px-1 rounded',
                        // Size — current word larger
                        isCurrent
                          ? 'text-4xl md:text-5xl'
                          : 'text-3xl md:text-4xl',
                        // State colours
                        state === 'pending' && !isCurrentAyah && 'text-foreground/20',
                        state === 'pending' && isCurrentAyah && 'text-foreground/40',
                        state === 'current' && [
                          'text-highlight-foreground bg-highlight',
                          'shadow-[0_0_20px_rgba(240,180,50,0.5),0_0_40px_rgba(240,180,50,0.2)]',
                          'scale-110 origin-bottom',
                        ],
                        state === 'correct' && 'text-correct',
                        state === 'incorrect' && 'text-incorrect',
                      )}
                    >
                      {word.text}

                      {/* Retry badge */}
                      {isCurrent && retries > 0 && (
                        <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-sans text-incorrect bg-card border border-incorrect/30 rounded-full px-1.5 py-0.5 leading-none whitespace-nowrap">
                          {retries}×
                        </span>
                      )}

                      {/* Correct micro-check */}
                      {state === 'correct' && (
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[8px] text-correct opacity-60">
                          ✓
                        </span>
                      )}
                    </span>
                  );
                })}

                {/* Ayah end marker */}
                <span
                  className={cn(
                    'font-quran transition-colors duration-300 self-center',
                    isCurrentAyah ? 'text-2xl text-gold/60' : 'text-xl text-muted-foreground/20',
                  )}
                >
                  ﴿{ayahNum}﴾
                </span>
              </div>
            </div>
          );
        })}

        {endAyahIdx < ayahKeys.length - 1 && (
          <div className="flex items-center gap-2 justify-center py-3" dir="ltr">
            <div className="h-px flex-1 bg-border/30" />
            <span className="text-xs text-muted-foreground/40 font-sans px-2">
              {ayahKeys.length - 1 - endAyahIdx} more {ayahKeys.length - 1 - endAyahIdx === 1 ? 'ayah' : 'ayahs'} below
            </span>
            <div className="h-px flex-1 bg-border/30" />
          </div>
        )}
      </div>
    </div>
  );
}
