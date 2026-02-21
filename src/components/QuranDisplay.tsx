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
}

export function QuranDisplay({ words, currentIndex, wordStatuses }: QuranDisplayProps) {
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

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8" dir="rtl">
      {Array.from(ayahs.entries()).map(([ayahNum, ayahWords]) => (
        <div key={ayahNum} className="relative">
          <span className="absolute -right-8 top-0 text-gold-dim text-xs font-sans opacity-60">
            {ayahNum}
          </span>
          <div className="flex flex-wrap gap-x-3 gap-y-2 justify-center leading-loose">
            {ayahWords.map((word) => {
              const status = wordStatuses.get(word.globalIndex);
              const isCurrent = word.globalIndex === currentIndex;
              const state = status?.state || 'pending';
              const retries = status?.retries || 0;

              return (
                <span
                  key={word.globalIndex}
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
        </div>
      ))}
    </div>
  );
}
