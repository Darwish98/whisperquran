import { useState, useCallback, useRef, useEffect } from 'react';
import {
  fetchSurahText, fetchSurahList, getAyahAudioUrl,
  type QuranWord, type SurahInfo, type Reciter,
  RECITERS, DEFAULT_RECITER,
} from '@/lib/quranApi';
import { matchConsecutiveWords } from '@/lib/arabicUtils';
import { playAudio, preloadWordAudio, unlockAudio } from '@/lib/audioPlayer';
import { SurahSelector } from '@/components/SurahSelector';
import { QuranDisplay } from '@/components/QuranDisplay';
import { RecitationControls } from '@/components/RecitationControls';
import { useAzureSpeech, type TranscriptionResult } from '@/hooks/useAzureSpeech';
import { useAuth } from '@/hooks/useAuth';
import { useUserProgress } from '@/hooks/useUserProgress';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LogIn, LogOut, Sun, Moon, Eye, EyeOff, Volume2, VolumeX } from 'lucide-react';

interface WordStatus {
  state: 'pending' | 'current' | 'correct' | 'incorrect';
  retries: number;
}

const MAX_RETRIES_BEFORE_HELP = 3;

// Group reciters by riwaya for the dropdown headings
const RECITERS_BY_RIWAYA = RECITERS.reduce<Record<string, Reciter[]>>((acc, r) => {
  (acc[r.riwaya] ??= []).push(r);
  return acc;
}, {});

