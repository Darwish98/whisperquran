import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchSurahText, getAyahAudioUrl, type QuranWord } from '@/lib/quranApi';
import { matchConsecutiveWords } from '@/lib/arabicUtils';
import { playAudio, preloadWordAudio } from '@/lib/audioPlayer';
import { SurahSelector } from '@/components/SurahSelector';
import { QuranDisplay } from '@/components/QuranDisplay';
import { RecitationControls } from '@/components/RecitationControls';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useAuth } from '@/hooks/useAuth';
import { useUserProgress } from '@/hooks/useUserProgress';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { LogIn, LogOut, User } from 'lucide-react';

interface WordStatus {
  state: 'pending' | 'current' | 'correct' | 'incorrect';
  retries: number;
}

const MAX_RETRIES_BEFORE_HELP = 3;

const Index = () => {
  const [selectedSurah, setSelectedSurah] = useState(1);
  const selectedSurahRef = useRef(1);
  const [words, setWords] = useState<QuranWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [wordStatuses, setWordStatuses] = useState<Map<number, WordStatus>>(new Map());
  const [loading, setLoading] = useState(false);
  const [lastHeard, setLastHeard] = useState('');
  const currentIndexRef = useRef(0);
  const wordsRef = useRef<QuranWord[]>([]);
  const sessionStartRef = useRef<number>(0);
  const wordsAttemptedRef = useRef(0);

  const { isListening, start, stop, isSupported } = useSpeechRecognition();
  const { user, signOut } = useAuth();
  const { saveProgress, saveRecitationHistory } = useUserProgress();
  const { toast } = useToast();
  const navigate = useNavigate();

  const completedWords = Array.from(wordStatuses.values()).filter(s => s.state === 'correct').length;
  const progress = words.length > 0 ? (completedWords / words.length) * 100 : 0;

  // Preload audio for upcoming words
  useEffect(() => {
    if (words.length > 0 && currentIndex < words.length) {
      const upcoming = words.slice(currentIndex, currentIndex + 10);
      const urls = upcoming.map(w => getAyahAudioUrl(selectedSurah, w.ayahNumber));
      preloadWordAudio([...new Set(urls)]);
    }
  }, [currentIndex, words, selectedSurah]);

  const handleSurahSelect = useCallback(async (surahNumber: number) => {
    setSelectedSurah(surahNumber);
    selectedSurahRef.current = surahNumber;
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

  // Auto-save progress periodically
  useEffect(() => {
    if (!user || words.length === 0) return;
    const interval = setInterval(() => {
      saveProgress(selectedSurah, currentIndexRef.current, words.length, completedWords, progress >= 100);
    }, 10000);
    return () => clearInterval(interval);
  }, [user, selectedSurah, words.length, completedWords, progress, saveProgress]);

  const handleTranscription = useCallback((transcribedText: string) => {
    setLastHeard(transcribedText);
    const idx = currentIndexRef.current;
    const w = wordsRef.current;
    if (idx >= w.length) return;
    wordsAttemptedRef.current++;

    const matchCount = matchConsecutiveWords(transcribedText, w, idx);

    setWordStatuses(prev => {
      const next = new Map(prev);

      if (matchCount > 0) {
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
          // Save history
          if (sessionStartRef.current > 0) {
            const duration = Math.floor((Date.now() - sessionStartRef.current) / 1000);
            saveRecitationHistory(
              parseInt(String(w[0]?.ayahNumber)) || 1,
              duration,
              wordsAttemptedRef.current,
              w.length
            );
          }
        }
      } else {
        const current = next.get(idx) || { state: 'current' as const, retries: 0 };
        const newRetries = current.retries + 1;
        next.set(idx, { state: 'incorrect', retries: newRetries });

        // Play audio help after MAX_RETRIES_BEFORE_HELP failures
        if (newRetries >= MAX_RETRIES_BEFORE_HELP) {
          const word = w[idx];
          const audioUrl = getAyahAudioUrl(selectedSurahRef.current, word.ayahNumber);
          playAudio(audioUrl);
          toast({ title: '🔊 Listen & Repeat', description: 'Playing the ayah audio to help you.' });
        }

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
  }, [toast, saveRecitationHistory]);

  const handleStart = useCallback(() => {
    if (words.length === 0) return;
    if (!isSupported) {
      toast({
        title: 'Not Supported',
        description: "Your browser doesn't support speech recognition. Please use Chrome or Edge.",
        variant: 'destructive',
      });
      return;
    }
    sessionStartRef.current = Date.now();
    wordsAttemptedRef.current = 0;
    start(handleTranscription);
  }, [words, isSupported, start, handleTranscription, toast]);

  const handleStop = useCallback(() => {
    stop();
    if (user && sessionStartRef.current > 0) {
      const duration = Math.floor((Date.now() - sessionStartRef.current) / 1000);
      saveRecitationHistory(selectedSurah, duration, wordsAttemptedRef.current, completedWords);
      saveProgress(selectedSurah, currentIndexRef.current, words.length, completedWords, progress >= 100);
    }
  }, [stop, user, selectedSurah, completedWords, words.length, progress, saveRecitationHistory, saveProgress]);

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
          <div className="flex items-center gap-3">
            <SurahSelector
              selectedSurah={selectedSurah}
              onSelect={handleSurahSelect}
              disabled={isListening}
            />
            {user ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground hidden sm:inline">
                  {user.user_metadata?.full_name || user.email}
                </span>
                <Button variant="ghost" size="icon" onClick={signOut}>
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => navigate('/auth')} className="gap-1">
                <LogIn className="w-4 h-4" />
                Login
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-start px-6 py-6 gap-6">
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
