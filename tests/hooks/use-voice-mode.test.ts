import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { useVoiceMode } from '@/hooks/use-voice-mode';

// Mock Web Speech API
const mockSpeechRecognition = {
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    lang: '',
    continuous: false,
    interimResults: false,
    onresult: null,
    onstart: null,
    onend: null,
    onerror: null,
};

const mockSpeechSynthesis = {
    speak: vi.fn(),
    cancel: vi.fn(),
    getVoices: vi.fn().mockReturnValue([]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
};

// Global mocks
// Global mocks
global.SpeechRecognition = class {
    constructor() {
        return mockSpeechRecognition;
    }
} as any;
global.webkitSpeechRecognition = global.SpeechRecognition;
global.speechSynthesis = mockSpeechSynthesis as any;
global.SpeechSynthesisUtterance = vi.fn() as any;

describe('useVoiceMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        Object.defineProperty(window, 'SpeechRecognition', {
            writable: true,
            value: global.SpeechRecognition,
        });
        Object.defineProperty(window, 'webkitSpeechRecognition', {
            writable: true,
            value: global.SpeechRecognition,
        });
        Object.defineProperty(window, 'speechSynthesis', {
            writable: true,
            value: global.speechSynthesis,
        });
    });

    afterEach(() => {
        // Cleanup if needed, but JSDOM resets usually handle this or we overwrite next time
        vi.resetAllMocks();
    });

    it('should initialize with default state', () => {
        const { result } = renderHook(() => useVoiceMode());
        expect(result.current.isListening).toBe(false);
        expect(result.current.isSpeaking).toBe(false);
        expect(result.current.transcript).toBe('');
    });

    it('should start listening when startListening is called', () => {
        const { result } = renderHook(() => useVoiceMode());

        act(() => {
            result.current.startListening();
        });

        expect(mockSpeechRecognition.start).toHaveBeenCalled();
        expect(result.current.isListening).toBe(true);
        expect(result.current.error).toBeNull();
    });

    it('should stop listening when stopListening is called', () => {
        const { result } = renderHook(() => useVoiceMode());

        act(() => {
            result.current.startListening();
        });

        act(() => {
            result.current.stopListening();
        });

        expect(mockSpeechRecognition.stop).toHaveBeenCalled();
        expect(result.current.isListening).toBe(false);
    });

    it('should cancel speech synthesis when stopSpeaking is called', () => {
        const { result } = renderHook(() => useVoiceMode());

        act(() => {
            result.current.speak('Hello');
        });

        act(() => {
            result.current.stopSpeaking();
        });

        expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
        expect(result.current.isSpeaking).toBe(false);
    });

    it('should interrupt speaking when startListening is called (Interruptibility)', () => {
        // This tests the desired behavior: if I start listening (e.g. user interrupts), speech should stop.
        // Currently relying on implementation detail that startListening doesn't call stopSpeaking explicitly?
        // Let's verify if our hook handles this or if we need to add it.

        const { result } = renderHook(() => useVoiceMode());

        act(() => {
            result.current.speak('Long text...');
        });

        // Simulate speaking state
        // (mock doesn't update state automatically, testing logic flow)

        act(() => {
            // If the user presses the mic button to interrupt
            result.current.startListening();
        });

        // We want to ensure cancel is called when starting to listen
        expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    });
});
