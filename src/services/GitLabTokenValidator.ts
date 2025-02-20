import { BaseGitService, type ProgressCallback } from './BaseGitService';
import { DEFAULT_GITLAB_BASE_URL } from './GitLabService';

export class GitLabTokenValidator extends BaseGitService {
  protected get baseUrl(): string {
    return `${this.customBaseUrl || DEFAULT_GITLAB_BASE_URL}/api`;
  }

  protected get apiVersion(): string {
    return 'v4';
  }

  protected get acceptHeader(): string {
    return 'application/json';
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public static async validateAndCacheToken(token: string): Promise<string> {
    const cachedToken = await chrome.storage.local.get(['cachedToken']);
    if (cachedToken && cachedToken.token === token) {
      return cachedToken.decryptedToken;
    }

    const decryptedToken = token; // No decryption needed since token is already decrypted
    if (!decryptedToken.startsWith('glpat-')) {
      throw new Error('Invalid GitLab token format');
    }

    await chrome.storage.local.set({
      cachedToken: {
        token,
        decryptedToken,
        timestamp: Date.now()
      }
    });

    return decryptedToken;
  }

  async verifyTokenPermissions(
    username: string,
    onProgress?: ProgressCallback
  ): Promise<{ isValid: boolean; error?: string }> {
    try {
      // First verify token scopes by checking user info
      try {
        const user = await this.request('GET', '/user', undefined, {
          headers: {
            'Accept': 'application/json'
          }
        });
        if (!user.username) {
          onProgress?.({ permission: 'read_repository', isValid: false });
          return {
            isValid: false,
            error: 'Invalid GitLab token. Token must have api scope for both read and write access.',
          };
        }
        onProgress?.({ permission: 'read_repository', isValid: true });
      } catch (error) {
        onProgress?.({ permission: 'read_repository', isValid: false });
        return {
          isValid: false,
          error: 'Token lacks read_api scope. Please ensure your token has read_api or api scope.',
        };
      }

      // Verify write access by attempting to create a temporary file
      try {
        // Get all projects the user has access to
        const projects = await this.request('GET', '/projects?membership=true', undefined, {
          headers: {
            'Accept': 'application/json'
          }
        });
        if (projects.length > 0) {
          // Try each project until we find one with write access
          for (const project of projects) {
            try {
              // Check project access level
              const members = await this.request('GET', `/projects/${project.id}/members/all`, undefined, {
                headers: {
                  'Accept': 'application/json'
                }
              });
              const currentUser = members.find((m: any) => m.username.toLowerCase() === username.toLowerCase());
              
              // Access levels: 30 = Developer, 40 = Maintainer, 50 = Owner
              if (currentUser && currentUser.access_level >= 30) {
                onProgress?.({ permission: 'write_repository', isValid: true });
                return { isValid: true };
              }
            } catch (error: any) {
              if (error.status === 403 || error.status === 404) {
                continue; // Skip if we can't access this project
              }
              throw error; // Re-throw other errors
            }
          }
          
          // If we get here, no projects had write access
          onProgress?.({ permission: 'write_repository', isValid: false });
          return {
            isValid: false,
            error: 'Token lacks repository write permission. Please ensure your token has api scope and you have Developer (30) or higher access level to at least one project.',
          };
        } else {
          onProgress?.({ permission: 'write_repository', isValid: false });
          return {
            isValid: false,
            error: 'No projects available to verify write access. Please create a project or get Developer (30) or higher access level to an existing one.',
          };
        }
      } catch (error: any) {
        onProgress?.({ permission: 'write_repository', isValid: false });
        // Use the original GitLab error message if available
        const errorMessage = error.gitlabErrorResponse?.message || error.message || 'Failed to verify write access';
        return {
          isValid: false,
          error: `Failed to verify write access: ${errorMessage}. Please ensure your token has api scope and you have Developer (30) or higher access level.`,
        };
      }

      return { isValid: true };
    } catch (error: any) {
      console.error('Permission verification failed:', error);
      const errorMessage = error.gitlabErrorResponse?.message || error.message || String(error);
      return {
        isValid: false,
        error: `Permission verification failed: ${errorMessage}`,
      };
    }
  }

  private async validateTokenInternal(
    username: string
  ): Promise<{ isValid: boolean; error?: string }> {
    try {
      const authUser = await this.request('GET', '/user', undefined, {
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!authUser.username) {
        return { isValid: false, error: 'Invalid GitLab token' };
      }

      if (authUser.username.toLowerCase() === username.toLowerCase()) {
        return { isValid: true };
      }

      // Check if user has access to the namespace
      const namespaces = await this.request('GET', `/namespaces?search=${encodeURIComponent(username)}`, undefined, {
        headers: {
          'Accept': 'application/json'
        }
      });
      const hasAccess = namespaces.some(
        (ns: any) => ns.path.toLowerCase() === username.toLowerCase()
      );

      if (hasAccess) {
        return { isValid: true };
      }

      return {
        isValid: false,
        error:
          'Token can only be used with your GitLab username or namespaces you have access to',
      };
    } catch (error: any) {
      if (error.status === 404) {
        return { isValid: false, error: 'Invalid GitLab username or namespace' };
      }
      return { isValid: false, error: 'Invalid GitLab token' };
    }
  }

  async validateTokenAndUser(username: string): Promise<{ isValid: boolean; error?: string }> {
    try {
      // First validate token format and use cache
      try {
        await GitLabTokenValidator.validateAndCacheToken(this.token);
      } catch (error) {
        return { isValid: false, error: 'Invalid GitLab token format. Token must start with "glpat-".' };
      }

      // Then validate basic token access
      const basicValidation = await this.validateTokenInternal(username);
      if (!basicValidation.isValid) {
        return basicValidation;
      }

      // Then verify permissions
      const permissionCheck = await this.verifyTokenPermissions(username);
      if (!permissionCheck.isValid) {
        return permissionCheck;
      }

      return { isValid: true };
    } catch (error: any) {
      console.error('Validation failed:', error);
      const errorMessage = error.gitlabErrorResponse?.message || error.message || String(error);
      if (errorMessage.includes('401') || errorMessage.includes('Invalid GitLab token')) {
        return { isValid: false, error: 'Invalid or expired GitLab token. Please check your token and try again.' };
      } else if (errorMessage.includes('403')) {
        return { isValid: false, error: 'Insufficient permissions. Please ensure your token has the required scopes (api, read_api, read_repository, write_repository).' };
      } else if (errorMessage.includes('Invalid GitLab token format')) {
        return { isValid: false, error: 'Invalid GitLab token format. Token must start with "glpat-".' };
      }
      return { isValid: false, error: `Validation failed: ${errorMessage}` };
    }
  }
}
