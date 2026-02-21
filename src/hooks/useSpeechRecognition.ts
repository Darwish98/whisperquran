import { useState, useRef, useCallback } from 'react';

interface UseSpeechRecognitionReturn {
  isListening: boolean;
  start: (onResult: (text: string) => void) => void;
  stop: () => void;
  isSupported: boolean;
}

// Extend Window for webkitSpeechRecognition
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const onResultRef = useRef<((text: string) => void) | null>(null);
  const shouldRestartRef = useRef(false);

  const isSupported = typeof window !== 'undefined' && 
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const createRecognition = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();
    recognition.lang = 'ar-SA'; // Arabic (Saudi Arabia)
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Process all results from the current resultIndex
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          // Send all alternatives for better matching
          for (let j = 0; j < result.length; j++) {
            const transcript = result[j].transcript.trim();
            if (transcript && onResultRef.current) {
              onResultRef.current(transcript);
            }
          }
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event.error);
      if (event.error === 'no-speech' || event.error === 'audio-capture') {
        // Auto-restart on transient errors
        if (shouldRestartRef.current) {
          setTimeout(() => {
            try {
              recognition.start();
            } catch {
              // Ignore if already started
            }
          }, 300);
        }
      }
    };

    recognition.onend = () => {
      // Auto-restart if we should still be listening
      if (shouldRestartRef.current) {
        setTimeout(() => {
          try {
            recognition.start();
          } catch {
            // Ignore
          }
        }, 100);
      } else {
        setIsListening(false);
      }
    };

    return recognition;
  }, []);

  const start = useCallback((onResult: (text: string) => void) => {
    if (!isSupported) return;
    
    onResultRef.current = onResult;
    shouldRestartRef.current = true;

    const recognition = createRecognition();
    if (!recognition) return;

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setIsListening(true);
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
    }
  }, [isSupported, createRecognition]);

  const stop = useCallback(() => {
    shouldRestartRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  return { isListening, start, stop, isSupported };
}
