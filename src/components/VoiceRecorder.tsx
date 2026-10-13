'use client';
import { useState, useEffect, useRef } from 'react';
import type * as React from 'react';
import MicRecorder from 'mic-recorder-to-mp3';
import { Button } from '@/components/ui';

interface VoiceRecorderProps {
  onStop: (file: File) => void;
}

export default function VoiceRecorder({ onStop }: VoiceRecorderProps): React.JSX.Element {
  const recorderRef = useRef<MicRecorder | null>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isBlocked, setIsBlocked] = useState<boolean>(false);

  function getRecorder(): MicRecorder {
    if (!recorderRef.current) {
      recorderRef.current = new MicRecorder({ bitRate: 128 });
    }
    return recorderRef.current;
  }

  useEffect(() => {
    // Check for microphone permissions
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setIsBlocked(true);
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(() => setIsBlocked(false))
      .catch(() => setIsBlocked(true));
  }, []);

  const startRecording = (): void => {
    if (isBlocked) {
      alert('Microphone access is blocked. Please allow access in your browser settings.');
      return;
    }
    getRecorder().start().then(() => {
      setIsRecording(true);
    });
  };

  const stopRecording = (): void => {
    getRecorder().stop().getMp3().then(([buffer, blob]) => {
      const file = new File(buffer, 'voice-message.mp3', {
        type: blob.type,
        lastModified: Date.now()
      });
      onStop(file); // Pass the recorded audio file to the parent component
      setIsRecording(false);
    });
  };

  const toggleRecording = (): void => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={isRecording ? 'lime' : 'secondary'}
        onClick={toggleRecording}
        disabled={isBlocked}
        aria-pressed={isRecording}
        aria-label={isRecording ? 'Stop voice recording' : 'Start voice recording'}
        className={isRecording ? 'animate-pulse' : ''}
      >
        <span aria-hidden="true">{isRecording ? '■' : '🎤'}</span>
        {isRecording ? 'Stop' : 'Record'}
      </Button>
      {isBlocked && (
        <p role="alert" className="text-xs text-danger">
          Microphone access denied.
        </p>
      )}
    </div>
  );
}
