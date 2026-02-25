import { useState, useEffect } from 'react';
import { Mic, MicOff, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MicPermissionState = 'prompt' | 'granted' | 'denied' | 'listening' | 'checking';

interface MicStatusProps {
  isListening: boolean;
  className?: string;
}

export function MicStatus({ isListening, className }: MicStatusProps) {
  const [permission, setPermission] = useState<MicPermissionState>('checking');

  useEffect(() => {
    if (isListening) {
      setPermission('listening');
      return;
    }

    // Check mic permission state
    async function checkPermission() {
      try {
        // Modern Permissions API
        if (navigator.permissions && navigator.permissions.query) {
          const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          setPermission(result.state as MicPermissionState);

          result.addEventListener('change', () => {
            if (!isListening) {
              setPermission(result.state as MicPermissionState);
            }
          });
          return;
        }
      } catch {
        // Permissions API not supported (Safari)
      }

      // Fallback: check if we can enumerate devices with labels (indicates granted)
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasMicLabel = devices.some(d => d.kind === 'audioinput' && d.label);
        setPermission(hasMicLabel ? 'granted' : 'prompt');
      } catch {
        setPermission('prompt');
      }
    }

    checkPermission();
  }, [isListening]);

  const config = {
    checking: {
      icon: Loader2,
      text: 'Checking microphone...',
      color: 'text-muted-foreground',
      bg: 'bg-muted/50',
      border: 'border-border/50',
      animate: 'animate-spin',
    },
    prompt: {
      icon: AlertTriangle,
      text: 'Microphone permission required',
      color: 'text-yellow-500',
      bg: 'bg-yellow-500/10',
      border: 'border-yellow-500/30',
      animate: '',
    },
    granted: {
      icon: CheckCircle2,
      text: 'Microphone ready',
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
      animate: '',
    },
    denied: {
      icon: MicOff,
      text: 'Microphone blocked — check browser settings',
      color: 'text-red-500',
      bg: 'bg-red-500/10',
      border: 'border-red-500/30',
      animate: '',
    },
    listening: {
      icon: Mic,
      text: 'Listening...',
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
      animate: 'animate-pulse',
    },
  };

  const c = config[permission];
  const Icon = c.icon;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-sans border transition-all duration-300',
        c.bg, c.border, c.color,
        className,
      )}
    >
      <Icon className={cn('w-3.5 h-3.5 shrink-0', c.animate)} />
      <span>{c.text}</span>
      {permission === 'listening' && (
        <span className="flex gap-0.5 ml-1">
          <span className="w-1 h-3 bg-emerald-400 rounded-full animate-[equalizer_0.5s_ease-in-out_infinite_alternate]" />
          <span className="w-1 h-3 bg-emerald-400 rounded-full animate-[equalizer_0.5s_ease-in-out_0.15s_infinite_alternate]" />
          <span className="w-1 h-3 bg-emerald-400 rounded-full animate-[equalizer_0.5s_ease-in-out_0.3s_infinite_alternate]" />
        </span>
      )}
    </div>
  );
}
