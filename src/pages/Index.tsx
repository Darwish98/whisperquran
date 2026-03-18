import { useState, useCallback, useRef, useEffect } from "react";
import {
  fetchSurahText,
  fetchSurahList,
  getAyahAudioUrl,
  type QuranWord,
  type SurahInfo,
  type Reciter,
  RECITERS,
  DEFAULT_RECITER,
} from "@/lib/quranApi";
import { playAudio, preloadWordAudio, unlockAudio } from "@/lib/audioPlayer";
import { SurahSelector } from "@/components/SurahSelector";
import { QuranDisplay } from "@/components/QuranDisplay";
import type { ServerRule } from "@/components/QuranDisplay";
import { RecitationControls } from "@/components/RecitationControls";
import { MicStatus } from "@/components/MicStatus";
import {
  useTajweedAnalysis,
  type WordTimingInput,
} from "@/hooks/useTajweedAnalysis";
import { TajweedScoreBar } from "@/components/TajweedIndicator";
import { useLocalASR, getTajweedData } from "@/hooks/useLocalASR";
import { RecitationSession } from "@/lib/ctc_matcher";
import type { MatchResult } from "@/lib/ctc_matcher";
type MicPermission = "idle" | "requesting" | "granted" | "denied" | "error";
import { useAuth } from "@/hooks/useAuth";
import { useUserProgress } from "@/hooks/useUserProgress";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LogIn,
  LogOut,
  Sun,
  Moon,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  RotateCcw,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WordStatus {
  state: "pending" | "current" | "correct" | "incorrect";
  retries: number;
}

const MAX_RETRIES_BEFORE_HELP = 3;

const RECITERS_BY_RIWAYA = RECITERS.reduce<Record<string, Reciter[]>>(
  (acc, r) => {
    (acc[r.riwaya] ??= []).push(r);
    return acc;
  },
  {},
);

