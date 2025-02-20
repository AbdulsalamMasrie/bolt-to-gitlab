import type { Message, MessageType } from './types';

export class ConnectionManager {
  private port: chrome.runtime.Port | null = null;
  private messageQueue: Array<Message> = [];
  private retryCount = 0;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000;
  private connectionListeners: Set<(connected: boolean) => void> = new Set();
  private messageListeners: Set<(message: Message) => void> = new Set();

  constructor(private portName: string) {}

  async connect(): Promise<boolean> {
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        console.error('Chrome runtime not available');
        this.notifyConnectionStatus(false);
        return false;
      }

      console.log('Connecting to port:', this.portName);
      this.port = chrome.runtime.connect({ name: this.portName });
      
      if (!this.port) {
        console.error('Failed to create port connection');
        this.notifyConnectionStatus(false);
        return false;
      }

      this.setupPortListeners();
      console.log('Connection established successfully');
      this.notifyConnectionStatus(true);
      return true;
    } catch (error) {
      console.error('Connection failed:', error);
      this.notifyConnectionStatus(false);
      return false;
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
