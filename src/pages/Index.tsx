import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchSurahText, fetchSurahList, getAyahAudioUrl, type QuranWord, type SurahInfo } from '@/lib/quranApi';
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
import { LogIn, LogOut } from 'lucide-react';

interface WordStatus {
  state: 'pending' | 'current' | 'correct' | 'incorrect';
  retries: number;
}

const MAX_RETRIES_BEFORE_HELP = 3;

const Index = () => {
  const [selectedSurah, setSelectedSurah] = useState(1);
  const selectedSurahRef = useRef(1);
  const [words, setWords] = useState<QuranWord[]>([]);
  const [surahList, setSurahList] = useState<SurahInfo[]>([]);
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

  // Current surah info
  const currentSurahInfo = surahList.find(s => s.number === selectedSurah);

  // Load surah list once
  useEffect(() => {
    fetchSurahList().then(setSurahList).catch(console.error);
  }, []);

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
    stop();
    setLastHeard('');
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
  }, [toast, stop]);

  useEffect(() => {
    handleSurahSelect(1);
  }, []);

  // Auto-save progress
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
          stop();
          toast({ title: '🎉 ماشاء الله!', description: 'You have completed this Surah!' });
          if (sessionStartRef.current > 0) {
            const duration = Math.floor((Date.now() - sessionStartRef.current) / 1000);
            saveRecitationHistory(selectedSurahRef.current, duration, wordsAttemptedRef.current, w.length);
          }
        }
      } else {
        const current = next.get(idx) || { state: 'current' as const, retries: 0 };
        const newRetries = current.retries + 1;
        next.set(idx, { state: 'incorrect', retries: newRetries });

        if (newRetries >= MAX_RETRIES_BEFORE_HELP) {
          const word = w[idx];
          const audioUrl = getAyahAudioUrl(selectedSurahRef.current, word.ayahNumber);
          playAudio(audioUrl);
          toast({ title: '🔊 استمع وكرر', description: 'Listen and repeat after the reciter.' });
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
  }, [toast, stop, saveRecitationHistory]);

  const handleStart = useCallback(() => {
    if (words.length === 0) return;
    if (!isSupported) {
      toast({
        title: 'Not Supported',
        description: 'Please use Chrome or Edge for speech recognition.',
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
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      {/* Background geometric pattern */}
      <div className="absolute inset-0 pointer-events-none select-none overflow-hidden" aria-hidden>
        {/* Corner ornaments */}
        <div className="absolute top-0 left-0 w-64 h-64 opacity-[0.03]">
          <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 0L200 0L200 200" stroke="hsl(45 70% 55%)" strokeWidth="1"/>
            <path d="M0 0L150 0L150 150" stroke="hsl(45 70% 55%)" strokeWidth="0.5"/>
            <path d="M0 0L100 100" stroke="hsl(45 70% 55%)" strokeWidth="0.5"/>
            <circle cx="0" cy="0" r="100" stroke="hsl(45 70% 55%)" strokeWidth="0.5" fill="none"/>
            <circle cx="0" cy="0" r="60" stroke="hsl(45 70% 55%)" strokeWidth="0.5" fill="none"/>
          </svg>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 opacity-[0.03] scale-x-[-1]">
          <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 0L200 0L200 200" stroke="hsl(45 70% 55%)" strokeWidth="1"/>
            <path d="M0 0L150 0L150 150" stroke="hsl(45 70% 55%)" strokeWidth="0.5"/>
            <path d="M0 0L100 100" stroke="hsl(45 70% 55%)" strokeWidth="0.5"/>
            <circle cx="0" cy="0" r="100" stroke="hsl(45 70% 55%)" strokeWidth="0.5" fill="none"/>
          </svg>
        </div>
        {/* Subtle radial glow behind text area */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-gold/[0.02] blur-3xl" />
      </div>

      {/* ── Header ── */}
      <header className="relative z-10 border-b border-border/40 backdrop-blur-sm bg-background/60">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-6 py-3 gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="relative">
              <div className="w-8 h-8 rotate-45 border border-gold/60 rounded-sm flex items-center justify-center">
                <div className="w-4 h-4 rotate-0 bg-gold/10 rounded-sm" />
              </div>
            </div>
            <div>
              <div className="font-quran text-xl text-gold leading-none">تلاوة</div>
              <div className="text-[10px] text-muted-foreground/50 font-sans tracking-widest uppercase leading-none mt-0.5">
                Tilawa
              </div>
            </div>
          </div>

          {/* Surah selector */}
          <div className="flex-1 max-w-xs">
            <SurahSelector
              selectedSurah={selectedSurah}
              onSelect={handleSurahSelect}
              disabled={isListening}
            />
          </div>

          {/* Auth */}
          <div className="shrink-0">
            {user ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground/60 hidden sm:block font-sans">
                  {user.user_metadata?.full_name || user.email?.split('@')[0]}
                </span>
                <Button variant="ghost" size="icon" onClick={signOut} className="w-8 h-8">
                  <LogOut className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/auth')}
                className="text-xs border-border/50 h-8"
              >
                <LogIn className="w-3 h-3 mr-1.5" />
                Sign in
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-start px-4 pt-8 pb-4 gap-8">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 rounded-full border-2 border-gold/20 animate-ping" />
              <div className="absolute inset-2 rounded-full border-2 border-gold/40 border-t-gold animate-spin" />
            </div>
            <p className="text-xs text-muted-foreground font-sans tracking-widest animate-pulse uppercase">
              Loading…
            </p>
          </div>
        ) : (
          <QuranDisplay
            words={words}
            currentIndex={currentIndex}
            wordStatuses={wordStatuses}
            surahName={currentSurahInfo?.name}
            surahEnglishName={currentSurahInfo?.englishName}
            surahNumber={selectedSurah}
          />
        )}

        {/* Controls */}
        <div className="w-full max-w-3xl">
          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent to-border/30" />
            <div className="w-1 h-1 rotate-45 bg-gold/30" />
            <div className="flex-1 h-px bg-gradient-to-l from-transparent to-border/30" />
          </div>

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
        </div>

        {/* Last heard feedback */}
        {lastHeard && (
          <div className="text-center space-y-1 animate-in fade-in duration-300">
            <p className="text-[10px] text-muted-foreground/40 font-sans tracking-widest uppercase">
              Heard
            </p>
            <p className="font-quran text-xl text-gold/60">{lastHeard}</p>
          </div>
        )}

        {/* Browser warning */}
        {!isSupported && (
          <p className="text-xs text-incorrect/70 text-center max-w-sm font-sans">
            ⚠️ Speech recognition requires Chrome or Edge
          </p>
        )}
      </main>
    </div>
  );
};

export default Index;
