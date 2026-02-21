import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchSurahText, type QuranWord } from '@/lib/quranApi';
import { matchConsecutiveWords } from '@/lib/arabicUtils';
import { SurahSelector } from '@/components/SurahSelector';
import { QuranDisplay } from '@/components/QuranDisplay';
import { RecitationControls } from '@/components/RecitationControls';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useToast } from '@/hooks/use-toast';

interface WordStatus {
  state: 'pending' | 'current' | 'correct' | 'incorrect';
  retries: number;
}

const Index = () => {
  const [selectedSurah, setSelectedSurah] = useState(1);
  const [words, setWords] = useState<QuranWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [wordStatuses, setWordStatuses] = useState<Map<number, WordStatus>>(new Map());
  const [loading, setLoading] = useState(false);
  const [lastHeard, setLastHeard] = useState('');
  const currentIndexRef = useRef(0);
  const wordsRef = useRef<QuranWord[]>([]);

  const { isListening, start, stop, isSupported } = useSpeechRecognition();
  const { toast } = useToast();

  const completedWords = Array.from(wordStatuses.values()).filter(s => s.state === 'correct').length;
  const progress = words.length > 0 ? (completedWords / words.length) * 100 : 0;

  const handleSurahSelect = useCallback(async (surahNumber: number) => {
    setSelectedSurah(surahNumber);
    setLoading(true);
    try {
      const surahWords = await fetchSurahText(surahNumber);
      setWords(surahWords);
      wordsRef.current = surahWords;
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      const statuses = new Map<number, WordStatus>();
      surahWords.forEach((_, i) => {
        statuses.set(i, { state: i === 0 ? 'current' : 'pending', retries: 0 });
      });
      setWordStatuses(statuses);
    } catch {
      toast({ title: 'Error', description: 'Failed to load Surah text', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    handleSurahSelect(1);
  }, []);

  const handleTranscription = useCallback((transcribedText: string) => {
    setLastHeard(transcribedText);
    const idx = currentIndexRef.current;
    const w = wordsRef.current;
    if (idx >= w.length) return;

    // Try to match consecutive words from current position
    const matchCount = matchConsecutiveWords(transcribedText, w, idx);

    setWordStatuses(prev => {
      const next = new Map(prev);

      if (matchCount > 0) {
        // Mark all matched words as correct
        for (let i = 0; i < matchCount; i++) {
          const wordIdx = idx + i;
          const current = next.get(wordIdx) || { state: 'current' as const, retries: 0 };
          next.set(wordIdx, { state: 'correct', retries: current.retries });
        }

        const nextIdx = idx + matchCount;
        if (nextIdx < w.length) {
          next.set(nextIdx, { state: 'current', retries: 0 });
          setCurrentIndex(nextIdx);
          currentIndexRef.current = nextIdx;
        } else {
          setCurrentIndex(nextIdx);
          currentIndexRef.current = nextIdx;
          toast({ title: '🎉 ماشاء الله!', description: 'You have completed this Surah!' });
        }
      } else {
        const current = next.get(idx) || { state: 'current' as const, retries: 0 };
        next.set(idx, { state: 'incorrect', retries: current.retries + 1 });
        setTimeout(() => {
          setWordStatuses(p => {
            const n = new Map(p);
            const s = n.get(idx);
            if (s && s.state === 'incorrect') {
              n.set(idx, { ...s, state: 'current' });
            }
            return n;
          });
        }, 800);
      }

      return next;
    });
  }, [toast]);

  const handleStart = useCallback(() => {
    if (words.length === 0) return;
    if (!isSupported) {
      toast({
        title: 'Not Supported',
        description: 'Your browser doesn\'t support speech recognition. Please use Chrome or Edge.',
        variant: 'destructive'
      });
      return;
    }
    start(handleTranscription);
  }, [words, isSupported, start, handleTranscription, toast]);

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  const handleReset = useCallback(() => {
    stop();
    setLastHeard('');
    if (words.length > 0) {
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      const statuses = new Map<number, WordStatus>();
      words.forEach((_, i) => {
        statuses.set(i, { state: i === 0 ? 'current' : 'pending', retries: 0 });
      });
      setWordStatuses(statuses);
    }
  }, [stop, words]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="font-quran text-2xl text-gold glow-gold">تلاوة</h1>
            <span className="text-sm text-muted-foreground">Quran Recitation Trainer</span>
          </div>
          <SurahSelector
            selectedSurah={selectedSurah}
            onSelect={handleSurahSelect}
            disabled={isListening}
          />
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10 gap-10">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <QuranDisplay
            words={words}
            currentIndex={currentIndex}
            wordStatuses={wordStatuses}
          />
        )}

        <RecitationControls
          isRecording={isListening}
          isConnected={isListening}
          onStart={handleStart}
          onStop={handleStop}
          onReset={handleReset}
          progress={progress}
          totalWords={words.length}
          completedWords={completedWords}
          hasWords={words.length > 0}
        />

        {lastHeard && (
          <div className="text-center space-y-1">
            <p className="text-xs text-muted-foreground">Last heard:</p>
            <p className="font-quran text-lg text-gold-dim">{lastHeard}</p>
          </div>
        )}

        {!isSupported && (
          <p className="text-xs text-incorrect text-center max-w-md">
            ⚠️ Speech recognition is not supported in your browser. Please use Chrome or Edge.
          </p>
        )}
      </main>
    </div>
  );
};

export default Index;
