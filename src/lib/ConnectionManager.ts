import type { Message, MessageType } from './types';

export class ConnectionManager {
  private port: chrome.runtime.Port | null = null;
  private messageQueue: Array<Message> = [];
  private retryCount = 0;
  private readonly MAX_RETRIES = 5;
  private readonly RETRY_DELAY = 2000; // 2 seconds base delay
  private connectionListeners: Set<(connected: boolean) => void> = new Set();
  private messageListeners: Set<(message: Message) => void> = new Set();

  constructor(private portName: string) {}

  async connect(): Promise<boolean> {
    try {
      if (!chrome.runtime?.id) {
        throw new Error('Chrome runtime not available');
      }

      // Clear any existing connection
      this.disconnect();

      // Implement proper connection retry logic
      let retries = 0;
      const maxRetries = 3;
      const retryDelay = 1000;

      while (retries < maxRetries) {
        try {
          console.log(`Connection attempt ${retries + 1}/${maxRetries}`);
          this.port = chrome.runtime.connect({ name: this.portName });
          
          if (!this.port) {
            throw new Error('Failed to create port connection');
          }

          this.setupPortListeners();
          console.log('Connection established successfully');
          this.notifyConnectionStatus(true);
          return true;
        } catch (error) {
          console.warn(`Connection attempt ${retries + 1} failed:`, error);
          retries++;
          
          if (retries === maxRetries) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Connection failed after ${maxRetries} attempts: ${errorMessage}`);
          }
          
          // Exponential backoff
          const delay = retryDelay * Math.pow(2, retries - 1);
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      return false;
    } catch (error) {
      console.error('Connection failed:', error);
      this.notifyConnectionStatus(false);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Connection failed: ${errorMessage}`);
    }
  }

  private setupPortListeners(): void {
    if (!this.port) {
      console.error('Cannot setup listeners: port is null');
      return;
    }

    this.port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      console.log('Port disconnected:', error?.message || 'No error details');
      this.notifyConnectionStatus(false);

      if (chrome.runtime && chrome.runtime.id && !error?.message?.includes('Extension context invalidated')) {
        if (this.retryCount < this.MAX_RETRIES) {
          this.retryCount++;
          const delay = this.RETRY_DELAY * Math.pow(2, this.retryCount - 1);
          console.log(`Scheduling reconnection attempt ${this.retryCount} in ${delay}ms`);
          setTimeout(() => this.reconnect(), delay);
        } else {
          console.error('Max retry attempts reached');
        }
      }
    });

    this.port.onMessage.addListener((message: Message) => {
      console.log('Received message:', message.type);
      this.messageListeners.forEach(listener => listener(message));
    });

    console.log('Port listeners setup completed');
  }

  private async reconnect(): Promise<void> {
    const connected = await this.connect();
    if (connected) {
      this.retryCount = 0;
      this.processMessageQueue();
    }
  }

  private processMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.port) {
      const message = this.messageQueue.shift();
      if (message) {
        try {
          this.port.postMessage(message);
        } catch (error) {
          console.error('Error sending queued message:', error);
          this.messageQueue.unshift(message);
          break;
        }
      }
    }
  }

  sendMessage(type: MessageType, data?: any): void {
    const message: Message = { type, data };
    if (this.port) {
      try {
        this.port.postMessage(message);
      } catch (error) {
        this.messageQueue.push(message);
      }
    } else {
      this.messageQueue.push(message);
    }
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  onMessage(listener: (message: Message) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  private notifyConnectionStatus(connected: boolean): void {
    this.connectionListeners.forEach(listener => listener(connected));
  }

  disconnect(): void {
    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }
    this.messageQueue = [];
    this.retryCount = 0;
    this.notifyConnectionStatus(false);
  }
}
