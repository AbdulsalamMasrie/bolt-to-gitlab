import { BaseGitService, type ProgressCallback } from './BaseGitService';
import type { UploadProgress } from '../lib/types';
import { RepositoryError } from '../lib/errors';

export const GITLAB_API_VERSION = 'v4';
export const DEFAULT_GITLAB_BASE_URL = 'https://gitlab.com';
export const GITLAB_SIGNUP_URL = `${DEFAULT_GITLAB_BASE_URL}/users/sign_up`;
export const CREATE_TOKEN_URL =
  `${DEFAULT_GITLAB_BASE_URL}/-/profile/personal_access_tokens?name=Bolt%20to%20GitLab&scopes=api,read_api,read_user,read_repository,write_repository`;

interface GitLabFileResponse {
  file_path: string;
  branch: string;
  content: string;
  commit_message: string;
  encoding?: string;
}

interface GitLabCommitResponse {
  id: string;
  short_id: string;
  title: string;
  message: string;
  created_at: string;
}

// Project creation interface removed

import { GitLabTokenValidator } from './GitLabTokenValidator';

export class GitLabService extends BaseGitService {
  private tokenValidator: GitLabTokenValidator;

  constructor(token: string, customBaseUrl: string = DEFAULT_GITLAB_BASE_URL) {
    super(token, customBaseUrl);
    this.tokenValidator = new GitLabTokenValidator(token, customBaseUrl);
  }

  protected getRequestHeaders(): Record<string, string> {
    return {
      'PRIVATE-TOKEN': this.token
    };
  }

  async request(method: string, endpoint: string, body?: any, options: RequestInit = {}) {
    const url = `${this.baseUrl}/${this.apiVersion}${endpoint}`;
    console.log('GitLab API Request:', { method, url });
    
    const headers = { ...this.getRequestHeaders(), ...options.headers };
    console.log('Request headers:', { ...headers, 'PRIVATE-TOKEN': '[REDACTED]' });
    
    // Don't include body for GET requests
    const requestOptions: RequestInit = {
      method,
      headers,
      ...options
    };
    
    if (method !== 'GET' && body) {
      requestOptions.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, requestOptions);

    console.log('GitLab API Response:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('GitLab API Error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      const error = new Error(`GitLab API Error (${response.status}): ${errorText || response.statusText}`);
      (error as any).status = response.status;
      throw error;
    }

    return response.json();
  }

  // Project creation and cloning removed - users must provide existing project URL
  protected get baseUrl(): string {
    return `${this.customBaseUrl || DEFAULT_GITLAB_BASE_URL}/api`;
  }

  protected get apiVersion(): string {
    return GITLAB_API_VERSION;
  }

  protected get acceptHeader(): string {
    return 'application/json';
  }

