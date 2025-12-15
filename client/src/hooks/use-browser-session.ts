import { useState, useEffect, useCallback, useRef } from "react";

export interface BrowserAction {
  type: string;
  params: Record<string, any>;
  timestamp: Date;
}

export interface BrowserEvent {
  type: "started" | "action" | "observation" | "error" | "completed" | "cancelled";
  sessionId: string;
  timestamp: Date;
  data: any;
}

export interface BrowserSessionState {
  sessionId: string | null;
  status: "idle" | "connecting" | "active" | "completed" | "error" | "cancelled";
  objective: string;
  currentUrl: string;
  currentTitle: string;
  screenshot: string | null;
  actions: BrowserAction[];
  events: BrowserEvent[];
  error: string | null;
}

const initialState: BrowserSessionState = {
  sessionId: null,
  status: "idle",
  objective: "",
  currentUrl: "",
  currentTitle: "",
  screenshot: null,
  actions: [],
  events: [],
  error: null,
};

export function useBrowserSession() {
  const [state, setState] = useState<BrowserSessionState>(initialState);
  const wsRef = useRef<WebSocket | null>(null);

  const subscribeToSession = useCallback((sessionId: string, objective: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    setState({
      ...initialState,
      sessionId,
      status: "connecting",
      objective,
    });

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/browser`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", sessionId }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === "subscribed") {
          setState(prev => ({ ...prev, status: "active" }));
        } else if (data.messageType === "browser_event") {
          const eventType = data.eventType as BrowserEvent["type"];
          const browserEvent: BrowserEvent = {
            type: eventType,
            sessionId: data.sessionId,
            timestamp: new Date(data.timestamp),
            data: data.data,
          };

          setState(prev => {
            const newState = { ...prev, events: [...prev.events, browserEvent] };

            if (browserEvent.data?.screenshot) {
              newState.screenshot = browserEvent.data.screenshot;
            }

            if (browserEvent.data?.url) {
              newState.currentUrl = browserEvent.data.url;
            }

            if (browserEvent.data?.title) {
              newState.currentTitle = browserEvent.data.title;
            }

            if (browserEvent.data?.action) {
              newState.actions = [...prev.actions, {
                type: browserEvent.data.action,
                params: browserEvent.data,
                timestamp: browserEvent.timestamp,
              }];
            }

            if (eventType === "completed") {
              newState.status = "completed";
            } else if (eventType === "error") {
              newState.status = "error";
              newState.error = browserEvent.data?.error || "Unknown error";
            } else if (eventType === "cancelled") {
              newState.status = "cancelled";
            }

            return newState;
          });
        }
      } catch (e) {
        console.error("Error parsing browser event:", e);
      }
    };

    ws.onerror = (error) => {
      console.error("Browser WebSocket error:", error);
      setState(prev => ({ ...prev, status: "error", error: "WebSocket connection error" }));
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
  }, []);

  const createSession = useCallback(async (objective: string, config?: any) => {
    try {
      setState(prev => ({ ...prev, status: "connecting", objective }));
      
      const response = await fetch("/api/browser/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective, config }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create session");
      }
      
      const { sessionId } = await response.json();
      subscribeToSession(sessionId, objective);
      
      return sessionId;
    } catch (error: any) {
      setState(prev => ({ ...prev, status: "error", error: error.message }));
      throw error;
    }
  }, [subscribeToSession]);

  const navigate = useCallback(async (url: string) => {
    if (!state.sessionId) return null;
    
    try {
      const response = await fetch(`/api/browser/session/${state.sessionId}/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      return await response.json();
    } catch (error) {
      console.error("Navigate error:", error);
      return null;
    }
  }, [state.sessionId]);

  const click = useCallback(async (selector: string) => {
    if (!state.sessionId) return null;
    
    try {
      const response = await fetch(`/api/browser/session/${state.sessionId}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selector }),
      });
      return await response.json();
    } catch (error) {
      console.error("Click error:", error);
      return null;
    }
  }, [state.sessionId]);

  const type = useCallback(async (selector: string, text: string) => {
    if (!state.sessionId) return null;
    
    try {
      const response = await fetch(`/api/browser/session/${state.sessionId}/type`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selector, text }),
      });
      return await response.json();
    } catch (error) {
      console.error("Type error:", error);
      return null;
    }
  }, [state.sessionId]);

  const scroll = useCallback(async (direction: "up" | "down", amount?: number) => {
    if (!state.sessionId) return null;
    
    try {
      const response = await fetch(`/api/browser/session/${state.sessionId}/scroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, amount }),
      });
      return await response.json();
    } catch (error) {
      console.error("Scroll error:", error);
      return null;
    }
  }, [state.sessionId]);

  const getPageState = useCallback(async () => {
    if (!state.sessionId) return null;
    
    try {
      const response = await fetch(`/api/browser/session/${state.sessionId}/state`);
      return await response.json();
    } catch (error) {
      console.error("Get state error:", error);
      return null;
    }
  }, [state.sessionId]);

  const cancel = useCallback(async () => {
    if (!state.sessionId) return;
    
    try {
      await fetch(`/api/browser/session/${state.sessionId}/cancel`, { method: "POST" });
      setState(prev => ({ ...prev, status: "cancelled" }));
    } catch (error) {
      console.error("Cancel error:", error);
    }
  }, [state.sessionId]);

  const close = useCallback(async () => {
    if (!state.sessionId) return;
    
    try {
      await fetch(`/api/browser/session/${state.sessionId}`, { method: "DELETE" });
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setState(initialState);
    } catch (error) {
      console.error("Close error:", error);
    }
  }, [state.sessionId]);

  const reset = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState(initialState);
  }, []);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    state,
    createSession,
    subscribeToSession,
    navigate,
    click,
    type,
    scroll,
    getPageState,
    cancel,
    close,
    reset,
  };
}