export default function Index() {
  const [selectedSurah, setSelectedSurah]   = useState(1);
  const selectedSurahRef                    = useRef(1);
  const [words,          setWords]          = useState<QuranWord[]>([]);
  const [surahList,      setSurahList]      = useState<SurahInfo[]>([]);
  const [currentIndex,   setCurrentIndex]   = useState(0);
  const [wordStatuses,   setWordStatuses]   = useState<Map<number, WordStatus>>(new Map());
  const [loading,        setLoading]        = useState(false);
  const [lastHeard,      setLastHeard]      = useState('');
  const [phoneticInfo,   setPhoneticInfo]   = useState<string | null>(null);
  const [isDark,         setIsDark]         = useState(true);
  const [showPending,    setShowPending]    = useState(true);
  const [audioHelp,      setAudioHelp]      = useState(true); // toggle for 3-strikes audio
  const [reciter,        setReciter]        = useState<Reciter>(DEFAULT_RECITER);

  const currentIndexRef    = useRef(0);
  const wordsRef           = useRef<QuranWord[]>([]);
  const sessionStartRef    = useRef<number>(0);
  const wordsAttemptedRef  = useRef(0);
  const reciterRef         = useRef<Reciter>(DEFAULT_RECITER);

  // Keep ref in sync so the transcription callback (stale closure) always uses latest reciter
  useEffect(() => { reciterRef.current = reciter; }, [reciter]);

  const { isListening, isConnected, start, stop, updateRefText, mode, error: speechError } =
    useAzureSpeech();
  const { user, signOut }                       = useAuth();
  const { saveProgress, saveRecitationHistory } = useUserProgress();
  const { toast }                               = useToast();
  const navigate                                = useNavigate();

  const completedWords = [...wordStatuses.values()].filter(s => s.state === 'correct').length;
  const progress       = words.length > 0 ? (completedWords / words.length) * 100 : 0;
  const currentSurah   = surahList.find(s => s.number === selectedSurah);

  // ── Dark / light mode ─────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle('light', !isDark);
  }, [isDark]);

  // ── Load surah list once ──────────────────────────────────────────────────
  useEffect(() => {
    fetchSurahList().then(setSurahList).catch(console.error);
  }, []);

  // ── Preload upcoming ayah audio for selected reciter ──────────────────────
  useEffect(() => {
    if (!words.length || currentIndex >= words.length) return;
    const upcoming = words.slice(currentIndex, currentIndex + 5);
    const urls = [...new Set(
      upcoming.map(w => getAyahAudioUrl(selectedSurah, w.ayahNumber, reciter.id))
    )];
    preloadWordAudio(urls);
  }, [currentIndex, words, selectedSurah, reciter]);

  // ── Load surah text ───────────────────────────────────────────────────────
  const handleSurahSelect = useCallback(async (surahNumber: number) => {
    setSelectedSurah(surahNumber);
    selectedSurahRef.current = surahNumber;
    stop();
    setLastHeard('');
    setPhoneticInfo(null);
    setLoading(true);
    try {
      const surahWords = await fetchSurahText(surahNumber);
      setWords(surahWords);
      wordsRef.current = surahWords;
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      const statuses = new Map<number, WordStatus>();
      surahWords.forEach((_, i) =>
        statuses.set(i, { state: i === 0 ? 'current' : 'pending', retries: 0 })
      );
      setWordStatuses(statuses);
    } catch {
      toast({ title: 'Error', description: 'Failed to load Surah', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast, stop]);

  useEffect(() => { handleSurahSelect(1); }, []);

  // ── Auto-save ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !words.length) return;
    const iv = setInterval(() => {
      saveProgress(selectedSurah, currentIndexRef.current, words.length, completedWords, progress >= 100);
    }, 10_000);
    return () => clearInterval(iv);
  }, [user, selectedSurah, words.length, completedWords, progress, saveProgress]);

  // ── Transcription handler ─────────────────────────────────────────────────
  const handleTranscription = useCallback((result: TranscriptionResult) => {
    // Show interim text while speaking
    if (!result.isFinal) {
      setLastHeard(result.text);
      return;
    }

    setLastHeard(result.text);

    // Show phonetic accuracy if Azure returned it
    if (result.phonetic) {
      const { accuracyScore, fluencyScore } = result.phonetic;
      setPhoneticInfo(
        `Accuracy ${Math.round(accuracyScore)}% · Fluency ${Math.round(fluencyScore)}%`
      );
    } else {
      setPhoneticInfo(null);
    }

    const idx = currentIndexRef.current;
    const w   = wordsRef.current;
    if (idx >= w.length) return;
    wordsAttemptedRef.current++;

    const matchCount = matchConsecutiveWords(result.text, w, idx);

    setWordStatuses(prev => {
      const next = new Map(prev);

      if (matchCount > 0) {
        // Mark matched words correct
        for (let i = 0; i < matchCount; i++) {
          const cur = next.get(idx + i) ?? { state: 'current' as const, retries: 0 };
          next.set(idx + i, { state: 'correct', retries: cur.retries });
        }

        const nextIdx = idx + matchCount;

        if (nextIdx < w.length) {
          next.set(nextIdx, { state: 'current', retries: 0 });
          setCurrentIndex(nextIdx);
          currentIndexRef.current = nextIdx;

          // Update pronunciation-assessment reference text for next word
          updateRefText(w[nextIdx].text);
        } else {
          // Surah complete
          setCurrentIndex(nextIdx);
          currentIndexRef.current = nextIdx;
          stop();
          toast({ title: '🎉 ماشاء الله!', description: 'Surah complete!' });
          if (sessionStartRef.current > 0) {
            const dur = Math.floor((Date.now() - sessionStartRef.current) / 1000);
            saveRecitationHistory(selectedSurahRef.current, dur, wordsAttemptedRef.current, w.length);
          }
        }
      } else {
        // Wrong word
        const cur        = next.get(idx) ?? { state: 'current' as const, retries: 0 };
        const newRetries = cur.retries + 1;
        next.set(idx, { state: 'incorrect', retries: newRetries });

        // 3-strikes audio help — only if the toggle is ON
        if (newRetries >= MAX_RETRIES_BEFORE_HELP && audioHelp) {
          const url = getAyahAudioUrl(
            selectedSurahRef.current,
            w[idx].ayahNumber,
            reciterRef.current.id,
          );
          // playAudio uses AudioContext — works even while mic is active
          playAudio(url).catch(console.error);
          toast({
            title: `🔊 ${reciterRef.current.nameAr}`,
            description: 'Listen and repeat',
          });
        }

        // Reset word back to 'current' after the red flash
        setTimeout(() => {
          setWordStatuses(p => {
            const n = new Map(p);
            const s = n.get(idx);
            if (s?.state === 'incorrect') n.set(idx, { ...s, state: 'current' });
            return n;
          });
        }, 800);
      }

      return next;
    });
  }, [audioHelp, stop, toast, updateRefText, saveRecitationHistory]);

  // ── Start / Stop / Reset ──────────────────────────────────────────────────
  const handleStart = useCallback(() => {
    if (!words.length) return;
    // CRITICAL: unlockAudio must be called synchronously inside a click handler
    unlockAudio();
    sessionStartRef.current  = Date.now();
    wordsAttemptedRef.current = 0;
    const currentWord = wordsRef.current[currentIndexRef.current];
    start(handleTranscription, { refText: currentWord?.text });
  }, [words, start, handleTranscription]);

  const handleStop = useCallback(() => {
    stop();
    if (user && sessionStartRef.current > 0) {
      const dur = Math.floor((Date.now() - sessionStartRef.current) / 1000);
      saveRecitationHistory(selectedSurah, dur, wordsAttemptedRef.current, completedWords);
      saveProgress(selectedSurah, currentIndexRef.current, words.length, completedWords, progress >= 100);
    }
  }, [stop, user, selectedSurah, completedWords, words.length, progress, saveRecitationHistory, saveProgress]);

  const handleReset = useCallback(() => {
    stop();
    setLastHeard('');
    setPhoneticInfo(null);
    if (words.length) {
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      const statuses = new Map<number, WordStatus>();
      words.forEach((_, i) =>
        statuses.set(i, { state: i === 0 ? 'current' : 'pending', retries: 0 })
      );
      setWordStatuses(statuses);
    }
  }, [stop, words]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex flex-col transition-colors duration-300">

      {/* ── Sticky header ── */}
      <header className="border-b border-border/50 px-4 py-3 sticky top-0 z-40 bg-background/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2 flex-wrap">

          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <h1 className="font-quran text-2xl text-gold glow-gold">تلاوة</h1>
            <span className="text-xs text-muted-foreground hidden sm:block">Quran Recitation</span>
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-2 flex-wrap justify-end">

            {/* Surah selector */}
            <SurahSelector
              selectedSurah={selectedSurah}
              onSelect={handleSurahSelect}
              disabled={isListening}
            />

            {/* Reciter / Riwaya selector */}
            <Select
              value={reciter.id}
              onValueChange={id => setReciter(RECITERS.find(r => r.id === id) ?? DEFAULT_RECITER)}
              disabled={isListening}
            >
              <SelectTrigger className="w-52 border-border/50 bg-card text-foreground text-xs h-9 shrink-0">
                <SelectValue>
                  <div className="flex flex-col items-start leading-tight">
                    <span className="truncate">{reciter.name}</span>
                    <span className="text-muted-foreground/60 text-[10px]">{reciter.riwaya}</span>
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-card border-border z-50 max-h-80 overflow-y-auto">
                {Object.entries(RECITERS_BY_RIWAYA).map(([riwaya, reciters]) => (
                  <div key={riwaya}>
                    {/* Riwaya heading */}
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 border-b border-border/30">
                      {riwaya}
                    </div>
                    {reciters.map(r => (
                      <SelectItem key={r.id} value={r.id} className="text-foreground py-2">
                        <div className="flex flex-col">
                          <span className="text-sm">{r.name}</span>
                          <span className="font-quran text-xs text-muted-foreground">{r.nameAr}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>

            {/* Audio-help toggle (speaker icon) */}
            <Button
              variant={audioHelp ? 'default' : 'outline'}
              size="icon"
              className="shrink-0 border-border/50"
              title={audioHelp
                ? 'Audio help ON — plays recitation after 3 wrong attempts. Click to disable.'
                : 'Audio help OFF — click to enable.'}
              onClick={() => {
                unlockAudio();           // unlock on this gesture too
                setAudioHelp(h => !h);
              }}
            >
              {audioHelp
                ? <Volume2 className="w-4 h-4" />
                : <VolumeX className="w-4 h-4" />}
            </Button>

            {/* Eye: hide / show upcoming ayahs */}
            <Button
              variant="outline" size="icon"
              className="shrink-0 border-border/50"
              title={showPending ? 'Hide upcoming ayahs' : 'Show upcoming ayahs'}
              onClick={() => setShowPending(p => !p)}
            >
              {showPending ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </Button>

            {/* Dark / light */}
            <Button
              variant="outline" size="icon"
              className="shrink-0 border-border/50"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={() => setIsDark(d => !d)}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>

            {/* Auth */}
            {user ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground hidden md:block truncate max-w-[120px]">
                  {user.user_metadata?.full_name ?? user.email}
                </span>
                <Button variant="ghost" size="icon" onClick={signOut}>
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="outline" size="sm"
                className="gap-1 border-border/50"
                onClick={() => navigate('/auth')}
              >
                <LogIn className="w-3.5 h-3.5" />
                Login
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ── Status bar ── */}
      {isListening && (
        <div className={`px-4 py-1 text-center text-xs font-sans border-b ${
          mode === 'azure'
            ? 'bg-emerald-950/40 border-emerald-800/30 text-emerald-400'
            : 'bg-yellow-950/30 border-yellow-800/30 text-yellow-500'
        }`}>
          {mode === 'azure'
            ? `🟢 Azure Speech · ${reciter.riwaya} · ${reciter.name}`
            : '⚠️ Browser fallback — add VITE_WS_URL for Azure accuracy'}
        </div>
      )}

      {/* ── Main content ── */}
      <main className="flex-1 flex flex-col items-center px-4 py-6 gap-5 max-w-5xl mx-auto w-full">

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-24">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <QuranDisplay
            words={words}
            currentIndex={currentIndex}
            wordStatuses={wordStatuses}
            showPending={showPending}
            surahName={currentSurah?.name}
            surahEnglishName={currentSurah?.englishName}
            surahNumber={selectedSurah}
          />
        )}

        <RecitationControls
          isRecording={isListening}
          isConnected={isConnected}
          onStart={handleStart}
          onStop={handleStop}
          onReset={handleReset}
          progress={progress}
          totalWords={words.length}
          completedWords={completedWords}
          hasWords={words.length > 0}
        />

        {/* Feedback row */}
        <div className="flex flex-col items-center gap-1 min-h-10">
          {lastHeard && (
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground/40 font-sans uppercase tracking-wider">Heard</p>
              <p className="font-quran text-xl text-gold-dim" dir="rtl">{lastHeard}</p>
            </div>
          )}
          {phoneticInfo && (
            <p className="text-xs text-muted-foreground/60 font-sans">{phoneticInfo}</p>
          )}
          {!audioHelp && (
            <p className="text-xs text-muted-foreground/30 font-sans">
              🔇 Audio help is off
            </p>
          )}
        </div>

        {speechError && (
          <p className="text-xs text-red-400 text-center max-w-sm bg-red-950/20 rounded-lg px-3 py-2">
            {speechError}
          </p>
        )}
      </main>
    </div>
  );
}
