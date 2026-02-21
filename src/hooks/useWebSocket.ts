import { useState, useRef, useCallback } from 'react';

interface UseWebSocketReturn {
  isConnected: boolean;
  connect: (url: string, onMessage: (text: string) => void) => void;
  disconnect: () => void;
  sendAudio: (blob: Blob) => void;
}

export function useWebSocket(): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback((url: string, onMessage: (text: string) => void) => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        console.log('WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.text) {
            onMessage(data.text);
          }
        } catch {
          // If not JSON, treat as plain text
          onMessage(event.data);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        console.log('WebSocket disconnected');
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };
    } catch (err) {
      console.error('WebSocket connection failed:', err);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const sendAudio = useCallback((blob: Blob) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(blob);
    }
  }, []);

  return { isConnected, connect, disconnect, sendAudio };
}
