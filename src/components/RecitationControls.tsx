import { Mic, MicOff, RotateCcw, LogIn, Loader2, CheckCircle2, AlertCircle, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MicPermission } from '@/hooks/useAzureSpeech';

interface RecitationControlsProps {
  isRecording:     boolean;
  isConnected:     boolean;
  micPermission:   MicPermission;
  isAuthenticated: boolean;
  onStart:  () => void;
  onStop:   () => void;
  onReset:  () => void;
  onLogin:  () => void;
  progress:       number;
  totalWords:     number;
  completedWords: number;
  hasWords:       boolean;
}

function MicStatusBadge({
  micPermission, isRecording, isAuthenticated,
}: { micPermission: MicPermission; isRecording: boolean; isAuthenticated: boolean }) {
  if (!isAuthenticated) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
        <ShieldAlert className="w-3.5 h-3.5" />
        Sign in to enable recitation
      </span>
    );
  }
  if (isRecording) {
    return (
      <span className="flex items-center gap-2 text-xs">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-muted-foreground tracking-widest uppercase animate-pulse font-sans">Listening…</span>
      </span>
    );
  }
  switch (micPermission) {
    case 'requesting':
      return (
        <span className="flex items-center gap-1.5 text-xs text-yellow-400 font-sans">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Requesting microphone…
        </span>
      );
    case 'granted':
      return (
        <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-sans">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Microphone ready
        </span>
      );
    case 'denied':
      return (
        <span className="flex items-center gap-1.5 text-xs text-red-400 font-sans">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          Permission denied — allow mic in browser settings
        </span>
      );
    case 'error':
      return (
        <span className="flex items-center gap-1.5 text-xs text-red-400 font-sans">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          Microphone error
        </span>
      );
    default:
      return (
        <span className="text-xs text-muted-foreground/40 font-sans tracking-wide">
          Tap the microphone to begin
        </span>
      );
  }
}

export function RecitationControls({
  isRecording, isConnected, micPermission, isAuthenticated,
  onStart, onStop, onReset, onLogin,
  progress, totalWords, completedWords, hasWords,
}: RecitationControlsProps) {
  return (
    <div className="w-full max-w-sm mx-auto">

      {/* Progress bar */}
      {hasWords && totalWords > 0 && (
        <div className="mb-5">
          <div className="flex justify-between mb-1.5">
            <span className="text-xs text-muted-foreground/50 font-sans">Progress</span>
            <span className="text-xs font-sans text-muted-foreground">
              <span className="text-gold">{completedWords}</span>
              <span className="opacity-40 mx-1">/</span>
              {totalWords}
            </span>
          </div>
          <div className="h-1 w-full rounded-full bg-border/30 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, progress)}%`,
                background: 'linear-gradient(to right, #059669, hsl(45 70% 55%))',
              }}
            />
          </div>
          {progress >= 100 && (
            <p className="text-center text-xs text-emerald-400 mt-1.5">ماشاء الله — Surah Complete! 🎉</p>
          )}
        </div>
      )}

      {/* Buttons */}
      <div className="flex items-center justify-center gap-6">

        {/* Reset */}
        <button
          onClick={onReset}
          disabled={!hasWords || isRecording}
          className={cn(
            'w-10 h-10 rounded-full border border-border/50 flex items-center justify-center',
            'text-muted-foreground hover:text-foreground hover:border-border transition-all',
            'disabled:opacity-20 disabled:cursor-not-allowed',
          )}
          title="Reset"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Main button — auth gate or mic */}
        {!isAuthenticated ? (
          <button
            onClick={onLogin}
            className={cn(
              'relative w-20 h-20 rounded-full flex flex-col items-center justify-center gap-1',
              'bg-border/10 border-2 border-border/40',
              'hover:bg-border/20 hover:border-border transition-all',
            )}
            title="Sign in to start reciting"
          >
            <LogIn className="w-6 h-6 text-muted-foreground" />
            <span className="text-[9px] font-sans text-muted-foreground uppercase tracking-wide">Sign in</span>
          </button>
        ) : (
          <button
            onClick={isRecording ? onStop : onStart}
            disabled={!hasWords}
            className={cn(
              'relative w-20 h-20 rounded-full flex items-center justify-center',
              'transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed',
              isRecording
                ? 'bg-red-500/10 border-2 border-red-500 recording-pulse'
                : 'bg-gold/10 border-2 border-gold/70 hover:bg-gold/20 hover:border-gold hover:shadow-[0_0_30px_rgba(180,140,60,0.3)]',
            )}
            title={isRecording ? 'Stop reciting' : 'Start reciting'}
          >
            {isRecording && (
              <>
                <span className="absolute inset-0 rounded-full border-2 border-red-500/40 animate-ping" />
                <span className="absolute inset-[-8px] rounded-full border border-red-500/20 animate-ping" style={{ animationDelay: '0.3s' }} />
              </>
            )}
            {isRecording
              ? <MicOff className="w-7 h-7 text-red-400 relative z-10" />
              : <Mic    className="w-7 h-7 text-gold    relative z-10" />
            }
          </button>
        )}

        {/* Spacer */}
        <div className="w-10 h-10" />
      </div>

      {/* Mic status */}
      <div className="text-center mt-3 min-h-[1.25rem] flex items-center justify-center">
        <MicStatusBadge
          micPermission={micPermission}
          isRecording={isRecording}
          isAuthenticated={isAuthenticated}
        />
      </div>
    </div>
  );
}
