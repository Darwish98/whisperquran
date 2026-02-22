import { Mic, MicOff, RotateCcw, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RecitationControlsProps {
  isRecording: boolean;
  isConnected: boolean;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  progress: number;
  totalWords: number;
  completedWords: number;
  hasWords: boolean;
}

export function RecitationControls({
  isRecording,
  isConnected,
  onStart,
  onStop,
  onReset,
  progress,
  totalWords,
  completedWords,
  hasWords,
}: RecitationControlsProps) {
  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Progress bar */}
      {hasWords && totalWords > 0 && (
        <div className="mb-6 px-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-sans text-muted-foreground tracking-wide">
              Progress
            </span>
            <span className="text-xs font-sans text-muted-foreground">
              <span className="text-gold">{completedWords}</span>
              <span className="opacity-40 mx-1">/</span>
              {totalWords} words
            </span>
          </div>
          <div className="relative h-1 w-full rounded-full bg-border/30 overflow-hidden">
            {/* Track */}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-600 to-gold transition-all duration-500 ease-out"
              style={{ width: `${Math.min(100, progress)}%` }}
            />
            {/* Shimmer */}
            {isRecording && progress < 100 && (
              <div
                className="absolute inset-y-0 rounded-full bg-white/20 animate-[shimmer_2s_ease-in-out_infinite]"
                style={{ width: '30%', left: `${Math.max(0, progress - 15)}%` }}
              />
            )}
          </div>
          {progress >= 100 && (
            <p className="text-center text-xs text-correct mt-2 font-sans">
              ماشاء الله — Surah Complete! 🎉
            </p>
          )}
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center justify-center gap-4">
        {/* Reset */}
        <button
          onClick={onReset}
          disabled={!hasWords}
          className={cn(
            'w-10 h-10 rounded-full border border-border/50 flex items-center justify-center',
            'text-muted-foreground hover:text-foreground hover:border-border transition-all duration-200',
            'disabled:opacity-20 disabled:cursor-not-allowed',
          )}
          title="Reset"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Main mic button */}
        <button
          onClick={isRecording ? onStop : onStart}
          disabled={!hasWords}
          className={cn(
            'relative w-20 h-20 rounded-full flex items-center justify-center',
            'transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed',
            isRecording
              ? [
                  'bg-incorrect/10 border-2 border-incorrect',
                  'shadow-[0_0_0_0_rgba(220,50,50,0.4)]',
                  'recording-pulse',
                ]
              : [
                  'bg-gold/10 border-2 border-gold/70',
                  'hover:bg-gold/20 hover:border-gold hover:shadow-[0_0_30px_rgba(180,140,60,0.3)]',
                ],
          )}
          title={isRecording ? 'Stop' : 'Start reciting'}
        >
          {/* Outer ring animation when recording */}
          {isRecording && (
            <>
              <span className="absolute inset-0 rounded-full border-2 border-incorrect/40 animate-ping" />
              <span className="absolute inset-[-8px] rounded-full border border-incorrect/20 animate-ping animation-delay-300" />
            </>
          )}

          {isRecording ? (
            <MicOff className="w-7 h-7 text-incorrect relative z-10" />
          ) : (
            <Mic className="w-7 h-7 text-gold relative z-10" />
          )}
        </button>

        {/* Status / next word hint */}
        <div className="w-10 h-10 flex items-center justify-center">
          {isRecording && (
            <ChevronRight className="w-4 h-4 text-muted-foreground/40 animate-pulse" />
          )}
        </div>
      </div>

      {/* Status text */}
      <div className="text-center mt-4 h-6">
        {isRecording ? (
          <p className="text-xs font-sans text-muted-foreground animate-pulse tracking-widest uppercase">
            Listening…
          </p>
        ) : hasWords && completedWords === 0 ? (
          <p className="text-xs font-sans text-muted-foreground/50 tracking-wide">
            Tap the microphone to begin
          </p>
        ) : null}
      </div>
    </div>
  );
}
