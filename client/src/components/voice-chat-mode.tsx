import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, Loader2, Mic, MicOff, Upload, Video, VideoOff, Volume2, VolumeX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { apiFetch } from "@/lib/apiClient";
import { cn } from "@/lib/utils";

interface VoiceChatModeProps {
  open: boolean;
  onClose: () => void;
  model?: string;
}

type InputMode = "idle" | "mic" | "camera" | "uploading";
type VoiceRole = "user" | "assistant";

type VoiceMessage = {
  role: VoiceRole;
  content: string;
};

type VoiceAttachment = {
  name: string;
  type: string;
  mimeType: string;
  size: number;
  storagePath: string;
  fileId?: string;
};

const MAX_CONVERSATION_MESSAGES = 20;
const MAX_RECORDING_MS = 15000;
const SILENCE_THRESHOLD = 0.02;
const SILENCE_HOLD_MS = 900;
const MIN_AUDIO_BYTES = 1600;

function getSpeechRecognitionCtor(): any | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function normalizeMediaError(err: any): string {
  const name = String(err?.name || "");
  const message = String(err?.message || "");

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Permiso denegado. Habilita el micrófono/cámara en tu navegador e intenta de nuevo.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No se encontró un dispositivo de micrófono/cámara.";
  }
  if (name === "NotReadableError") {
    return "No se pudo acceder al dispositivo. Puede estar en uso por otra app.";
  }

  return message || "No se pudo acceder al dispositivo.";
}

function clampText(input: string, maxLen: number): string {
  const t = String(input || "");
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen);
}

