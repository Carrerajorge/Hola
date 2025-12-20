import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, MicOff, Volume2, VolumeX, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface VoiceChatModeProps {
  open: boolean;
  onClose: () => void;
}

export function VoiceChatMode({ open, onClose }: VoiceChatModeProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const speechSynthesisRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Clean up on unmount or close
  useEffect(() => {
    if (!open) {
      stopListening();
      stopSpeaking();
      cleanupAudio();
    }
    return () => {
      stopListening();
      stopSpeaking();
      cleanupAudio();
    };
  }, [open]);

  const cleanupAudio = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
  };

  const startAudioAnalysis = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      
      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(average / 255);
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };
      
      updateLevel();
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("No se pudo acceder al micrófono");
    }
  };

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setError("Tu navegador no soporta reconocimiento de voz");
      return;
    }

    setError(null);
    setTranscript("");
    
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'es-ES';

    recognition.onstart = () => {
      setIsListening(true);
      startAudioAnalysis();
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';
      
      for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript = transcript;
        }
      }
      
      setTranscript(finalTranscript || interimTranscript);
    };

    recognition.onend = async () => {
      setIsListening(false);
      cleanupAudio();
      setAudioLevel(0);
      
      if (transcript.trim()) {
        await sendToGrok(transcript);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      cleanupAudio();
      setAudioLevel(0);
      if (event.error !== 'no-speech') {
        setError(`Error: ${event.error}`);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [transcript]);

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    cleanupAudio();
    setAudioLevel(0);
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const sendToGrok = async (text: string) => {
    setIsProcessing(true);
    setResponse("");
    
    try {
      const res = await fetch("/api/voice-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      
      if (!res.ok) {
        throw new Error("Error al comunicarse con el servidor");
      }
      
      const data = await res.json();
      setResponse(data.response);
      
      // Speak the response
      speakResponse(data.response);
    } catch (err: any) {
      console.error("Error sending to Grok:", err);
      setError(err.message || "Error al procesar tu mensaje");
    } finally {
      setIsProcessing(false);
    }
  };

  const speakResponse = (text: string) => {
    if (!text) return;
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.rate = 1;
    utterance.pitch = 1;
    
    // Try to get a Spanish voice
    const voices = window.speechSynthesis.getVoices();
    const spanishVoice = voices.find(v => v.lang.startsWith('es'));
    if (spanishVoice) {
      utterance.voice = spanishVoice;
    }
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    speechSynthesisRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const handleToggleListen = () => {
    if (isListening) {
      stopListening();
    } else if (isSpeaking) {
      stopSpeaking();
    } else {
      startListening();
    }
  };

  // Calculate bubble scale based on audio level
  const bubbleScale = 1 + (audioLevel * 0.5);
  const bubbleGlow = audioLevel * 100;

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-gradient-to-br from-gray-900 via-black to-gray-900 flex flex-col items-center justify-center"
        data-testid="voice-chat-mode"
      >
        {/* Close button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="absolute top-6 right-6 h-12 w-12 rounded-full text-white/70 hover:text-white hover:bg-white/10"
          data-testid="button-close-voice-chat"
        >
          <X className="h-6 w-6" />
        </Button>

        {/* Status text */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-8 left-1/2 -translate-x-1/2 text-white/80 text-lg font-medium"
        >
          {isListening ? "Escuchando..." : isSpeaking ? "Hablando..." : isProcessing ? "Procesando..." : "Toca para hablar"}
        </motion.div>

        {/* Main animated bubble */}
        <motion.div
          className="relative flex items-center justify-center"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          {/* Outer glow ring */}
          <motion.div
            className={cn(
              "absolute w-64 h-64 rounded-full",
              isListening ? "bg-blue-500/20" : isSpeaking ? "bg-green-500/20" : "bg-white/10"
            )}
            animate={{
              scale: isListening || isSpeaking ? [1, 1.2, 1] : 1,
              opacity: isListening || isSpeaking ? [0.3, 0.5, 0.3] : 0.2,
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
          
          {/* Middle ring */}
          <motion.div
            className={cn(
              "absolute w-48 h-48 rounded-full",
              isListening ? "bg-blue-400/30" : isSpeaking ? "bg-green-400/30" : "bg-white/15"
            )}
            animate={{
              scale: isListening ? [1, 1 + audioLevel * 0.3, 1] : isSpeaking ? [1, 1.15, 1] : 1,
            }}
            transition={{
              duration: isListening ? 0.1 : 1,
              repeat: isListening ? 0 : Infinity,
              ease: "easeOut",
            }}
            style={{
              transform: `scale(${isListening ? bubbleScale : 1})`,
            }}
          />
          
          {/* Main bubble button */}
          <motion.button
            onClick={handleToggleListen}
            disabled={isProcessing}
            className={cn(
              "relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300",
              "focus:outline-none focus:ring-4 focus:ring-white/30",
              isListening 
                ? "bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/50" 
                : isSpeaking 
                  ? "bg-gradient-to-br from-green-500 to-green-600 shadow-lg shadow-green-500/50"
                  : isProcessing
                    ? "bg-gradient-to-br from-amber-500 to-amber-600 shadow-lg shadow-amber-500/50"
                    : "bg-gradient-to-br from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 shadow-lg shadow-black/50"
            )}
            style={{
              boxShadow: isListening 
                ? `0 0 ${bubbleGlow}px rgba(59, 130, 246, 0.6)` 
                : isSpeaking 
                  ? `0 0 60px rgba(34, 197, 94, 0.5)`
                  : undefined,
            }}
            whileTap={{ scale: 0.95 }}
            data-testid="button-voice-bubble"
          >
            {isProcessing ? (
              <Loader2 className="h-12 w-12 text-white animate-spin" />
            ) : isListening ? (
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              >
                <MicOff className="h-12 w-12 text-white" />
              </motion.div>
            ) : isSpeaking ? (
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              >
                <Volume2 className="h-12 w-12 text-white" />
              </motion.div>
            ) : (
              <Mic className="h-12 w-12 text-white" />
            )}
          </motion.button>
          
          {/* Audio level visualization rings */}
          {isListening && (
            <>
              {[...Array(3)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute rounded-full border-2 border-blue-400/30"
                  style={{
                    width: 140 + (i * 40) + (audioLevel * 80),
                    height: 140 + (i * 40) + (audioLevel * 80),
                  }}
                  animate={{
                    opacity: [0.5 - i * 0.15, 0.2, 0.5 - i * 0.15],
                    scale: [1, 1.05, 1],
                  }}
                  transition={{
                    duration: 1,
                    repeat: Infinity,
                    delay: i * 0.2,
                  }}
                />
              ))}
            </>
          )}
        </motion.div>

        {/* Transcript display */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute bottom-32 left-0 right-0 px-8 text-center"
        >
          {transcript && (
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-white/90 text-xl mb-4 max-w-lg mx-auto"
            >
              "{transcript}"
            </motion.p>
          )}
          {response && !isListening && (
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-white/70 text-lg max-w-lg mx-auto line-clamp-3"
            >
              {response}
            </motion.p>
          )}
          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-red-400 text-sm"
            >
              {error}
            </motion.p>
          )}
        </motion.div>

        {/* Bottom controls */}
        <div className="absolute bottom-8 flex items-center gap-4">
          {isSpeaking && (
            <Button
              variant="ghost"
              size="sm"
              onClick={stopSpeaking}
              className="text-white/70 hover:text-white hover:bg-white/10"
              data-testid="button-stop-speaking"
            >
              <VolumeX className="h-5 w-5 mr-2" />
              Silenciar
            </Button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
