import { GitLabService } from '../services/GitLabService';
import type { Message, MessageType, Port, UploadStatusState } from '../lib/types';
import { StateManager } from './StateManager';
import { ZipHandler } from '../services/zipHandler';

export class BackgroundService {
  private stateManager: StateManager;
  private zipHandler: ZipHandler | null;
  private ports: Map<number, Port>;
  private gitlabService: GitLabService | null;
  private pendingCommitMessage: string;
  private storageListener:
    | ((changes: { [key: string]: chrome.storage.StorageChange }, namespace: string) => void)
    | null = null;

  constructor() {
    console.log('🚀 Background service initializing...');
    this.stateManager = StateManager.getInstance();
    this.ports = new Map();
    this.gitlabService = null;
    this.zipHandler = null;
    this.pendingCommitMessage = 'Commit from Bolt to GitLab';
    this.initialize();
  }

  // this.initializeListeners();
  // this.initializeStorageListener();

  private async initialize(): Promise<void> {
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
        if (chrome.runtime.id) {
          resolveOnce();
        }
      });

      const gitlabService = await this.initializeGitLabService();
      if (gitlabService) {
        this.setupZipHandler(gitlabService);
        this.setupConnectionHandlers();
        this.setupStorageListener();
        console.log('👂 Background service initialized');
      } else {
        console.warn('GitLab service not initialized, waiting for token...');
      }
    } catch (error) {
      console.error('Failed to initialize background service:', error);
      // Re-throw to ensure caller knows about initialization failure
      throw error;
    }
  }

  private async initializeGitLabService(): Promise<GitLabService | null> {
    try {
      const settings = await this.stateManager.getSettings();

      if (
        settings &&
        settings.gitLabSettings &&
        settings.gitLabSettings.gitlabToken &&
        settings.gitLabSettings.repoOwner
      ) {
        console.log('✅ Valid settings found, initializing GitLab service', settings);
        this.gitlabService = new GitLabService(settings.gitLabSettings.gitlabToken);
      } else {
        console.log('❌ Invalid or incomplete settings');
        this.gitlabService = null;
      }
    } catch (error) {
      console.error('Failed to initialize GitLab service:', error);
      this.gitlabService = null;
    }
    return this.gitlabService;
  }

  private setupZipHandler(gitlabService: GitLabService) {
    this.zipHandler = new ZipHandler(gitlabService, (status) => this.broadcastStatus(status));
  }

  private broadcastStatus(status: UploadStatusState) {
    for (const [tabId, port] of this.ports) {
      this.sendResponse(port, {
        type: 'UPLOAD_STATUS',
        status,
      });
    }
  }

  private setupConnectionHandlers(): void {
    chrome.runtime.onConnect.addListener((port: Port) => {
      const tabId = port.sender?.tab?.id ?? -1; // Use -1 for popup

      if (!['bolt-content', 'popup'].includes(port.name)) {
        return;
      }

      console.log('📝 New connection from:', port.name, 'tabId:', tabId);
      this.ports.set(tabId, port);

      port.onDisconnect.addListener(() => {
        console.log('🔌 Port disconnected:', tabId);
        this.ports.delete(tabId);
      });

      port.onMessage.addListener(async (message: Message) => {
        console.log('📥 Received port message:', { source: port.name, type: message.type });
        await this.handlePortMessage(tabId, message);
      });
    });

    // Clean up when tabs are closed
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.ports.delete(tabId);
    });

    // Handle URL updates for project ID
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (tab.url?.includes('bolt.new/~/')) {
        const projectId = tab.url.match(/bolt\.new\/~\/([^/]+)/)?.[1] || null;
        if (projectId) {
          await this.stateManager.setProjectId(projectId);
        }
      }
    });
  }

  private setupStorageListener(): void {
    // Remove any existing listener
    if (this.storageListener) {
      chrome.storage.onChanged.removeListener(this.storageListener);
    }

    // Create new listener and store reference
    this.storageListener = async (changes, namespace) => {
      if (namespace === 'sync') {
        const settingsChanged = ['gitlabToken', 'repoOwner', 'repoName', 'branch'].some(
          (key) => key in changes
        );

        if (settingsChanged) {
          console.log('🔄 GitLab settings changed, reinitializing GitLab service...');
          const gitlabService = await this.initializeGitLabService();
          if (gitlabService) {
            console.log('🔄 GitLab service reinitialized, reinitializing ZipHandler...');
            this.setupZipHandler(gitlabService);
          }
        }
      }
    };

    // Add the listener
    chrome.storage.onChanged.addListener(this.storageListener);
  }

  private async handlePortMessage(tabId: number, message: Message): Promise<void> {
    const port = this.ports.get(tabId);
    if (!port) return;

    try {
      switch (message.type) {
        case 'ZIP_DATA':
          await this.handleZipData(tabId, message.data);
          break;

        case 'SET_COMMIT_MESSAGE':
          console.log('Setting commit message:', message.data.message);
          if (message.data && message.data.message) {
            this.pendingCommitMessage = message.data.message;
          }
          break;

        case 'OPEN_SETTINGS':
          console.log('Opening settings popup');
          chrome.action.openPopup();
          break;



        case 'DEBUG':
          console.log(`[Content Debug] ${message.message}`);
          break;

        case 'CONTENT_SCRIPT_READY':
          console.log('Content script is ready');
          break;

        default:
          console.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error(`Error handling message ${message.type}:`, error);
      this.sendResponse(port, {
        type: 'UPLOAD_STATUS',
        status: {
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error occurred',
        },
      });
    }
  }

  private async handleZipData(tabId: number, base64Data: string): Promise<void> {
    console.log('Processing ZIP data for tab:', tabId);
    const port = this.ports.get(tabId);
    if (!port) {
      console.error('Port not found for tab:', tabId);
      return;
    }

    try {
      if (!this.gitlabService) {
        throw new Error('GitLab service not initialized. Please check your GitLab settings and try again.');
      }

      if (!this.zipHandler) {
        throw new Error('ZIP handler not initialized. Please try reloading the extension.');
      }

      const projectId = await this.stateManager.getProjectId();
      if (!projectId) {
        throw new Error('Project ID not found. Please make sure you are on a valid Bolt project page.');
      }

      console.log('Validating project:', { tabId, projectId });

      try {
        // Convert base64 to blob
        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'application/zip' });

        // Process the ZIP file
        await this.withTimeout(
          this.zipHandler.processZipFile(blob, projectId, this.pendingCommitMessage),
          5 * 60 * 1000, // 5 minutes timeout
          'File upload timed out. Please try again with a smaller number of files or check your network connection.'
        );

        // Reset commit message after successful upload
        this.pendingCommitMessage = 'Commit from Bolt to GitLab';

        this.sendResponse(port, {
          type: 'UPLOAD_STATUS',
          status: { status: 'success', message: 'Upload completed successfully', progress: 100 },
        });
      } catch (decodeError) {
        console.error('Error processing ZIP data:', decodeError);
        const errorMessage =
          decodeError instanceof Error ? decodeError.message : String(decodeError);
        const isGitLabError = errorMessage.includes('GitLab API Error');

        if (isGitLabError) {
          // Extract the original GitLab error message if available
          const originalMessage =
            (decodeError as any).originalMessage || 'GitLab authentication or API error occurred';
          console.error('GitLab API Error:', originalMessage);
          throw new Error(`GitLab Error: ${originalMessage}. Please check your GitLab token and repository permissions.`);
        } else if (errorMessage.includes('Project settings not found')) {
          console.error('Project settings not found');
          throw new Error('Project settings not configured. Please configure your GitLab repository settings in the extension popup.');
        } else if (errorMessage.includes('Repository not found')) {
          console.error('Repository not found');
          throw new Error('Repository not found. Please verify your GitLab repository URL and permissions.');
        } else if (errorMessage.includes('Insufficient permissions')) {
          console.error('Permission error:', errorMessage);
          throw new Error('Insufficient permissions. Please check your GitLab token has the required access rights.');
        } else {
          console.error('Unknown ZIP processing error:', errorMessage);
          throw new Error(
            `Failed to process ZIP data. Please try reloading the page. ` +
              `If the issue persists, please check your network connection or contact support.`
          );
        }
      }
    } catch (error) {
      console.error('Error processing ZIP:', error);
      this.sendResponse(port, {
        type: 'UPLOAD_STATUS',
        status: {
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error occurred',
        },
      });
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    timeoutMessage: string
  ): Promise<T> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), ms)
    );
    return Promise.race([promise, timeout]);
  }

  private sendResponse(
    port: Port,
    message: { type: MessageType; status?: UploadStatusState }
  ): void {
    try {
      port.postMessage(message);
    } catch (error) {
      console.error('Error sending response:', error);
    }
  }

  public destroy(): void {
    if (this.storageListener) {
      chrome.storage.onChanged.removeListener(this.storageListener);
      this.storageListener = null;
    }
  }
}
