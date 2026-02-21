import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchSurahText, type QuranWord } from '@/lib/quranApi';
import { wordsMatch } from '@/lib/arabicUtils';
import { SurahSelector } from '@/components/SurahSelector';
import { QuranDisplay } from '@/components/QuranDisplay';
import { RecitationControls } from '@/components/RecitationControls';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useToast } from '@/hooks/use-toast';

interface WordStatus {
  state: 'pending' | 'current' | 'correct' | 'incorrect';
  retries: number;
}

const WS_URL = 'ws://localhost:8000/ws/transcribe';

const Index = () => {
  const [selectedSurah, setSelectedSurah] = useState(1);
  const [words, setWords] = useState<QuranWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [wordStatuses, setWordStatuses] = useState<Map<number, WordStatus>>(new Map());
  const [loading, setLoading] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const currentIndexRef = useRef(0);
  const wordsRef = useRef<QuranWord[]>([]);
  const wordStatusesRef = useRef<Map<number, WordStatus>>(new Map());

  const { isRecording, startRecording, stopRecording } = useAudioRecorder(1000);
  const { connect, disconnect, sendAudio } = useWebSocket();
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
      wordStatusesRef.current = statuses;
    } catch {
      toast({ title: 'Error', description: 'Failed to load Surah text', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Load default surah on mount
  useEffect(() => {
    handleSurahSelect(1);
  }, []);

  const handleTranscription = useCallback((transcribedText: string) => {
    const idx = currentIndexRef.current;
    const w = wordsRef.current;
    if (idx >= w.length) return;

    const expectedWord = w[idx];
    const isCorrect = wordsMatch(transcribedText, expectedWord.text);

    setWordStatuses(prev => {
      const next = new Map(prev);
      const current = next.get(idx) || { state: 'current' as const, retries: 0 };

      if (isCorrect) {
        next.set(idx, { state: 'correct', retries: current.retries });
        const nextIdx = idx + 1;
        if (nextIdx < w.length) {
          next.set(nextIdx, { state: 'current', retries: 0 });
          setCurrentIndex(nextIdx);
          currentIndexRef.current = nextIdx;
        } else {
          // Surah complete
          toast({ title: '🎉 Masha\'Allah!', description: 'You have completed this Surah!' });
        }
      } else {
        next.set(idx, { state: 'incorrect', retries: current.retries + 1 });
        // Reset to current after brief delay
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

      wordStatusesRef.current = next;
      return next;
    });
  }, [toast]);

  const handleStart = useCallback(async () => {
    if (words.length === 0) return;
    setIsActive(true);

    // Try connecting to WebSocket backend
    connect(WS_URL, handleTranscription);

    await startRecording((blob) => {
      sendAudio(blob);
    });
  }, [words, connect, handleTranscription, startRecording, sendAudio]);

  const handleStop = useCallback(() => {
    stopRecording();
    disconnect();
    setIsActive(false);
  }, [stopRecording, disconnect]);

  const handleReset = useCallback(() => {
    handleStop();
    if (words.length > 0) {
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      const statuses = new Map<number, WordStatus>();
      words.forEach((_, i) => {
        statuses.set(i, { state: i === 0 ? 'current' : 'pending', retries: 0 });
      });
      setWordStatuses(statuses);
      wordStatusesRef.current = statuses;
    }
  }, [handleStop, words]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="font-quran text-2xl text-gold glow-gold">تلاوة</h1>
            <span className="text-sm text-muted-foreground">Quran Recitation Trainer</span>
          </div>
          <SurahSelector
            selectedSurah={selectedSurah}
            onSelect={handleSurahSelect}
            disabled={isActive}
          />
        </div>
      </header>

      {/* Main Content */}
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
          isRecording={isRecording}
          isConnected={isActive}
          onStart={handleStart}
          onStop={handleStop}
          onReset={handleReset}
          progress={progress}
          totalWords={words.length}
          completedWords={completedWords}
          hasWords={words.length > 0}
        />

        {/* Connection note */}
        <p className="text-xs text-muted-foreground text-center max-w-md">
          Connects to FastAPI backend at <code className="text-gold-dim">{WS_URL}</code> for speech recognition. 
          Ensure your backend with faster-whisper is running.
        </p>
      </main>
    </div>
  );
};

export default Index;