export function VoiceChatMode({ open, onClose, model }: VoiceChatModeProps) {
  const [inputMode, setInputMode] = useState<InputMode>("idle");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [conversation, setConversation] = useState<VoiceMessage[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<VoiceAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const { settings } = useSettingsContext();

  const speechLocale = useMemo(() => {
    const code = settings.spokenLanguage;
    if (!code || code === "auto") return navigator.language || "es-ES";
    if (code === "es") return "es-ES";
    if (code === "en") return "en-US";
    if (code === "fr") return "fr-FR";
    if (code === "de") return "de-DE";
    if (code === "pt") return "pt-PT";
    return navigator.language || "es-ES";
  }, [settings.spokenLanguage]);

  const supportsSpeechRecognition = useMemo(() => !!getSpeechRecognitionCtor(), []);

  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const interimTranscriptRef = useRef<string>("");

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const speechSynthesisRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speakingCountRef = useRef<number>(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number>(0);
  const silenceStartedAtRef = useRef<number | null>(null);
  const discardRecordingRef = useRef<boolean>(false);
  const isListeningRef = useRef<boolean>(false);

  const streamAbortRef = useRef<AbortController | null>(null);
  const fullResponseRef = useRef<string>("");
  const spokenCursorRef = useRef<number>(0);

  const conversationRef = useRef<VoiceMessage[]>([]);
  const attachedFilesRef = useRef<VoiceAttachment[]>([]);

  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  useEffect(() => {
    attachedFilesRef.current = attachedFiles;
  }, [attachedFiles]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    const synth = window.speechSynthesis;
    const load = () => {
      voicesRef.current = synth.getVoices();
    };

    load();
    synth.addEventListener("voiceschanged", load);
    return () => {
      synth.removeEventListener("voiceschanged", load);
    };
  }, []);

  const cleanupAudio = () => {
    if (animationFrameRef.current != null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        // ignore
      }
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        void audioContextRef.current.close();
      } catch {
        // ignore
      }
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
      mediaStreamRef.current = null;
    }
  };

  const startAudioMeter = async (): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    mediaStreamRef.current = stream;

    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextCtor();
    audioContextRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);

    const tick = () => {
      const a = analyserRef.current;
      if (!a) return;

      a.getByteTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / data.length);
      setAudioLevel(rms);

      const rec = mediaRecorderRef.current;
      if (rec && rec.state === "recording") {
        const now = performance.now();
        const elapsed = now - recordingStartedAtRef.current;
        if (elapsed > MAX_RECORDING_MS) {
          stopListening();
          return;
        }

        if (rms < SILENCE_THRESHOLD) {
          if (silenceStartedAtRef.current == null) {
            silenceStartedAtRef.current = now;
          } else if (now - silenceStartedAtRef.current > SILENCE_HOLD_MS) {
            stopListening();
            return;
          }
        } else {
          silenceStartedAtRef.current = null;
        }
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    tick();
    return stream;
  };

  const abortStreaming = () => {
    if (streamAbortRef.current) {
      try {
        streamAbortRef.current.abort();
      } catch {
        // ignore
      }
      streamAbortRef.current = null;
    }
  };

  const stopSpeaking = () => {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
    speakingCountRef.current = 0;
    setIsSpeaking(false);
  };

  const pickSynthesisVoice = (): SpeechSynthesisVoice | undefined => {
    const desiredLang = speechLocale.slice(0, 2).toLowerCase();
    const voices = voicesRef.current || [];
    const byLang = voices.filter((v) => String(v.lang || "").toLowerCase().startsWith(desiredLang));
    return byLang[0] || voices[0];
  };

  const speakText = (text: string, opts?: { interrupt?: boolean }) => {
    const t = String(text || "").trim();
    if (!t) return;

    if (opts?.interrupt) {
      stopSpeaking();
    }

    const utterance = new SpeechSynthesisUtterance(t);
    utterance.lang = speechLocale;
    utterance.rate = typeof settings.voiceSpeed === "number" ? settings.voiceSpeed : 1;
    utterance.volume = typeof settings.voiceVolume === "number" ? settings.voiceVolume : 1;
    utterance.pitch = 1;

    const voice = pickSynthesisVoice();
    if (voice) utterance.voice = voice;

    utterance.onstart = () => {
      speakingCountRef.current += 1;
      setIsSpeaking(true);
    };
    utterance.onend = () => {
      speakingCountRef.current = Math.max(0, speakingCountRef.current - 1);
      if (speakingCountRef.current === 0) setIsSpeaking(false);
    };
    utterance.onerror = () => {
      speakingCountRef.current = Math.max(0, speakingCountRef.current - 1);
      if (speakingCountRef.current === 0) setIsSpeaking(false);
    };

    speechSynthesisRef.current = utterance;
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      // ignore
    }
  };

  const maybeSpeakStreamIncremental = (forceFlush: boolean) => {
    if (isListeningRef.current) return;
    if (!fullResponseRef.current) return;

    const full = fullResponseRef.current;
    const cursor = spokenCursorRef.current;
    if (cursor >= full.length) return;

    const remaining = full.slice(cursor);
    if (!forceFlush && remaining.length < 48) return;

    const boundaryChars = [".", "!", "?", "\n", "。", "！", "？"];
    let boundaryIdx = -1;
    for (const ch of boundaryChars) {
      boundaryIdx = Math.max(boundaryIdx, remaining.lastIndexOf(ch));
    }

    if (boundaryIdx < 0 && !forceFlush) return;
    const take = boundaryIdx >= 0 ? boundaryIdx + 1 : remaining.length;

    const segment = remaining.slice(0, take).trim();
    spokenCursorRef.current = cursor + take;

    if (segment) {
      speakText(segment, { interrupt: false });
    }
  };

  const readSseStream = async (res: Response, onEvent: (event: string, data: any) => void) => {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let sepIdx = buffer.indexOf("\n\n");
      while (sepIdx >= 0) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);

        const lines = rawEvent.split("\n").map((l) => l.trimEnd()).filter(Boolean);
        let eventType = "message";
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith(":")) continue;
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim() || "message";
            continue;
          }
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        const dataStr = dataLines.join("\n");
        let data: any = null;
        try {
          data = dataStr ? JSON.parse(dataStr) : null;
        } catch {
          data = dataStr;
        }

        onEvent(eventType, data);

        sepIdx = buffer.indexOf("\n\n");
      }
    }
  };

  const sendToAssistant = async (text: string) => {
    const trimmed = String(text || "").trim();
    if (!trimmed) return;

    setError(null);
    setIsProcessing(true);
    setResponse("");
    fullResponseRef.current = "";
    spokenCursorRef.current = 0;

    abortStreaming();
    stopSpeaking();

    const userMsg: VoiceMessage = { role: "user", content: trimmed };
    const base = conversationRef.current;
    const nextConversation = [...base, userMsg].slice(-MAX_CONVERSATION_MESSAGES);
    setConversation(nextConversation);
    conversationRef.current = nextConversation;

    const attachments = attachedFilesRef.current;
    const hasImage = attachments.some((a) => String(a.mimeType || a.type).toLowerCase().startsWith("image/"));

    const payload = {
      messages: nextConversation,
      attachments,
      model,
      temperature: 0.7,
      maxTokens: 220,
      spokenLanguage: settings.spokenLanguage,
    };

    try {
      if (hasImage) {
        const res = await apiFetch("/api/voice-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || err?.message || "Error al comunicarse con el servidor");
        }

        const data = await res.json();
        const aiText = String(data.response || "").trim();

        setResponse(aiText);
        fullResponseRef.current = aiText;
        spokenCursorRef.current = aiText.length;

        if (aiText) {
          const assistantMsg: VoiceMessage = { role: "assistant", content: aiText };
          const updated = [...nextConversation, assistantMsg].slice(-MAX_CONVERSATION_MESSAGES);
          setConversation(updated);
          conversationRef.current = updated;
          speakText(aiText, { interrupt: true });
        }

        return;
      }

      const controller = new AbortController();
      streamAbortRef.current = controller;

      const res = await apiFetch("/api/voice-chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || err?.message || "Error al comunicarse con el servidor");
      }

      let streamComplete = false;

      await readSseStream(res, (eventType, data) => {
        if (eventType === "chunk") {
          const content = String(data?.content || "");
          if (content) {
            fullResponseRef.current += content;
            setResponse(fullResponseRef.current);
            maybeSpeakStreamIncremental(false);
          }
        } else if (eventType === "complete") {
          streamComplete = true;
        } else if (eventType === "error") {
          const msg = String(data?.message || data?.error || "Stream error");
          throw new Error(msg);
        }
      });

      if (!streamComplete) {
        // transport ended without complete; still flush what we have
      }

      maybeSpeakStreamIncremental(true);

      const aiText = fullResponseRef.current.trim();
      if (aiText) {
        const assistantMsg: VoiceMessage = { role: "assistant", content: aiText };
        const updated = [...nextConversation, assistantMsg].slice(-MAX_CONVERSATION_MESSAGES);
        setConversation(updated);
        conversationRef.current = updated;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("Error sending to voice chat:", err);
      setError(err?.message || "Error al procesar tu mensaje");
    } finally {
      setIsProcessing(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
      setIsListening(false);
      cleanupAudio();
      setAudioLevel(0);
      setInputMode("idle");
      return;
    }

    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        mediaRecorderRef.current = null;
        setIsListening(false);
        cleanupAudio();
        setAudioLevel(0);
        setInputMode("idle");
      }
      return;
    }

    setIsListening(false);
    cleanupAudio();
    setAudioLevel(0);
    setInputMode("idle");
  };

  const startSpeechRecognitionListening = async () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Tu navegador no soporta reconocimiento de voz.");
      return;
    }

    discardRecordingRef.current = false;
    setError(null);
    setTranscript("");
    transcriptRef.current = "";
    interimTranscriptRef.current = "";
    setInputMode("mic");

    stopSpeaking();
    abortStreaming();

    try {
      await startAudioMeter();
    } catch (e: any) {
      setError(normalizeMediaError(e));
      setInputMode("idle");
      return;
    }

    const recognition = new Ctor();
    recognition.lang = speechLocale;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let finalText = transcriptRef.current;
      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const t = String(r?.[0]?.transcript || "");
        if (r.isFinal) finalText += t;
        else interim += t;
      }

      finalText = finalText.trim();
      interim = interim.trim();

      transcriptRef.current = finalText;
      interimTranscriptRef.current = interim;
      setTranscript((finalText || interim).trim());
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event?.error);
      setIsListening(false);
      cleanupAudio();
      setAudioLevel(0);
      setInputMode("idle");

      const errCode = String(event?.error || "");
      if (errCode && errCode !== "no-speech") {
        setError(`Error: ${errCode}`);
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
      cleanupAudio();
      setAudioLevel(0);
      setInputMode("idle");

      if (discardRecordingRef.current) return;

      const text = (transcriptRef.current || interimTranscriptRef.current).trim();
      if (!text) return;

      setTranscript(text);
      transcriptRef.current = text;
      void sendToAssistant(text);
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const transcribeBlob = async (blob: Blob): Promise<string> => {
    const fd = new FormData();
    const file = new File([blob], "audio.webm", { type: blob.type || "audio/webm" });
    fd.append("audio", file);
    fd.append("spokenLanguage", settings.spokenLanguage || "auto");

    const res = await apiFetch("/api/voice/transcribe", { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 501) {
        throw new Error(err?.error || "Transcripción avanzada no disponible en el servidor.");
      }
      throw new Error(err?.error || err?.message || "Error al transcribir audio");
    }

    const data = await res.json().catch(() => ({}));
    return String(data?.text || "");
  };

  const startRecorderListening = async () => {
    const MediaRecorderCtor = (window as any).MediaRecorder;
    if (!MediaRecorderCtor) {
      setError("Tu navegador no soporta grabación de audio.");
      return;
    }

    discardRecordingRef.current = false;
    silenceStartedAtRef.current = null;
    setError(null);
    setTranscript("");
    transcriptRef.current = "";
    interimTranscriptRef.current = "";
    setInputMode("mic");

    stopSpeaking();
    abortStreaming();

    let stream: MediaStream;
    try {
      stream = await startAudioMeter();
    } catch (e: any) {
      setError(normalizeMediaError(e));
      setInputMode("idle");
      return;
    }

    const pickMimeType = (): string | undefined => {
      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      for (const mt of candidates) {
        if (typeof (window as any).MediaRecorder?.isTypeSupported === "function") {
          if ((window as any).MediaRecorder.isTypeSupported(mt)) return mt;
        }
      }
      return undefined;
    };

    const mimeType = pickMimeType();
    const recorder: MediaRecorder = mimeType ? new MediaRecorderCtor(stream, { mimeType }) : new MediaRecorderCtor(stream);
    mediaRecorderRef.current = recorder;
    audioChunksRef.current = [];
    recordingStartedAtRef.current = performance.now();

    recorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) audioChunksRef.current.push(ev.data);
    };

    recorder.onerror = (ev: any) => {
      console.error("[VoiceRecorder] Error:", ev?.error || ev);
      setError("Error al grabar audio.");
    };

    recorder.onstop = async () => {
      mediaRecorderRef.current = null;
      setIsListening(false);
      cleanupAudio();
      setAudioLevel(0);
      setInputMode("idle");

      if (discardRecordingRef.current) return;

      const blob = new Blob(audioChunksRef.current, { type: mimeType || "audio/webm" });
      if (blob.size < MIN_AUDIO_BYTES) return;

      try {
        const text = (await transcribeBlob(blob)).trim();
        if (!text) return;

        const normalized = clampText(text, 600);
        setTranscript(normalized);
        transcriptRef.current = normalized;
        await sendToAssistant(normalized);
      } catch (e: any) {
        console.error("[VoiceRecorder] Transcribe failed:", e);

        if (supportsSpeechRecognition) {
          setError(`${e?.message || "Error al transcribir audio"} (Activa reconocimiento de voz del navegador o configura OPENAI_API_KEY)`);
        } else {
          setError(e?.message || "Error al transcribir audio");
        }
      }
    };

    recorder.start(250);
    setIsListening(true);
  };

  const startListening = () => {
    const shouldUseRecorder = settings.advancedVoice || !supportsSpeechRecognition;
    void (shouldUseRecorder ? startRecorderListening() : startSpeechRecognitionListening());
  };

  const startCamera = async () => {
    try {
      setCameraError(null);
      setInputMode("camera");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      videoStreamRef.current = stream;
      setIsCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error("Error accessing camera:", err);
      setCameraError(normalizeMediaError(err));
      setInputMode("idle");
    }
  };

  const stopCamera = () => {
    if (videoStreamRef.current) {
      try {
        videoStreamRef.current.getTracks().forEach((track) => track.stop());
      } catch {
        // ignore
      }
      videoStreamRef.current = null;
    }
    setIsCameraActive(false);
    setInputMode("idle");
  };

  const uploadAndAttachFile = async (file: File) => {
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new Error("El archivo es demasiado grande (máximo 50MB)");
    }

    const urlRes = await apiFetch("/api/objects/upload", { method: "POST" });
    const urlData = await urlRes.json().catch(() => ({}));
    if (!urlRes.ok) {
      throw new Error(urlData?.error || "No se pudo obtener la URL de subida");
    }

    const uploadURL = String(urlData?.uploadURL || "");
    const storagePath = String(urlData?.storagePath || "");
    if (!uploadURL || !storagePath) {
      throw new Error("No se recibió URL de subida");
    }

    const putRes = await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!putRes.ok) throw new Error("Error al subir el archivo al almacenamiento");

    const registerRes = await apiFetch("/api/files/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        storagePath,
      }),
    });
    const registered = await registerRes.json().catch(() => ({}));
    if (!registerRes.ok) throw new Error(registered?.error || "Archivo subido pero no se pudo registrar");

    const isImage = String(file.type || "").toLowerCase().startsWith("image/");
    const att: VoiceAttachment = {
      name: String(registered?.name || file.name),
      type: isImage ? "image" : "file",
      mimeType: String(registered?.type || file.type || "application/octet-stream"),
      size: Number(registered?.size || file.size),
      storagePath: String(registered?.storagePath || storagePath),
      fileId: registered?.id ? String(registered.id) : undefined,
    };

    setAttachedFiles((prev) => [...prev, att]);
  };

  const handleCapturePhoto = async () => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const w = video.videoWidth;
    const h = video.videoHeight;

    if (!w || !h) {
      setCameraError("La cámara aún no está lista. Intenta de nuevo.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("No se pudo capturar la imagen");
      return;
    }

    ctx.drawImage(video, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
      setCameraError("No se pudo capturar la imagen");
      return;
    }

    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });

    setInputMode("uploading");
    setError(null);
    setCameraError(null);

    try {
      await uploadAndAttachFile(file);
    } catch (e: any) {
      setError(e?.message || "Error al subir la foto");
    } finally {
      setInputMode("idle");
    }
  };

  const handleFileUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setInputMode("uploading");
    setError(null);

    try {
      await uploadAndAttachFile(files[0]);
    } catch (err: any) {
      setError(err?.message || "Error al subir el archivo");
    } finally {
      setInputMode("idle");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMicToggle = () => {
    if (isListening) {
      stopListening();
      return;
    }

    if (isSpeaking) {
      stopSpeaking();
    }

    if (isProcessing) {
      abortStreaming();
      setIsProcessing(false);
    }

    startListening();
  };

  const handleCameraToggle = () => {
    if (isCameraActive) {
      stopCamera();
    } else {
      void startCamera();
    }
  };

  useEffect(() => {
    if (!open) {
      discardRecordingRef.current = true;
      abortStreaming();
      stopListening();
      stopSpeaking();
      stopCamera();
      cleanupAudio();

      setTranscript("");
      transcriptRef.current = "";
      interimTranscriptRef.current = "";
      setResponse("");
      setConversation([]);
      conversationRef.current = [];
      setAttachedFiles([]);
      attachedFilesRef.current = [];

      setError(null);
      setCameraError(null);
      setAudioLevel(0);
      setIsProcessing(false);
      setInputMode("idle");
    }

    return () => {
      discardRecordingRef.current = true;
      abortStreaming();
      stopListening();
      stopSpeaking();
      stopCamera();
      cleanupAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const bubbleScale = 1 + audioLevel * 0.5;
  const bubbleGlow = audioLevel * 100;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-gradient-to-br from-gray-900 via-black to-gray-900 flex flex-col items-center justify-center"
          data-testid="voice-chat-mode"
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json"
            onChange={handleFileChange}
            aria-label="File upload"
          />

          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="absolute top-6 right-6 h-12 w-12 rounded-full text-white/70 hover:text-white hover:bg-white/10"
            data-testid="button-close-voice-chat"
          >
            <X className="h-6 w-6" />
          </Button>

          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-8 left-1/2 -translate-x-1/2 text-white/80 text-lg font-medium"
          >
            {isListening
              ? "Escuchando..."
              : isSpeaking
                ? "Hablando..."
                : isProcessing
                  ? "Procesando..."
                  : isCameraActive
                    ? "Cámara activa"
                    : "Modo conversación"}
          </motion.div>

          {isCameraActive && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute top-20 left-1/2 -translate-x-1/2 w-80 h-60 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl"
            >
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <div className="absolute bottom-2 left-2 px-2 py-1 bg-red-500 rounded-full flex items-center gap-1">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                <span className="text-white text-xs font-medium">LIVE</span>
              </div>
            </motion.div>
          )}

          <motion.div
            className={cn("relative flex items-center justify-center transition-[margin] duration-300", isCameraActive ? "mt-[160px]" : "mt-0")}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
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

            <motion.button
              type="button"
              onClick={handleMicToggle}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleMicToggle();
                }
              }}
              disabled={isCameraActive}
              className={cn(
                "relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300",
                "focus:outline-none focus:ring-4 focus:ring-white/20",
                isListening
                  ? "bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/50"
                  : isSpeaking
                    ? "bg-gradient-to-br from-green-500 to-green-600 shadow-lg shadow-green-500/50"
                    : isProcessing
                      ? "bg-gradient-to-br from-amber-500 to-amber-600 shadow-lg shadow-amber-500/50"
                      : isCameraActive
                        ? "bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/50"
                        : "bg-gradient-to-br from-gray-700 to-gray-800 shadow-lg shadow-black/50 hover:from-gray-600 hover:to-gray-700"
              )}
              style={{
                boxShadow: isListening
                  ? `0 0 ${bubbleGlow}px rgba(59, 130, 246, 0.6)`
                  : isSpeaking
                    ? "0 0 60px rgba(34, 197, 94, 0.5)"
                    : isCameraActive
                      ? "0 0 60px rgba(239, 68, 68, 0.5)"
                      : undefined,
              }}
              aria-label={isListening ? "Detener y enviar" : isSpeaking || isProcessing ? "Interrumpir y hablar" : "Hablar"}
              data-testid="voice-bubble-display"
            >
              {isProcessing ? (
                <Loader2 className="h-12 w-12 text-white animate-spin" />
              ) : isListening ? (
                <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 0.5, repeat: Infinity }}>
                  <Mic className="h-12 w-12 text-white" />
                </motion.div>
              ) : isSpeaking ? (
                <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 0.5, repeat: Infinity }}>
                  <Volume2 className="h-12 w-12 text-white" />
                </motion.div>
              ) : isCameraActive ? (
                <motion.div animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                  <Video className="h-12 w-12 text-white" />
                </motion.div>
              ) : (
                <div className="flex flex-col items-center">
                  <span className="text-white/80 text-sm">IliaGPT</span>
                  <span className="text-white/50 text-[11px] mt-0.5">Toca para hablar</span>
                </div>
              )}
            </motion.button>

            {isListening && (
              <>
                {[...Array(3)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute rounded-full border-2 border-blue-400/30"
                    style={{
                      width: 140 + i * 40 + audioLevel * 80,
                      height: 140 + i * 40 + audioLevel * 80,
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

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute bottom-44 left-0 right-0 px-8 text-center">
            {attachedFiles.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap justify-center gap-2 mb-4">
                {attachedFiles.map((f, idx) => (
                  <span
                    key={`${f.storagePath}-${idx}`}
                    className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-white/80 text-xs border border-white/10"
                  >
                    <span className="max-w-[220px] truncate" title={f.name}>
                      {f.name}
                    </span>
                    <button type="button" onClick={() => removeAttachment(idx)} className="text-white/60 hover:text-white" aria-label="Quitar adjunto">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </motion.div>
            )}

            {transcript && (
              <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-white/90 text-xl mb-4 max-w-lg mx-auto">
                "{transcript}"
              </motion.p>
            )}

            {response && !isListening && (
              <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-white/70 text-lg max-w-lg mx-auto line-clamp-3">
                {response}
              </motion.p>
            )}

            {(error || cameraError) && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-sm">
                {error || cameraError}
              </motion.p>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="absolute bottom-16 flex items-center gap-6"
          >
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
                    isCameraActive ? "bg-red-500 text-white shadow-lg shadow-red-500/40" : "bg-gray-800/80 text-white/80 hover:bg-gray-700 hover:text-white"
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

            {isCameraActive && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <motion.button
                    onClick={handleCapturePhoto}
                    disabled={inputMode === "uploading" || isListening || isProcessing}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={cn(
                      "w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300",
                      "focus:outline-none focus:ring-4 focus:ring-white/20",
                      inputMode === "uploading"
                        ? "bg-blue-500 text-white shadow-lg shadow-blue-500/40"
                        : "bg-gray-800/80 text-white/80 hover:bg-gray-700 hover:text-white"
                    )}
                    aria-label="Capturar foto"
                  >
                    {inputMode === "uploading" ? <Loader2 className="h-7 w-7 animate-spin" /> : <Camera className="h-7 w-7" />}
                  </motion.button>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-gray-800 text-white border-gray-700">
                  Capturar foto
                </TooltipContent>
              </Tooltip>
            )}

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
                  {inputMode === "uploading" ? <Loader2 className="h-7 w-7 animate-spin" /> : <Upload className="h-7 w-7" />}
                </motion.button>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-gray-800 text-white border-gray-700">
                Adjuntar archivo
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <motion.button
                  onClick={handleMicToggle}
                  disabled={isCameraActive}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={cn(
                    "w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300",
                    "focus:outline-none focus:ring-4 focus:ring-white/20",
                    isListening
                      ? "bg-blue-500 text-white shadow-lg shadow-blue-500/40 animate-pulse"
                      : isSpeaking || isProcessing
                        ? "bg-green-500 text-white shadow-lg shadow-green-500/40"
                        : "bg-gray-800/80 text-white/80 hover:bg-gray-700 hover:text-white"
                  )}
                  data-testid="button-mic-input"
                >
                  {isListening ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
                </motion.button>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-gray-800 text-white border-gray-700">
                {isListening ? "Detener y enviar" : isSpeaking || isProcessing ? "Interrumpir y hablar" : "Hablar"}
              </TooltipContent>
            </Tooltip>
          </motion.div>

          {isSpeaking && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute bottom-4">
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
      )}
    </AnimatePresence>
  );
}
