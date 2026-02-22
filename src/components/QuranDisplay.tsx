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
  showPending: boolean;
}

export function QuranDisplay({ words, currentIndex, wordStatuses, showPending }: QuranDisplayProps) {
  const currentWordRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground text-lg">Select a Surah to begin reciting</p>
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

  const startAyahIdx = Math.max(0, currentAyahIdx - 3);
  const endAyahIdx = Math.min(ayahKeys.length - 1, currentAyahIdx + 5);
  const visibleAyahs = ayahKeys.slice(startAyahIdx, endAyahIdx + 1);

  return (
    <div
      ref={containerRef}
      className="w-full max-w-4xl mx-auto space-y-6 overflow-y-auto max-h-[60vh] px-4"
      dir="rtl"
    >
      {startAyahIdx > 0 && (
        <p className="text-center text-muted-foreground text-sm font-sans" dir="ltr">
          ↑ {startAyahIdx} ayah(s) above
        </p>
      )}

      {visibleAyahs.map((ayahNum) => {
        const ayahWords = ayahs.get(ayahNum)!;

        // Check if entire ayah is pending (not yet reached)
        const ayahFirstWordIdx = ayahWords[0].globalIndex;
        const isAyahFullyPending = ayahWords.every(
          w => (wordStatuses.get(w.globalIndex)?.state ?? 'pending') === 'pending'
        );
        // An ayah is "ahead" if its first word hasn't been reached yet
        const isAheadOfCurrent = ayahFirstWordIdx > currentIndex;
        const shouldBlur = isAheadOfCurrent && isAyahFullyPending && !showPending;

        return (
          <div key={ayahNum} className="relative">
            <span className="absolute -right-8 top-0 text-gold-dim text-xs font-sans opacity-60">
              {ayahNum}
            </span>
            <div
              className={cn(
                'flex flex-wrap gap-x-3 gap-y-2 justify-center leading-loose transition-all duration-300',
                shouldBlur && 'blur-sm select-none pointer-events-none'
              )}
            >
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
                      'font-quran text-3xl md:text-4xl lg:text-5xl transition-all duration-300 relative px-1 py-0.5 rounded',
                      state === 'pending' && 'text-muted-foreground/60',
                      state === 'current' && 'bg-highlight text-highlight-foreground glow-pulse scale-110',
                      state === 'correct' && 'text-correct',
                      state === 'incorrect' && 'text-incorrect animate-[shake_0.3s_ease-in-out]',
                    )}
                  >
                    {word.text}
                    {isCurrent && retries > 0 && (
                      <span className="absolute -top-3 -left-1 text-xs font-sans text-incorrect bg-card rounded-full px-1.5 py-0.5 border border-border">
                        {retries}
                      </span>
                    )}
                  </span>
                );
              })}
              <span className="font-quran text-3xl md:text-4xl lg:text-5xl text-gold-dim">
                ﴿{ayahNum}﴾
              </span>
            </div>

            {/* Overlay label when hidden */}
            {shouldBlur && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-xs font-sans text-muted-foreground/40 bg-background/60 px-2 py-0.5 rounded">
                  hidden
                </span>
              </div>
            )}
          </div>
        );
      })}

      {endAyahIdx < ayahKeys.length - 1 && (
        <p className="text-center text-muted-foreground text-sm font-sans" dir="ltr">
          ↓ {ayahKeys.length - 1 - endAyahIdx} ayah(s) below
        </p>
      )}
    </div>
  );
}
