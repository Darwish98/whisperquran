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
import { MicStatus } from '@/components/MicStatus';
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
  const [audioHelp,      setAudioHelp]      = useState(true);
  const [reciter,        setReciter]        = useState<Reciter>(DEFAULT_RECITER);

  const currentIndexRef    = useRef(0);
  const wordsRef           = useRef<QuranWord[]>([]);
  const sessionStartRef    = useRef<number>(0);
  const wordsAttemptedRef  = useRef(0);
  const reciterRef         = useRef<Reciter>(DEFAULT_RECITER);

  useEffect(() => { reciterRef.current = reciter; }, [reciter]);

  const { isListening, isConnected, start, stop, updateRefText, mode, error: speechError } =
    useAzureSpeech();
  const { user, signOut }                       = useAuth();
  const { saveProgress, saveRecitationHistory } = useUserProgress();
  const { toast }                               = useToast();
  const navigate                                = useNavigate();

  const completedWords = [...wordStatuses.values()].filter(s => s.state === 'correct').length;
  const progress       = words.length > 0 ? Math.round((completedWords / words.length) * 100) : 0;
  const currentSurah   = surahList.find(s => s.number === selectedSurah);

  // ── Load surah list once ──────────────────────────────────────────────────
  useEffect(() => {
    fetchSurahList().then(setSurahList).catch(console.error);
  }, []);

  // ── Load surah text ───────────────────────────────────────────────────────
  const handleSurahSelect = useCallback(async (num: number) => {
    if (isListening) stop();
    setSelectedSurah(num);
    selectedSurahRef.current = num;
    setLoading(true);
    setLastHeard('');
    setPhoneticInfo(null);

    try {
      const w = await fetchSurahText(num);
      setWords(w);
      wordsRef.current = w;
      setCurrentIndex(0);
      currentIndexRef.current = 0;

      const statuses = new Map<number, WordStatus>();
      w.forEach((_, i) => statuses.set(i, { state: i === 0 ? 'current' : 'pending', retries: 0 }));
      setWordStatuses(statuses);

      // Preload audio for first few ayahs
      const firstAyahs = [...new Set(w.slice(0, 30).map(word => word.ayahNumber))];
      const urls = firstAyahs.map(ay => getAyahAudioUrl(num, ay, reciterRef.current.id));
      preloadWordAudio(urls);
    } catch (err) {
      console.error('Failed to load surah:', err);
      toast({ title: 'Error', description: 'Failed to load surah text', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [isListening, stop, toast]);

  // Load default surah on mount
  useEffect(() => { handleSurahSelect(1); }, []);

  // ── Transcription handler ─────────────────────────────────────────────────
  const handleTranscription = useCallback((result: TranscriptionResult) => {
    if (!result.isFinal) {
      setLastHeard(result.text);
      return;
    }

    setLastHeard(result.text);

    // Show phonetic info if available
    if (result.phonetic) {
      const p = result.phonetic;
      setPhoneticInfo(
        `Accuracy: ${p.accuracyScore}% · Fluency: ${p.fluencyScore}% · Pronunciation: ${p.pronunciationScore}%`
      );
    }

    const w   = wordsRef.current;
    const idx = currentIndexRef.current;
    if (!w.length || idx >= w.length) return;

    wordsAttemptedRef.current++;

    // Try to match recognized text against current and nearby words
    const matchResult = matchConsecutiveWords(
      result.text,
      w.slice(idx, idx + 5).map(x => x.text),
    );

    setWordStatuses(prev => {
      const next = new Map(prev);

      if (matchResult.matched > 0) {
        // Mark matched words as correct
        for (let i = 0; i < matchResult.matched; i++) {
          next.set(idx + i, { state: 'correct', retries: 0 });
        }

        const newIndex = idx + matchResult.matched;
        currentIndexRef.current = newIndex;
        setCurrentIndex(newIndex);

        // Update ref text for pronunciation assessment
        if (newIndex < w.length) {
          next.set(newIndex, { state: 'current', retries: 0 });
          updateRefText(w[newIndex].text);
        }

        // Preload audio for upcoming ayahs
        const nextAyahs = [...new Set(w.slice(newIndex, newIndex + 20).map(x => x.ayahNumber))];
        const urls = nextAyahs.map(ay => getAyahAudioUrl(selectedSurahRef.current, ay, reciterRef.current.id));
        preloadWordAudio(urls);

        // Check surah completion
        if (newIndex >= w.length) {
          stop();
          toast({ title: 'ماشاء الله', description: 'Surah complete!' });
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
          playAudio(url).then(success => {
            if (!success) {
              toast({
                title: '🔇 Audio blocked',
                description: 'Click anywhere to enable audio, then try again.',
                variant: 'destructive',
              });
            }
          });
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

    // SECURITY: Require authenticated user before allowing recitation
    if (!user) {
      toast({
        title: 'Login required',
        description: 'Please sign in to use the recitation feature.',
        variant: 'destructive',
      });
      navigate('/auth');
      return;
    }

    // CRITICAL: unlockAudio must be called synchronously inside a click handler
    // This satisfies browser autoplay policy for ALL future playAudio() calls
    unlockAudio();

    sessionStartRef.current  = Date.now();
    wordsAttemptedRef.current = 0;
    const currentWord = wordsRef.current[currentIndexRef.current];
    start(handleTranscription, { refText: currentWord?.text });
  }, [words, user, start, handleTranscription, toast, navigate]);

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
    <div className="min-h-[100dvh] bg-background flex flex-col transition-colors duration-300">

      {/* ── Sticky header ── */}
      <header className="border-b border-border/50 px-4 py-3 sticky top-0 z-40 bg-background/90 backdrop-blur-sm shrink-0">
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

            {/* Audio-help toggle */}
            <Button
              variant={audioHelp ? 'default' : 'outline'}
              size="icon"
              className="shrink-0 border-border/50"
              title={audioHelp
                ? 'Audio help ON — plays recitation after 3 wrong attempts. Click to disable.'
                : 'Audio help OFF — click to enable.'}
              onClick={() => {
                unlockAudio();
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
              title={showPending ? 'Hide upcoming ayahs (show only numbers)' : 'Show upcoming ayahs'}
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
        <div className={`px-4 py-1 text-center text-xs font-sans border-b shrink-0 ${
          mode === 'azure'
            ? 'bg-emerald-950/40 border-emerald-800/30 text-emerald-400'
            : 'bg-yellow-950/30 border-yellow-800/30 text-yellow-500'
        }`}>
          {mode === 'azure'
            ? `🟢 Azure Speech · ${reciter.riwaya} · ${reciter.name}`
            : '⚠️ Browser fallback — add VITE_WS_URL for Azure accuracy'}
        </div>
      )}

      {/* ── CONTROLS SECTION — ALWAYS ABOVE FOLD ── */}
      <div className="shrink-0 px-4 py-4 border-b border-border/30">
        <div className="max-w-5xl mx-auto flex flex-col items-center gap-3">

          {/* Mic status indicator */}
          <MicStatus isListening={isListening} />

          {/* Main recitation controls (mic button, progress, reset) */}
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

          {/* Auth prompt for non-logged-in users */}
          {!user && words.length > 0 && (
            <p className="text-xs text-muted-foreground/60 font-sans text-center">
              <button
                onClick={() => navigate('/auth')}
                className="text-gold hover:underline"
              >
                Sign in
              </button>
              {' '}to start reciting and save your progress
            </p>
          )}

          {/* Feedback row */}
          <div className="flex flex-col items-center gap-1 min-h-6">
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
        </div>
      </div>

      {/* ── QURAN DISPLAY — SCROLLABLE AREA BELOW CONTROLS ── */}
      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-5xl mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
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
        </div>
      </main>
    </div>
  );
}