  public async validateProjectUrl(url: string): Promise<{ isValid: boolean; error?: string }> {
    try {
      const urlObj = new URL(url);
      const baseUrlObj = new URL(this.customBaseUrl || DEFAULT_GITLAB_BASE_URL);
      
      // Handle both web and API URLs by comparing hostname without api prefix
      const normalizedUrlHost = urlObj.hostname.replace(/^api\./, '');
      const normalizedBaseHost = baseUrlObj.hostname.replace(/^api\./, '');
      
      if (normalizedUrlHost !== normalizedBaseHost) {
        return { isValid: false, error: 'Repository URL must match GitLab instance URL' };
      }
      
      // Extract owner and repo from URL path
      const parts = urlObj.pathname
        .replace(/\.git$/, '')
        .replace(/^\/api\/v4\/projects\//, '')
        .split('/')
        .filter(Boolean);

      if (parts.length < 2) {
        return { isValid: false, error: 'Invalid repository URL format' };
      }

      const [owner, repo] = parts;
      try {
        // Always use API endpoint to validate
        await this.request('GET', `/projects/${encodeURIComponent(`${owner}/${repo}`)}`);
        return { isValid: true };
      } catch (error: any) {
        if (error.status === 404) {
          return { isValid: false, error: 'Repository not found' };
        }
        if (error.status === 401) {
          return { isValid: false, error: 'Invalid GitLab token or insufficient permissions' };
        }
        throw error;
      }
    } catch (error) {
      return { isValid: false, error: 'Invalid GitLab URL' };
    }
  }

  protected async handleError(response: Response): Promise<Error> {
    let errorDetails: { message?: string; error?: string } = {};
    try {
      errorDetails = await response.json();
    } catch {
      errorDetails = { message: response.statusText };
    }

    const errorMessage = errorDetails.message || errorDetails.error || 'Unknown GitLab API error';
    const formattedError = `GitLab API Error (${response.status}): ${errorMessage}`;

    switch (response.status) {
      case 401:
        return new Error('Invalid or expired GitLab token. Please check your settings and ensure your token is correct.');
      case 403:
        return new Error('Insufficient permissions. Please ensure your GitLab token has the required access rights (api, read_api, read_user, read_repository, write_repository).');
      case 404:
        return new Error('GitLab repository not found. Please verify the repository URL and ensure you have access to it.');
      case 429: {
        const retryAfter = response.headers.get('Retry-After');
        return new Error(
          `GitLab API rate limit exceeded. Please try again ${
            retryAfter ? `after ${retryAfter} seconds` : 'later'
          }. Consider reducing the frequency of requests.`
        );
      }
      case 500:
        return new Error('GitLab server error. Please try again later or check GitLab\'s status page.');
      case 502:
      case 503:
      case 504:
        return new Error('GitLab service is temporarily unavailable. Please try again in a few minutes.');
      default:
        if (response.status >= 400 && response.status < 500) {
          return new Error(`Request error: ${formattedError}. Please check your input and try again.`);
        }
        return new Error(formattedError);
    }
  }

    async verifyTokenPermissions(
    username: string,
    onProgress?: ProgressCallback
  ): Promise<{ isValid: boolean; error?: string }> {
    return this.tokenValidator.verifyTokenPermissions(username, onProgress);
  }


  // Project creation removed - users must provide existing project URL

  public async validateTokenAndUser(username: string): Promise<{ isValid: boolean; error?: string }> {
    try {
      // First verify the token is valid by getting user info
      const user = await this.request('GET', '/user', undefined, {
        headers: {
          'Accept': 'application/json'
        }
      });
      if (!user.username) {
        return { isValid: false, error: 'Invalid GitLab token' };
      }

      // Then verify the user has access to the specified namespace
      const namespaces = await this.request('GET', `/namespaces?search=${encodeURIComponent(username)}`, undefined, {
        headers: {
          'Accept': 'application/json'
        }
      });
      const hasAccess = namespaces.some((ns: any) => ns.path === username);

      if (!hasAccess) {
        return {
          isValid: false,
          error: 'Token can only be used with your GitLab username or organizations you have access to'
        };
      }

      return { isValid: true };
    } catch (error: any) {
      if (error.status === 401) {
        return { isValid: false, error: 'Invalid GitLab token' };
      }
      if (error.status === 404) {
        return { isValid: false, error: 'Invalid GitLab username or organization' };
      }
      return { isValid: false, error: error.message || 'Failed to validate GitLab token' };
    }
  }


  async ensureProjectExists(owner: string, name: string): Promise<void> {
    await this.validateRepository(owner, name);
  }

  public async validateRepository(owner: string, name: string): Promise<void> {
    try {
      const projectPath = encodeURIComponent(`${owner}/${name}`);
      console.log('Validating repository:', { owner, name, projectPath });
      
      const response = await this.request('GET', `/projects/${projectPath}`, undefined, {
        headers: {
          'Accept': 'application/json'
        }
      });
      console.log('Repository validation response:', response);
      
      if (!response) {
        throw new RepositoryError('Invalid repository response');
      }

      // Verify write access by checking branch access
      try {
        await this.request('GET', `/projects/${projectPath}/repository/branches`, undefined, {
          headers: {
            'Accept': 'application/json'
          }
        });
      } catch (error: any) {
        console.error('Branch access check failed:', error);
        if (error?.status === 403) {
          throw new RepositoryError('Insufficient permissions. Please make sure your GitLab token has write access to this repository.');
        }
        throw error;
      }
    } catch (error: any) {
      console.error('Repository validation error:', error);
      if (error?.status === 404) {
        throw new RepositoryError('Repository not found. Please verify the repository URL and your access permissions.');
      } else if (error instanceof RepositoryError) {
        throw error;
      } else {
        throw new RepositoryError(`GitLab API Error: ${error.message || 'Unknown error'}`);
      }
    }
  }

  // Project management methods removed - users must manage their repositories through GitLab UI

  protected async uploadFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    options: { message?: string; branch?: string } = {}
  ): Promise<GitLabFileResponse> {
    try {
      // Validate token and permissions first
      const validation = await this.validateTokenAndUser(owner);
      if (!validation.isValid) {
        throw new Error(`Invalid GitLab token: ${validation.error}`);
      }

      const response = await this.request(
        'POST',
        `/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/files/${encodeURIComponent(path)}`,
        {
          file_path: path,
          branch: options.branch || 'main',
          content,
          commit_message: options.message || 'Update file via Bolt to GitLab',
          author_name: 'Bolt to GitLab',
          author_email: 'bolt-to-gitlab@noreply.gitlab.com'
        }
      );
      return response as GitLabFileResponse;
    } catch (error: any) {
      if (error.status === 401) {
        throw new Error('Invalid or expired GitLab token. Please check your token and try again.');
      } else if (error.status === 403) {
        throw new Error('Insufficient permissions. Please ensure your token has write access to this repository.');
      }
      throw error;
    }
  }

  protected async downloadFile(
    path: string
  ): Promise<GitLabFileResponse> {
    const response = await this.request(
      'GET',
      `/repository/files/${encodeURIComponent(path)}?ref=main`,
      undefined,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );
    return response as GitLabFileResponse;
  }

  public async getCommits(
    owner: string,
    repo: string,
    options: { branch?: string; path?: string } = {}
  ): Promise<GitLabCommitResponse[]> {
    const queryParams = new URLSearchParams({
      ref_name: options.branch || 'main',
      ...(options.path && { path: options.path })
    });
    const response = await this.request(
      'GET',
      `/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/commits?${queryParams}`,
      undefined,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );
    return response as GitLabCommitResponse[];
  }
}
