import type { GitLabSettingsInterface, ProjectSettings } from '$lib/types';
import { ValidationError } from '../lib/errors';
import { GitLabTokenValidator } from './GitLabTokenValidator';

const DEFAULT_GITLAB_BASE_URL = 'https://gitlab.com';

export interface SettingsCheckResult {
  isSettingsValid: boolean;

  gitLabSettings?: GitLabSettingsInterface;
}

export class SettingsService {
  static async needsGitLabMigration(): Promise<boolean> {
    try {
      const settings = await chrome.storage.sync.get(['gitlabToken']);
      return !settings.gitlabToken;
    } catch (error) {
      console.error('Error checking migration status:', error);
      return false;
    }
  }

  static async clearOldSettings(): Promise<void> {
    try {
      await chrome.storage.sync.remove(['githubToken']); // Remove legacy GitLab token during migration
      await chrome.storage.local.remove(['cachedToken']); // Clear token cache
    } catch (error) {
      console.error('Error clearing old settings:', error);
    }
  }


  static async initializeGitLabSettings(): Promise<void> {
    try {
      const settings = await chrome.storage.sync.get([
        'repoOwner',
        'repoName',
        'branch',
        'baseUrl',
        'repositoryUrl',
        'projectSettings'
      ]);
      
      // Initialize with empty settings
      await chrome.storage.sync.set({
        gitlabToken: '',  // Empty token for security
        repoOwner: settings.repoOwner || '',
        repoName: settings.repoName || '',
        branch: settings.branch || 'main',
        baseUrl: settings.baseUrl || DEFAULT_GITLAB_BASE_URL,
        repositoryUrl: settings.repositoryUrl || '',
        projectSettings: settings.projectSettings || {}
      });
    } catch (error) {
      console.error('Error initializing GitLab settings:', error);
      throw new Error('Failed to initialize GitLab settings');
    }
  }

  // Main settings getter
  static async validateSettings(settings: Partial<GitLabSettingsInterface>): Promise<void> {
    if (!settings.gitlabToken) {
      throw new ValidationError('GitLab token is required', 'gitlabToken');
    }
    if (!settings.repoOwner) {
      throw new ValidationError('Repository owner is required', 'repoOwner');
    }
    if (!settings.baseUrl) {
      settings.baseUrl = DEFAULT_GITLAB_BASE_URL;
    }
    // Only validate repoName if repositoryUrl is set
    if (settings.repositoryUrl && !settings.repoName) {
      throw new ValidationError('Repository name is required when URL is provided', 'repoName');
    }
    // Set default branch if repository is configured
    if (settings.repositoryUrl && !settings.branch) {
      settings.branch = 'main';
    }
  }

  static async getSettings(): Promise<SettingsCheckResult> {
    try {
      const settings = await chrome.storage.sync.get(['gitlabToken', 'repoOwner', 'repoName', 'branch', 'baseUrl', 'repositoryUrl', 'projectSettings']);
      let decryptedToken: string | undefined;

      if (settings.gitlabToken) {
        try {
          decryptedToken = await GitLabTokenValidator.validateAndCacheToken(settings.gitlabToken);
        } catch (error) {
          console.error('Error validating GitLab token:', error);
          throw new ValidationError('Invalid GitLab token format', 'gitlabToken');
        }
      }

      const partialSettings: Partial<GitLabSettingsInterface> = {
        gitlabToken: decryptedToken,
        repoOwner: settings.repoOwner,
        repoName: settings.repoName,
        branch: settings.branch || 'main',
        baseUrl: settings.baseUrl,
        repositoryUrl: settings.repositoryUrl,
        projectSettings: settings.projectSettings || {},
      };

      try {
        await this.validateSettings(partialSettings);
      } catch (error) {
        if (error instanceof ValidationError) {
          return { isSettingsValid: false, gitLabSettings: undefined };
        }
        throw error;
      }

      return {
        isSettingsValid: true,
        gitLabSettings: partialSettings as GitLabSettingsInterface,
      };
    } catch (error) {
      console.error('Error checking GitLab settings:', error);
      return { isSettingsValid: false, gitLabSettings: undefined };
    }
  }
  static async getGitLabSettings(): Promise<SettingsCheckResult> {
    // Use the simplified validation from getSettings
    return this.getSettings();
  }

  static async getProjectId(): Promise<string | null> {
    try {
      const { projectId } = await chrome.storage.sync.get('projectId');
      return projectId || null;
    } catch (error) {
      console.error('Failed to get project ID:', error);
      return null;
    }
  }

  static async setProjectId(projectId: string): Promise<void> {
    try {
      await chrome.storage.sync.set({ projectId });
    } catch (error) {
      console.error('Failed to set project ID:', error);
    }
  }
}
