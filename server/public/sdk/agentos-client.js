/**
 * IliaGPT Web SDK v1.0.0
 * Drop-in integration for any website.
 * Usage:
 * <script src="/sdk/iliagpt-client.js"></script>
 * <script>
 *   const agent = new IliaGPTClient({ endpoint: '/api' });
 *   agent.chat("Hola, necesito ayuda").then(console.log);
 * </script>
 */

class IliaGPTClient {
  constructor(config = {}) {
    this.endpoint = config.endpoint || '/api';
    this.userId = config.userId || 'anonymous_' + Math.random().toString(36).substr(2, 9);
  }

  async getCapabilities() {
    const res = await fetch(`${this.endpoint}/agentos/capabilities`); // Endpoint interno se mantiene
    return await res.json();
  }

  async getStatus() {
    const res = await fetch(`${this.endpoint}/agentos/status`);
    return await res.json();
  }

  async chat(message, options = {}) {
    const res = await fetch(`${this.endpoint}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: message }],
        userId: this.userId,
        ...options
      })
    });
    return await res.json();
  }

  /**
   * Stream chat response with Server-Sent Events (SSE)
   * @param {string} message 
   * @param {function} onChunk - Callback(text)
   * @param {function} onDone - Callback()
   */
  streamChat(message, onChunk, onDone) {
    // ... implementation ...
    
    fetch(`${this.endpoint}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: [{ role: 'user', content: message }],
            userId: this.userId,
            stream: true
        })
    }).then(async response => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6);
                    if (dataStr === '[DONE]') {
                        if (onDone) onDone();
                        return;
                    }
                    try {
                        const data = JSON.parse(dataStr);
                        if (data.content && onChunk) onChunk(data.content);
                        // IliaGPT Branding in logs
                        if (data.type === 'tool_call' && onChunk) onChunk(`\n[IliaGPT Ejecutando: ${data.tool}]\n`);
                    } catch (e) {}
                }
            }
        }
        if (onDone) onDone();
    });
  }
}

// Expose globally
window.IliaGPTClient = IliaGPTClient;
// Alias for backward compatibility if needed
window.AgentOSClient = IliaGPTClient;
