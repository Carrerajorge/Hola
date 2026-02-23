import React, { useState, useEffect } from 'react';
import { BrainCircuit, Activity } from 'lucide-react';
import { Card } from '@/components/ui/card';

// Requires the Preload script exposing window.electron
declare global {
    interface Window {
        electron?: {
            ipcRenderer: {
                send(channel: string, ...args: any[]): void;
                on(channel: string, func: (...args: any[]) => void): void;
            };
        };
    }
}

export default function OverlayHUD() {
    const [agentState, setAgentState] = useState<'idle' | 'executing' | 'error'>('idle');
    const [recentAction, setRecentAction] = useState<string>('Awaiting Command');

    // Escuchar eventos desde el backend/Brain
    useEffect(() => {
        if (window.electron) {
            window.electron.ipcRenderer.on('agent-state-change', (_event, statePayload) => {
                setAgentState(statePayload.status);
                if (statePayload.action) {
                    setRecentAction(statePayload.action);
                }
            });
        }
    }, []);

    const handleMouseEnter = () => {
        if (window.electron) {
            // Desactiva el modo "click-through" de la ventana, permitiendo clics en la tarjeta
            window.electron.ipcRenderer.send('set-ignore-mouse-events', false);
        }
    };

    const handleMouseLeave = () => {
        if (window.electron) {
            // Reactiva el modo pass-through, los clics van al OS
            window.electron.ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
        }
    };

    return (
        <div className="w-screen h-screen overflow-hidden p-6 cursor-default pointer-events-none select-none">
            {/* The transparent full-screen wrapper has pointer-events-none so OS clicks pass naturally */}

            <div
                className="absolute bottom-6 right-6 flex flex-col gap-2 pointer-events-auto"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                <Card className="w-72 bg-black/80 backdrop-blur-md border border-slate-700/50 shadow-2xl rounded-2xl p-4 transition-all duration-300 hover:border-blue-500/50 hover:bg-black/90 cursor-default">
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-full ${agentState === 'executing' ? 'bg-blue-500/20 text-blue-400 animate-pulse' :
                                agentState === 'error' ? 'bg-red-500/20 text-red-400' :
                                    'bg-slate-800 text-slate-400'
                            }`}>
                            {agentState === 'executing' ? <Activity className="w-6 h-6" /> : <BrainCircuit className="w-6 h-6" />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-semibold text-white tracking-tight truncate">
                                {agentState === 'executing' ? 'Agent Active' : 'Agent Idle'}
                            </h3>
                            <p className="text-xs text-slate-400 truncate mt-0.5 font-mono">
                                {recentAction}
                            </p>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}
