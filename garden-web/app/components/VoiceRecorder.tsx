'use client';
import { useState, useRef, useCallback } from 'react';

interface VoiceRecorderProps {
  onRecordingComplete: (blob: Blob) => void;
  disabled?: boolean;
}

export function VoiceRecorder({ onRecordingComplete, disabled }: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<NodeJS.Timeout | null>(null);

  const startRecording = useCallback(async () => {
    if (disabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        onRecordingComplete(blob);
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.current = recorder;
      recorder.start();
      setRecording(true);
      setDuration(0);
      timer.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  }, [onRecordingComplete, disabled]);

  const stopRecording = useCallback(() => {
    if (mediaRecorder.current && recording) {
      mediaRecorder.current.stop();
      setRecording(false);
      if (timer.current) clearInterval(timer.current);
    }
  }, [recording]);

  const formatDuration = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={disabled}
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={startRecording}
        onTouchEnd={stopRecording}
        className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
          recording
            ? 'bg-red-500 scale-110 animate-pulse shadow-lg shadow-red-500/50'
            : 'bg-garden-600 hover:bg-garden-700'
        } text-white disabled:opacity-50`}
      >
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
        </svg>
      </button>
      {recording && (
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm font-mono text-red-500">{formatDuration(duration)}</span>
          <span className="text-xs text-earth-400 dark:text-gray-500">Release to save</span>
        </div>
      )}
      {!recording && (
        <span className="text-xs text-earth-400 dark:text-gray-500">Hold to record</span>
      )}
    </div>
  );
}
