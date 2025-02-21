import type { Message } from '$lib/types';
import { MessageHandler } from './MessageHandler';
import { UIManager } from './UIManager';

export class ContentManager {
  private static instance: ContentManager | null = null;
  private uiManager: UIManager | undefined;
  private messageHandler: MessageHandler | undefined;
  private port: chrome.runtime.Port | null = null;
  private isReconnecting = false;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY = 1000;
  private isInitialized = false;

  private constructor() {
    if (!this.shouldInitialize()) {
      console.log('Not initializing ContentManager - URL does not match bolt.new pattern');
      return;
    }
  }

  public static async create(): Promise<ContentManager> {
    if (!ContentManager.instance) {
      ContentManager.instance = new ContentManager();
      await ContentManager.instance.initialize();
    }
    return ContentManager.instance;
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.initializeConnection();
      this.messageHandler = new MessageHandler(this.port!);
      this.uiManager = UIManager.getInstance(this.messageHandler);
      this.setupEventListeners();
      this.isInitialized = true;
    } catch (error) {
      console.error('Error initializing ContentManager:', error);
      this.handleInitializationError(error);
      throw error;
    }
  }

  private shouldInitialize(): boolean {
    const currentUrl = window.location.href;
    const match = currentUrl.match(/bolt\.new\/~\/([^/]+)/);
    return !!match;
  }

  private async initializeConnection() {
    try {
      // Wait for service worker to be ready with increased timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Service worker initialization timeout')), 15000);
        
        let isResolved = false;
        const resolveOnce = () => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            resolve();
          }
        };

        // Handle both startup and installation cases
        chrome.runtime.onStartup.addListener(resolveOnce);
        chrome.runtime.onInstalled.addListener(resolveOnce);

        // Immediate resolution if service worker is already active
        if (chrome.runtime?.id) {
          resolveOnce();
        }
      });

      // Now try to connect
      this.port = chrome.runtime.connect({ name: 'bolt-content' });
      console.log('🔊 Connected to background service with port:', this.port);

      if (!this.port) {
        throw new Error('Failed to establish connection with background service');
      }

      this.setupPortListeners();
      this.isReconnecting = false;
      this.reconnectAttempts = 0;

      // Send ready message
      if (this.messageHandler) {
        this.messageHandler.sendMessage('CONTENT_SCRIPT_READY');
      }
    } catch (error) {
      if (this.isExtensionContextInvalidated(error)) {
        console.warn('Extension context invalidated, attempting reconnection...');
        this.handleExtensionContextInvalidated();
      } else {
        console.error('Error initializing connection:', error);
        throw error;
      }
    }
  }

  private setupPortListeners(): void {
    if (!this.port) {
      console.error('Port is not initialized');
      this.handleDisconnection();
      return;
    }

    this.port.onMessage.addListener((message: Message) => {
      try {
        this.handleBackgroundMessage(message);
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    this.port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      console.log('Port disconnected:', error?.message || 'No error message');

      if (this.isExtensionContextInvalidated(error)) {
        this.handleExtensionContextInvalidated();
      } else {
        this.handleDisconnection();
      }
    });
  }
  private isExtensionContextInvalidated(error: any): boolean {
    return (
      error?.message?.includes('Extension context invalidated') ||
      error?.message?.includes('Extension context was invalidated')
    );
  }

  private handleExtensionContextInvalidated(): void {
    console.log('Extension context invalidated, cleaning up...');
    this.cleanup();
    this.notifyUserOfExtensionReload();
  }

  private handleDisconnection(): void {
    // If we're already at max attempts or already reconnecting, don't try again
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.log('Max reconnection attempts reached');
      this.cleanup();
      this.notifyUserOfError();
      return;
    }

    if (this.isReconnecting) {
      return;
    }

    // Check if extension context is still valid before scheduling reconnection
    if (!chrome.runtime || !chrome.runtime.id) {
      console.log('Extension context is invalid, not attempting reconnection');
      this.cleanup();
      this.notifyUserOfExtensionReload();
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    console.log(
      `Attempting reconnection (${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`
    );
    setTimeout(async () => await this.reconnect(), this.RECONNECT_DELAY);
  }

  private async reconnect(): Promise<void> {
    try {
      // Don't attempt reconnection if we're already at max attempts
      if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
        console.log('Max reconnection attempts reached, stopping reconnection');
        this.cleanup();
        this.notifyUserOfError();
        return;
      }

      // Check if extension context is still valid before attempting reconnection
      if (chrome.runtime && chrome.runtime.id) {
        await this.initializeConnection();
        if (this.port) {
          this.messageHandler?.updatePort(this.port);
          this.setupEventListeners();
          console.log('Successfully reconnected');
          this.isReconnecting = false;
          this.reconnectAttempts = 0;
        }
      } else {
        console.log('Extension context is invalid, stopping reconnection attempts');
        this.cleanup();
        this.notifyUserOfExtensionReload();
      }
    } catch (error) {
      console.error('Reconnection failed:', error);
      if (this.isExtensionContextInvalidated(error)) {
        this.handleExtensionContextInvalidated();
      } else {
        this.handleDisconnection();
      }
    }
  }

  private handleInitializationError(error: any): void {
    console.error('Initialization error:', error);
    this.notifyUserOfError();
  }

  private notifyUserOfExtensionReload(): void {
    this.uiManager?.showNotification({
      type: 'info',
      message:
        'Bolt to GitLab extension has been updated or reloaded. Please refresh the page to continue.',
      duration: 10000,
    });
  }

  private notifyUserOfError(): void {
    this.uiManager?.showNotification({
      type: 'error',
      message:
        'There was an error connecting to the Bolt to GitLab extension. Please refresh the page or reinstall the extension.',
      duration: 10000,
    });
  }

  private cleanup(): void {
    if (this.port) {
      try {
        this.port.disconnect();
      } catch (error) {
        console.warn('Error disconnecting port:', error);
      }
      this.port = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.isInitialized = false;
    this.uiManager?.cleanup();
  }

  private setupEventListeners(): void {
    window.addEventListener('unload', () => {
      this.cleanup();
    });

    window.addEventListener('focus', () => {
      if (!this.port && !this.isReconnecting) {
        this.reconnect();
      }
    });

    // Handle extension updates
    chrome.runtime.onConnect.addListener(() => {
      this.reinitialize();
    });
  }

  private handleBackgroundMessage(message: Message): void {
    switch (message.type) {
      case 'UPLOAD_STATUS':
        this.uiManager?.updateUploadStatus(message.status!);
        break;
      case 'GITLAB_SETTINGS_CHANGED':
        console.log('🔊 Received GitLab settings changed:', message.data.isValid);
        this.uiManager?.updateButtonState(message.data.isValid);
        break;
      default:
        console.warn('Unhandled message type:', message.type);
    }
  }

  public async reinitialize(): Promise<void> {
    console.log('🔊 Reinitializing content script');
    try {
      this.cleanup();
      this.isInitialized = false;
      await this.initialize();
      this.uiManager?.reinitialize();
    } catch (error) {
      console.error('Error reinitializing content script:', error);
      this.handleInitializationError(error);
      throw error;
    }
  }
}
