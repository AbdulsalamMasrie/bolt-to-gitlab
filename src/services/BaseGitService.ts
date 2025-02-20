export type PermissionCheckProgress = {
  permission: 'read_repository' | 'write_repository';
  isValid: boolean;
};

export type ProgressCallback = (progress: PermissionCheckProgress) => void;

export abstract class BaseGitService {
  protected abstract get baseUrl(): string;
  protected abstract get apiVersion(): string;
  protected abstract get acceptHeader(): string;

  constructor(protected token: string, protected customBaseUrl?: string) {}

  async request(method: string, endpoint: string, body?: any, options: RequestInit = {}) {
    const url = `${this.baseUrl}/${this.apiVersion}${endpoint}`;
    const headers = {
      Accept: this.acceptHeader,
      ...(options.headers || {}),
    } as Record<string, string>;

    // Only add Content-Type for requests with body
    if (body && method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
    }

    // Don't include body for GET/HEAD requests
    const requestBody = (method === 'GET' || method === 'HEAD') ? undefined : 
      body ? JSON.stringify(body) : undefined;

    const response = await fetch(url, {
      method,
      ...options,
      headers,
      body: requestBody,
    });

    if (!response.ok) {
      let errorDetails;
      try {
        errorDetails = await response.json();
      } catch {
        errorDetails = { message: response.statusText };
      }

      const errorMessage = errorDetails.message || errorDetails.error || 'Unknown GitLab API error';
      let fullErrorMessage = `GitLab API Error (${response.status}): ${errorMessage}`;

      // Enhance error messages for common issues
      if (response.status === 401) {
        fullErrorMessage = 'Invalid or expired GitLab token. Please check your token and try again.';
      } else if (response.status === 403) {
        fullErrorMessage = 'Insufficient permissions. Please ensure your token has the required scopes (api, read_api, read_repository, write_repository).';
      } else if (response.status === 404) {
        fullErrorMessage = 'Resource not found. Please check your GitLab username and repository settings.';
      }

      const apiError = new Error(fullErrorMessage) as any;
      apiError.status = response.status;
      apiError.originalMessage = errorMessage;
      apiError.gitlabErrorResponse = errorDetails;

      throw apiError;
    }

    // Return null for 204 No Content responses
    if (response.status === 204) {
      return null;
    }

    // Only try to parse JSON if there's actual content
    const contentLength = response.headers.get('content-length');
    const hasContent = contentLength === null || parseInt(contentLength) > 0;

    if (hasContent) {
      return await response.json();
    }

    return null;
  }
}