export default function Index() {
  const [selectedSurah, setSelectedSurah] = useState(1);
  const selectedSurahRef = useRef(1);
  const tajweedRulesRef = useRef<Map<number, ServerRule[]>>(new Map());
  const [words, setWords] = useState<QuranWord[]>([]);
  const [surahList, setSurahList] = useState<SurahInfo[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [wordStatuses, setWordStatuses] = useState<Map<number, WordStatus>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);
  const [lastHeard, setLastHeard] = useState("");
  const [isDark, setIsDark] = useState(true);
  const [showPending, setShowPending] = useState(true);
  const [audioHelp, setAudioHelp] = useState(true);
  const [reciter, setReciter] = useState<Reciter>(DEFAULT_RECITER);
  const [micPermission, setMicPermission] = useState<MicPermission>("idle");

  const currentIndexRef = useRef(0);
  const wordsRef = useRef<QuranWord[]>([]);
  const sessionStartRef = useRef<number>(0);
  const wordsAttemptedRef = useRef(0);
  const reciterRef = useRef<Reciter>(DEFAULT_RECITER);
  const audioHelpRef = useRef(true);
  const sessionRef = useRef<RecitationSession | null>(null);

  useEffect(() => {
    reciterRef.current = reciter;
  }, [reciter]);
  useEffect(() => {
    audioHelpRef.current = audioHelp;
  }, [audioHelp]);
  useEffect(() => {
    document.documentElement.classList.toggle("light", !isDark);
  }, [isDark]);

  // ── Local ASR (replaces useAzureSpeech) ──────────────────────────────────
  const {
    isListening,
    isModelLoaded,
    isLoadingModel,
    loadProgress,
    loadStatus,
    executionProvider,
    error: asrError,
    start: asrStart,
    stop: asrStop,
  } = useLocalASR();

  const isConnected = isModelLoaded;

  const { user, signOut } = useAuth();
  const { saveProgress, saveRecitationHistory } = useUserProgress();
  const { toast } = useToast();
  const navigate = useNavigate();

  // ── Tajweed analysis ──────────────────────────────────────────────────────
  const {
    wordStatuses: tajweedStatuses,
    overallScore: tajweedScore,
    lastResult: tajweedResult,
    analyzeAyah,
    addAudioChunk,
    clearBuffer,
    getBufferedAudio,
    resetTajweedStatuses,
  } = useTajweedAnalysis();

  const ayahWordTimingsRef = useRef<Map<number, WordTimingInput[]>>(new Map());

  const completedWords = [...wordStatuses.values()].filter(
    (s) => s.state === "correct",
  ).length;
  const progress =
    words.length > 0 ? Math.round((completedWords / words.length) * 100) : 0;
  const currentSurah = surahList.find((s) => s.number === selectedSurah);

  useEffect(() => {
    fetchSurahList().then(setSurahList).catch(console.error);
  }, []);

  // ── Load tajweed from precomputed JSON (via useLocalASR) ──────────────────
  const loadTajweedForSurah = useCallback(
    (surahNum: number, quranWords: QuranWord[]) => {
      const tajweedData = getTajweedData();
      if (!tajweedData) return;
      const surahTajweed = tajweedData[String(surahNum)];
      if (!surahTajweed) return;

      const tajMap = new Map<number, ServerRule[]>();
      for (const [globalIndexStr, rules] of Object.entries(surahTajweed)) {
        const globalIndex = parseInt(globalIndexStr);
        tajMap.set(
          globalIndex,
          (
            rules as Array<{
              rule: string;
              cat: string;
              desc: string;
              arabic: string;
              hc: number;
              cs: number;
              ce: number;
            }>
          ).map((r) => ({
            rule: r.rule,
            category: r.cat,
            description: r.desc,
            arabicName: r.arabic,
            harakatCount: r.hc,
            charStart: r.cs,
            charEnd: r.ce,
          })),
        );
      }
      tajweedRulesRef.current = tajMap;
    },
    [],
  );

  // ── Load surah ────────────────────────────────────────────────────────────
  const handleSurahSelect = useCallback(
    async (num: number) => {
      if (isListening) asrStop();
      setSelectedSurah(num);
      selectedSurahRef.current = num;
      setLoading(true);
      setLastHeard("");
      clearBuffer();
      ayahWordTimingsRef.current.clear();
      resetTajweedStatuses();

      try {
        const w = await fetchSurahText(num);

        // Load tajweed from precomputed JSON (no server needed)
        loadTajweedForSurah(num, w);

        setWords(w);
        wordsRef.current = w;
        setCurrentIndex(0);
        currentIndexRef.current = 0;

        // Create RecitationSession for client-side matching
        sessionRef.current = new RecitationSession(
          RecitationSession.fromQuranWords(w),
        );

        const statuses = new Map<number, WordStatus>();
        w.forEach((_, i) =>
          statuses.set(i, {
            state: i === 0 ? "current" : "pending",
            retries: 0,
          }),
        );
        setWordStatuses(statuses);

        const firstGlobalAyahs = [
          ...new Set(w.slice(0, 30).map((word) => word.globalAyahNumber)),
        ];
        preloadWordAudio(
          firstGlobalAyahs.map((g) =>
            getAyahAudioUrl(g, reciterRef.current.id),
          ),
        );
      } catch (err) {
        console.error("Failed to load surah:", err);
        toast({
          title: "Error",
          description: "Failed to load surah text",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    },
    [
      isListening,
      asrStop,
      toast,
      clearBuffer,
      resetTajweedStatuses,
      loadTajweedForSurah,
    ],
  );

  useEffect(() => {
    handleSurahSelect(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-load tajweed when model finishes loading (tajweed data becomes available)
  useEffect(() => {
    if (isModelLoaded && wordsRef.current.length > 0) {
      loadTajweedForSurah(selectedSurahRef.current, wordsRef.current);
    }
  }, [isModelLoaded, loadTajweedForSurah]);

  // ── Tajweed analysis trigger ──────────────────────────────────────────────
  const triggerTajweedAnalysis = useCallback(
    (completedAyahNumber: number) => {
      const ayahWords = wordsRef.current.filter(
        (w) => w.ayahNumber === completedAyahNumber,
      );
      if (!ayahWords.length) return;
      const audioChunks = getBufferedAudio();
      const wordTimings =
        ayahWordTimingsRef.current.get(completedAyahNumber) ?? [];
      ayahWordTimingsRef.current.delete(completedAyahNumber);
      const globalIndexOffset = ayahWords[0]?.globalIndex ?? 0;
      analyzeAyah(
        audioChunks,
        ayahWords.map((aw) => aw.text),
        wordTimings,
        globalIndexOffset,
      ).catch(console.error);
    },
    [analyzeAyah, getBufferedAudio],
  );

  // ── Handle ASR result — now uses client-side ctc_matcher.ts ──────────────
  const handleASRResult = useCallback(
    (result: {
      text: string;
      isFinal: boolean;
      timings: Array<{
        word: string;
        durationMs: number;
        startMs: number;
        endMs: number;
      }>;
    }) => {
      if (!result.isFinal || !result.text.trim()) {
        setLastHeard(result.text);
        return;
      }
      setLastHeard(result.text);

      const w = wordsRef.current;
      const idx = currentIndexRef.current;
      if (!w.length || idx >= w.length || !sessionRef.current) return;

      wordsAttemptedRef.current++;

      // Run client-side matching
      const match: MatchResult = sessionRef.current.matchTranscript(
        result.text,
        result.timings,
      );

      // Store word timings for tajweed analysis
      for (const wm of match.words) {
        if (wm.durationMs != null) {
          const ayahTimings = ayahWordTimingsRef.current.get(wm.ayah) ?? [];
          ayahTimings.push({
            word_index: wm.wordInAyah,
            duration_ms: wm.durationMs,
          });
          ayahWordTimingsRef.current.set(wm.ayah, ayahTimings);
        }
      }

      setWordStatuses((prev) => {
        const next = new Map(prev);

        for (const wm of match.words) {
          if (wm.matched) {
            next.set(wm.globalIndex, { state: "correct", retries: 0 });
          } else if (wm.spoken) {
            next.set(wm.globalIndex, {
              state: "incorrect",
              retries: sessionRef.current!.getRetries(wm.globalIndex),
            });
          }
        }

        const newIndex = match.wordsMatched > 0 ? match.newPosition : idx;
        const prevAyah = w[idx]?.ayahNumber;

        if (match.wordsMatched > 0) {
          currentIndexRef.current = newIndex;
          setCurrentIndex(newIndex);
        }

        if (newIndex < w.length && match.wordsMatched > 0) {
          next.set(newIndex, {
            state: "current",
            retries: next.get(newIndex)?.retries ?? 0,
          });
        }

        const newAyah = w[newIndex]?.ayahNumber;
        if (
          prevAyah &&
          newAyah &&
          prevAyah !== newAyah &&
          match.wordsMatched > 0
        ) {
          triggerTajweedAnalysis(prevAyah);
        }

        if (newIndex < w.length && match.wordsMatched > 0) {
          const nextAyahs = [
            ...new Set(
              w.slice(newIndex, newIndex + 20).map((x) => x.globalAyahNumber),
            ),
          ];
          preloadWordAudio(
            nextAyahs.map((g) => getAyahAudioUrl(g, reciterRef.current.id)),
          );
        }

        if (
          (match.complete || newIndex >= w.length) &&
          match.wordsMatched > 0
        ) {
          if (prevAyah) triggerTajweedAnalysis(prevAyah);
          asrStop();
          toast({ title: "ماشاء الله", description: "Surah complete! 🎉" });
          if (sessionStartRef.current > 0) {
            const dur = Math.floor(
              (Date.now() - sessionStartRef.current) / 1000,
            );
            saveRecitationHistory(
              selectedSurahRef.current,
              dur,
              wordsAttemptedRef.current,
              w.length,
            );
          }
        }

        if (match.wordsMatched === 0 && match.words.length > 0) {
          const failedWord = match.words[0];
          if (
            failedWord &&
            !failedWord.matched &&
            sessionRef.current!.getRetries(failedWord.globalIndex) >=
              MAX_RETRIES_BEFORE_HELP &&
            audioHelpRef.current
          ) {
            const targetWord = w[failedWord.globalIndex];
            if (targetWord) {
              playAudio(
                getAyahAudioUrl(
                  targetWord.globalAyahNumber,
                  reciterRef.current.id,
                ),
              );
              toast({
                title: `🔊 ${reciterRef.current.nameAr}`,
                description: "Playing this ayah to help you.",
              });
            }
          }
          setTimeout(() => {
            setWordStatuses((p) => {
              const n = new Map(p);
              const s = n.get(currentIndexRef.current);
              if (s?.state === "incorrect")
                n.set(currentIndexRef.current, { ...s, state: "current" });
              return n;
            });
          }, 800);
        }

        return next;
      });
    },
    [asrStop, toast, saveRecitationHistory, triggerTajweedAnalysis],
  );

  // ── Start / Stop / Reset ──────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (!words.length) return;
    if (!user) {
      toast({
        title: "Login required",
        description: "Please sign in to use the recitation feature.",
        variant: "destructive",
      });
      navigate("/auth");
      return;
    }
    if (!isModelLoaded) {
      toast({
        title: "Model loading",
        description: "Please wait for the model to finish loading.",
        variant: "destructive",
      });
      return;
    }

    unlockAudio();
    clearBuffer();
    ayahWordTimingsRef.current.clear();
    resetTajweedStatuses();

    // Reset session position
    sessionRef.current?.reset();

    setMicPermission("requesting");
    sessionStartRef.current = Date.now();
    wordsAttemptedRef.current = 0;

    await asrStart(handleASRResult, {
      surah: selectedSurah,
      onAudioChunk: addAudioChunk,
    });
    setMicPermission("granted");
  }, [
    words,
    user,
    isModelLoaded,
    asrStart,
    handleASRResult,
    toast,
    navigate,
    clearBuffer,
    selectedSurah,
    addAudioChunk,
    resetTajweedStatuses,
  ]);

  const handleStop = useCallback(() => {
    asrStop();
    setMicPermission("idle");
    setLastHeard("");
    clearBuffer();
    const w = wordsRef.current;
    const idx = currentIndexRef.current;
    if (w.length && idx < w.length) triggerTajweedAnalysis(w[idx].ayahNumber);
    if (user && sessionStartRef.current > 0) {
      const dur = Math.floor((Date.now() - sessionStartRef.current) / 1000);
      saveRecitationHistory(
        selectedSurah,
        dur,
        wordsAttemptedRef.current,
        completedWords,
      );
      saveProgress(
        selectedSurah,
        currentIndexRef.current,
        words.length,
        completedWords,
        progress >= 100,
      );
    }
  }, [
    asrStop,
    user,
    selectedSurah,
    completedWords,
    words.length,
    progress,
    clearBuffer,
    saveRecitationHistory,
    saveProgress,
    triggerTajweedAnalysis,
  ]);

  const handleReset = useCallback(() => {
    asrStop();
    sessionRef.current?.reset();
    setMicPermission("idle");
    setLastHeard("");
    clearBuffer();
    ayahWordTimingsRef.current.clear();
    resetTajweedStatuses();
    if (words.length) {
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      const statuses = new Map<number, WordStatus>();
      words.forEach((_, i) =>
        statuses.set(i, { state: i === 0 ? "current" : "pending", retries: 0 }),
      );
      setWordStatuses(statuses);
    }
  }, [asrStop, words, clearBuffer, resetTajweedStatuses]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-[100dvh] bg-background flex flex-col transition-colors duration-300"
      onClick={unlockAudio}
    >
      {/* ── Sticky header ── */}
      <header className="border-b border-border/50 px-4 py-3 sticky top-0 z-40 bg-background/90 backdrop-blur-sm shrink-0">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 shrink-0">
            <h1 className="font-quran text-2xl text-gold glow-gold">تلاوة</h1>
            <span className="text-xs text-muted-foreground hidden sm:block">
              Quran Recitation
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <SurahSelector
              selectedSurah={selectedSurah}
              onSelect={handleSurahSelect}
              disabled={isListening}
            />
            <Select
              value={reciter.id}
              onValueChange={(id) =>
                setReciter(RECITERS.find((r) => r.id === id) ?? DEFAULT_RECITER)
              }
              disabled={isListening}
            >
              <SelectTrigger className="w-52 border-border/50 bg-card text-foreground text-xs h-9 shrink-0">
                <SelectValue>
                  <div className="flex flex-col items-start leading-tight">
                    <span className="truncate">{reciter.name}</span>
                    <span className="text-muted-foreground/60 text-[10px]">
                      {reciter.riwaya}
                    </span>
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-card border-border z-50 max-h-80 overflow-y-auto">
                {Object.entries(RECITERS_BY_RIWAYA).map(
                  ([riwaya, reciters]) => (
                    <div key={riwaya}>
                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 border-b border-border/30">
                        {riwaya}
                      </div>
                      {reciters.map((r) => (
                        <SelectItem
                          key={r.id}
                          value={r.id}
                          className="text-foreground py-2"
                        >
                          <div className="flex flex-col">
                            <span className="text-sm">{r.name}</span>
                            <span className="font-quran text-xs text-muted-foreground">
                              {r.nameAr}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </div>
                  ),
                )}
              </SelectContent>
            </Select>
            <Button
              variant={audioHelp ? "default" : "outline"}
              size="icon"
              className="shrink-0 border-border/50"
              title={
                audioHelp
                  ? "Audio help ON — click to disable."
                  : "Audio help OFF — click to enable."
              }
              onClick={() => {
                unlockAudio();
                setAudioHelp((h) => !h);
              }}
            >
              {audioHelp ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <VolumeX className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 border-border/50"
              title={
                showPending ? "Hide upcoming ayahs" : "Show upcoming ayahs"
              }
              onClick={() => setShowPending((p) => !p)}
            >
              {showPending ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 border-border/50"
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setIsDark((d) => !d)}
            >
              {isDark ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </Button>
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
                variant="outline"
                size="sm"
                className="gap-1 border-border/50"
                onClick={() => navigate("/auth")}
              >
                <LogIn className="w-3.5 h-3.5" /> Login
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ── Model download progress bar ── */}
      {isLoadingModel && (
        <div className="px-4 py-2 border-b shrink-0 bg-background/80">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center gap-3 mb-1">
              <Download className="w-3.5 h-3.5 text-muted-foreground animate-pulse" />
              <span className="text-xs text-muted-foreground">
                {loadStatus || "Loading model..."}
              </span>
              <span className="text-xs text-muted-foreground ml-auto">
                {loadProgress}%
              </span>
            </div>
            <div className="h-1 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${loadProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Status bar ── */}
      {isListening && (
        <div className="px-4 py-1 text-center text-xs font-sans border-b shrink-0 bg-emerald-950/40 border-emerald-800/30 text-emerald-400">
          🟢 FastConformer RNNT ·{" "}
          {executionProvider === "webgpu" ? "WebGPU" : "WASM"} · On-device
        </div>
      )}

      {/* ── Quran display ── */}
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
              tajweedStatuses={tajweedStatuses}
              tajweedRules={tajweedRulesRef.current}
            />
          )}
        </div>
      </main>

      {/* ── Controls ── */}
      <div className="shrink-0 px-4 py-6 border-t border-border/30">
        <div className="max-w-5xl mx-auto flex flex-col items-center gap-3">
          <RecitationControls
            isRecording={isListening}
            isConnected={isConnected}
            isAuthenticated={!!user}
            micPermission={micPermission}
            onStart={handleStart}
            onStop={handleStop}
            onReset={handleReset}
            onLogin={() => navigate("/auth")}
            progress={progress}
            totalWords={words.length}
            completedWords={completedWords}
            hasWords={words.length > 0}
          />
          {tajweedResult && (
            <TajweedScoreBar
              score={tajweedScore}
              rulesChecked={tajweedResult.rules_checked}
              violations={tajweedResult.violations.length}
              isDark={isDark}
            />
          )}
          {lastHeard && (
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground/40 font-sans uppercase tracking-wider">
                Heard
              </p>
              <p className="font-quran text-xl text-gold-dim" dir="rtl">
                {lastHeard}
              </p>
            </div>
          )}
          {!audioHelp && (
            <p className="text-xs text-muted-foreground/30 font-sans">
              🔇 Audio help off
            </p>
          )}
          {asrError && (
            <p className="text-xs text-red-400 text-center max-w-sm bg-red-950/20 rounded-lg px-3 py-2">
              {asrError}
            </p>
          )}
          {/* EP indicator when model is ready */}
          {isModelLoaded && !isListening && (
            <p className="text-[10px] text-muted-foreground/30 font-sans">
              📱 On-device ·{" "}
              {executionProvider === "webgpu" ? "WebGPU" : "WASM CPU"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
