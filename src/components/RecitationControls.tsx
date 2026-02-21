import { Mic, MicOff, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

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
  onStart,
  onStop,
  onReset,
  progress,
  totalWords,
  completedWords,
  hasWords,
}: RecitationControlsProps) {
  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-center gap-4">
        {!isRecording ? (
          <Button
            onClick={onStart}
            disabled={!hasWords}
            size="lg"
            className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 px-8"
          >
            <Mic className="w-5 h-5" />
            Start Reciting
          </Button>
        ) : (
          <Button
            onClick={onStop}
            size="lg"
            variant="destructive"
            className="gap-2 px-8"
          >
            <div className="recording-pulse w-3 h-3 rounded-full bg-destructive-foreground" />
            <MicOff className="w-5 h-5" />
            Stop
          </Button>
        )}
        <Button
          onClick={onReset}
          variant="outline"
          size="lg"
          className="border-border text-foreground hover:bg-secondary gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          Reset
        </Button>
      </div>

      {hasWords && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{completedWords} / {totalWords} words</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2 bg-secondary [&>div]:bg-primary" />
        </div>
      )}
    </div>
  );
}
