import { broadcastToSubscribed } from '../gateway/wsServer';

export type PreviewMode = 'off' | 'partial' | 'block' | 'progress';

export class PreviewStream {
  private mode: PreviewMode;
  private runId: string;
  private accumulated = '';

  constructor(runId: string, mode: PreviewMode) {
    this.runId = runId;
    this.mode = mode;
  }

  push(delta: string): void {
    if (this.mode === 'off') return;

    this.accumulated += delta;

    if (this.mode === 'partial') {
      // Send full accumulated text (client replaces content)
      broadcastToSubscribed('chat.preview', {
        runId: this.runId,
        mode: 'replace',
        content: this.accumulated,
      });
    } else if (this.mode === 'block') {
      // Send only the delta (client appends)
      broadcastToSubscribed('chat.preview', {
        runId: this.runId,
        mode: 'append',
        content: delta,
      });
    } else if (this.mode === 'progress') {
      // Send progress indicator
      broadcastToSubscribed('chat.preview', {
        runId: this.runId,
        mode: 'progress',
        chars: this.accumulated.length,
      });
    }
  }

  end(): void {
    if (this.mode === 'off') return;
    broadcastToSubscribed('chat.preview', {
      runId: this.runId,
      mode: 'done',
      content: this.accumulated,
    });
  }

  get totalChars(): number {
    return this.accumulated.length;
  }
}
