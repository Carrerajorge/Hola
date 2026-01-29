import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mic, MicOff, Volume2, VolumeX, Loader2, Video, VideoOff, Upload, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface VoiceChatModeProps {
  open: boolean;
  onClose: () => void;
}

type InputMode = "idle" | "mic" | "camera" | "uploading";

export function VoiceChatMode({ open, onClose }: VoiceChatModeProps) {
  const [inputMode, setInputMode] = useState<InputMode>("idle");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const speechSynthesisRef = useRef<SpeechSynthesisUtterance | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Clean up on unmount or close
  useEffect(() => {
    if (!open) {
      stopListening();
      stopSpeaking();
      stopCamera();
      cleanupAudio();
      setInputMode("idle");
    }
    return () => {
      stopListening();
      stopSpeaking();
      stopCamera();
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
    setInputMode("mic");

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
      setInputMode("idle");
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      cleanupAudio();
      setAudioLevel(0);
      setInputMode("idle");
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
    setInputMode("idle");
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  // Camera functions
  const startCamera = async () => {
    try {
      setCameraError(null);
      setInputMode("camera");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true
      });
      videoStreamRef.current = stream;
      setIsCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error("Error accessing camera:", err);
      setCameraError("No se pudo acceder a la cámara");
      setInputMode("idle");
    }
  };

  const stopCamera = () => {
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
      videoStreamRef.current = null;
    }
    setIsCameraActive(false);
    setInputMode("idle");
  };

  // File upload functions
  const handleFileUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setInputMode("uploading");
    const file = files[0];

    // Validate file
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      setError("El archivo es demasiado grande (máximo 50MB)");
      setInputMode("idle");
      return;
    }

    try {
      // Get signed upload URL from server
      const uploadRes = await fetch("/api/objects/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!uploadRes.ok) {
        throw new Error("No se pudo obtener la URL de subida");
      }

      const { uploadURL, storagePath } = await uploadRes.json();

      // Upload file directly to storage
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      if (!putRes.ok) {
        throw new Error("Error al subir el archivo al almacenamiento");
      }

      // Register file in database
      const registerRes = await fetch("/api/files/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          storagePath,
        }),
      });

      if (!registerRes.ok) {
        throw new Error("Archivo subido pero no se pudo registrar");
      }

      setResponse(`Archivo subido: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

    } catch (err: any) {
      setError(err.message || "Error al subir el archivo");
    } finally {
      setInputMode("idle");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
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

  const handleMicToggle = () => {
    if (isListening) {
      stopListening();
    } else if (isSpeaking) {
      stopSpeaking();
    } else {
      startListening();
    }
  };

  const handleCameraToggle = () => {
    if (isCameraActive) {
      stopCamera();
    } else {
      startCamera();
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
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
          onChange={handleFileChange}
        />

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
          {isListening ? "Escuchando..." : isSpeaking ? "Hablando..." : isProcessing ? "Procesando..." : isCameraActive ? "Cámara activa" : "Modo conversación"}
        </motion.div>

        {/* Camera preview (when active) */}
        {isCameraActive && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute top-20 left-1/2 -translate-x-1/2 w-80 h-60 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl"
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-2 left-2 px-2 py-1 bg-red-500 rounded-full flex items-center gap-1">
              <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
              <span className="text-white text-xs font-medium">LIVE</span>
            </div>
          </motion.div>
        )}

        {/* Main animated bubble */}
        <motion.div
          className={cn(
            "relative flex items-center justify-center transition-[margin] duration-300",
            isCameraActive ? "mt-[160px]" : "mt-0"
          )}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          {/* Outer glow ring */}
          <motion.div
            className={cn(
              "absolute w-64 h-64 rounded-full",
              isListening ? "bg-blue-500/20" : isSpeaking ? "bg-green-500/20" : isCameraActive ? "bg-red-500/20" : "bg-white/10"
            )}
            animate={{
              scale: isListening || isSpeaking || isCameraActive ? [1, 1.2, 1] : 1,
              opacity: isListening || isSpeaking || isCameraActive ? [0.3, 0.5, 0.3] : 0.2,
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
              isListening ? "bg-blue-400/30" : isSpeaking ? "bg-green-400/30" : isCameraActive ? "bg-red-400/30" : "bg-white/15"
            )}
            animate={{
              scale: isListening ? [1, 1 + audioLevel * 0.3, 1] : isSpeaking || isCameraActive ? [1, 1.15, 1] : 1,
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

          {/* Main bubble - displays current state */}
          <motion.div
            className={cn(
              "relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300",
              isListening
                ? "bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/50"
                : isSpeaking
                  ? "bg-gradient-to-br from-green-500 to-green-600 shadow-lg shadow-green-500/50"
                  : isProcessing
                    ? "bg-gradient-to-br from-amber-500 to-amber-600 shadow-lg shadow-amber-500/50"
                    : isCameraActive
                      ? "bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/50"
                      : "bg-gradient-to-br from-gray-700 to-gray-800 shadow-lg shadow-black/50"
            )}
            style={{
              boxShadow: isListening
                ? `0 0 ${bubbleGlow}px rgba(59, 130, 246, 0.6)`
                : isSpeaking
                  ? `0 0 60px rgba(34, 197, 94, 0.5)`
                  : isCameraActive
                    ? `0 0 60px rgba(239, 68, 68, 0.5)`
                    : undefined,
            }}
            data-testid="voice-bubble-display"
          >
            {isProcessing ? (
              <Loader2 className="h-12 w-12 text-white animate-spin" />
            ) : isListening ? (
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              >
                <Mic className="h-12 w-12 text-white" />
              </motion.div>
            ) : isSpeaking ? (
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              >
                <Volume2 className="h-12 w-12 text-white" />
              </motion.div>
            ) : isCameraActive ? (
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                <Video className="h-12 w-12 text-white" />
              </motion.div>
            ) : (
              <div className="flex flex-col items-center">
                <span className="text-white/80 text-sm">IliaGPT</span>
              </div>
            )}
          </motion.div>

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
          className="absolute bottom-44 left-0 right-0 px-8 text-center"
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
          {(error || cameraError) && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-red-400 text-sm"
            >
              {error || cameraError}
            </motion.p>
          )}
        </motion.div>

        {/* Multimodal input buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="absolute bottom-16 flex items-center gap-6"
        >
          {/* Camera/Video button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <motion.button
                onClick={handleCameraToggle}
                disabled={isListening || isProcessing}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  "w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300",
                  "focus:outline-none focus:ring-4 focus:ring-white/20",
                  isCameraActive
                    ? "bg-red-500 text-white shadow-lg shadow-red-500/40"
                    : "bg-gray-800/80 text-white/80 hover:bg-gray-700 hover:text-white"
                )}
                data-testid="button-camera-input"
              >
                {isCameraActive ? <VideoOff className="h-7 w-7" /> : <Video className="h-7 w-7" />}
              </motion.button>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-gray-800 text-white border-gray-700">
              {isCameraActive ? "Detener cámara" : "Iniciar cámara"}
            </TooltipContent>
          </Tooltip>

          {/* Upload/Attach button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <motion.button
                onClick={handleFileUpload}
                disabled={isListening || isProcessing || isCameraActive}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  "w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300",
                  "focus:outline-none focus:ring-4 focus:ring-white/20",
                  inputMode === "uploading"
                    ? "bg-blue-500 text-white shadow-lg shadow-blue-500/40"
                    : "bg-gray-800/80 text-white/80 hover:bg-gray-700 hover:text-white"
                )}
                data-testid="button-upload-input"
              >
                {inputMode === "uploading" ? (
                  <Loader2 className="h-7 w-7 animate-spin" />
                ) : (
                  <Upload className="h-7 w-7" />
                )}
              </motion.button>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-gray-800 text-white border-gray-700">
              Adjuntar archivo
            </TooltipContent>
          </Tooltip>

          {/* Microphone button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <motion.button
                onClick={handleMicToggle}
                disabled={isProcessing || isCameraActive}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  "w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300",
                  "focus:outline-none focus:ring-4 focus:ring-white/20",
                  isListening
                    ? "bg-blue-500 text-white shadow-lg shadow-blue-500/40 animate-pulse"
                    : isSpeaking
                      ? "bg-green-500 text-white shadow-lg shadow-green-500/40"
                      : "bg-gray-800/80 text-white/80 hover:bg-gray-700 hover:text-white"
                )}
                data-testid="button-mic-input"
              >
                {isListening ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
              </motion.button>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-gray-800 text-white border-gray-700">
              {isListening ? "Detener grabación" : isSpeaking ? "Silenciar" : "Hablar"}
            </TooltipContent>
          </Tooltip>
        </motion.div>

        {/* Stop speaking button */}
        {isSpeaking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute bottom-4"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={stopSpeaking}
              className="text-white/70 hover:text-white hover:bg-white/10"
              data-testid="button-stop-speaking"
            >
              <VolumeX className="h-4 w-4 mr-2" />
              Silenciar
            </Button>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
