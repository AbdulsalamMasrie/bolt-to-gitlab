<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Check, X, Loader2, HelpCircle } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { GitLabService } from '../../services/GitLabService';
  import NewUserGuide from './gitlab/gitlab/NewUserGuide.svelte';

  export let gitlabToken: string;
  export let repoOwner: string;
  export let repoName: string;
  export let branch: string = 'main';
  export let baseUrl: string = 'https://gitlab.com';
  export let onSave: () => void;
  export let onInput: () => void;
  export let buttonDisabled: boolean = false;
  
  // Store project URL history
  let projectUrlHistory: ProjectUrlHistory[] = [];
  let selectedUrl: string = '';
  let newUrl: string = '';
  let lastBranch: string = 'main';

  let isValidatingToken = false;
  let isTokenValid: boolean | null = null;
  let projectSettings: Record<string, { repoName: string; branch: string }> = {};
  let parsedProjectId: string | null = null;
  let hasInitialSettings = false;
  let hasStatus = false;
  let status = '';
  let isSettingsValid = false;
  let tokenValidationTimeout: number;
  let validationError: string | null = null;
  let isCheckingPermissions = false;
  let lastPermissionCheck: number | null = null;
  let currentCheck: 'api' | 'read_api' | 'read_repository' | 'write_repository' | null = null;
  let permissionStatus = {
    api: undefined as boolean | undefined,
    read_api: undefined as boolean | undefined,
    read_repository: undefined as boolean | undefined,
    write_repository: undefined as boolean | undefined,
  };
  let permissionError: string | null = null;
  let previousToken: string | null = null;

  function parseGitLabUrl(url: string): { owner: string; name: string } | null {
    try {
      const urlObj = new URL(url);
      if (!urlObj.hostname.includes('gitlab')) {
        return null;
      }
      
      // Remove .git extension if present
      const path = urlObj.pathname.replace(/\.git$/, '');
      const parts = path.split('/').filter(Boolean);
      
      if (parts.length < 2) {
        return null;
      }
      
      return {
        owner: parts[0],
        name: parts[1]
      };
    } catch {
      return null;
    }
  }

  // URL input handling moved to commit flow

  onMount(async () => {
    // Load last permission check timestamp and last used values
    const storage = await chrome.storage.local.get(['lastPermissionCheck', 'projectUrlHistory', 'lastBranch']);
    lastPermissionCheck = storage.lastPermissionCheck || null;
    projectUrlHistory = storage.projectUrlHistory || [];
    if (projectUrlHistory.length > 0) {
      selectedUrl = projectUrlHistory[0].url;
    }
    lastBranch = storage.lastBranch || 'main';
    previousToken = gitlabToken;

    // If we have initial valid settings, validate token
    if (gitlabToken && repoOwner) {
      await validateSettings();
    }
  });

  async function validateSettings() {
    if (!gitlabToken || !repoOwner || !baseUrl) {
      isTokenValid = null;
      validationError = 'Missing required settings';
      return;
    }

    try {
      isValidatingToken = true;
      validationError = null;
      const gitlabService = new GitLabService(gitlabToken, baseUrl);
      const result = await gitlabService.validateTokenAndUser(repoOwner);
      isTokenValid = result.isValid;
      validationError = result.error || null;

      // Load last used values if validation successful
      if (result.isValid && selectedUrl) {
        const parsed = parseGitLabUrl(selectedUrl);
        if (parsed) {
          repoName = parsed.name;
          branch = lastBranch;
        }
      }
    } catch (error) {
      console.error('Error validating settings:', error);
      isTokenValid = false;
      if (error instanceof Error) {
        // Extract GitLab API error message if available
        const gitlabError = error as any;
        validationError = gitlabError.originalMessage || gitlabError.message || 'GitLab token validation failed';
      } else {
        validationError = 'GitLab token validation failed';
      }
    } finally {
      isValidatingToken = false;
    }
  }

  function handleTokenInput() {
    onInput();
    isTokenValid = null;
    validationError = null;

    // Clear existing timeout
    if (tokenValidationTimeout) {
      clearTimeout(tokenValidationTimeout);
    }

    // Debounce validation to avoid too many API calls
    tokenValidationTimeout = setTimeout(() => {
      validateSettings();
    }, 500) as unknown as number;
  }

  async function handleOwnerInput() {
    onInput();
    if (gitlabToken) {
      handleTokenInput();
    }
  }

  async function checkTokenPermissions() {
    if (!gitlabToken || isCheckingPermissions) return;

    isCheckingPermissions = true;
    permissionError = null;
    permissionStatus = {
      api: undefined,
      read_api: undefined,
      read_repository: undefined,
      write_repository: undefined,
    };

    try {
      const gitlabService = new GitLabService(gitlabToken);

      const result = await gitlabService.verifyTokenPermissions(
        repoOwner,
        ({ permission, isValid }) => {
          currentCheck = permission;
          // Update the status as each permission is checked
          switch (permission) {
            case 'api':
              permissionStatus.api = isValid;
              break;
            case 'read_api':
              permissionStatus.read_api = isValid;
              break;
            case 'read_repository':
              permissionStatus.read_repository = isValid;
              break;
            case 'write_repository':
              permissionStatus.write_repository = isValid;
              break;
          }
          // Force Svelte to update the UI
          permissionStatus = { ...permissionStatus };
        }
      );

      if (result.isValid) {
        lastPermissionCheck = Date.now();
        await chrome.storage.local.set({ lastPermissionCheck });
        previousToken = gitlabToken;
      } else {
        permissionStatus = {
          api: !result.error?.includes('api access'),
          read_api: !result.error?.includes('read api'),
          read_repository: !result.error?.includes('read repository'),
          write_repository: !result.error?.includes('write repository'),
        };
        permissionError = result.error || 'Permission verification failed';
      }
    } catch (error) {
      console.error('Permission check failed:', error);
      if (error instanceof Error) {
        // Extract GitLab API error message if available
        const gitlabError = error as any;
        permissionError = gitlabError.originalMessage || gitlabError.message || 'Failed to verify GitLab permissions';
      } else {
        permissionError = 'Failed to verify GitLab permissions';
      }
    } finally {
      isCheckingPermissions = false;
      currentCheck = null;
    }
  }

  const handleSave = async (event: Event) => {
    event.preventDefault();

    try {
      // Ensure we have the minimum required settings
      if (!gitlabToken || !repoOwner) {
        throw new Error('Missing required settings');
      }

      // Validate token and username before saving
      const gitlabService = new GitLabService(gitlabToken, baseUrl);
      const result = await gitlabService.validateTokenAndUser(repoOwner);
      const isValid = result.isValid;
      if (!isValid) {
        throw new Error(validationError || 'Validation failed');
      }

      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const needsCheck =
        previousToken !== gitlabToken ||
        !lastPermissionCheck ||
        Date.now() - lastPermissionCheck > THIRTY_DAYS;

      if (needsCheck) {
        await checkTokenPermissions();
        if (permissionError) {
          throw new Error(permissionError);
        }
      }

      // Validate project URL if provided
      const url = selectedUrl || newUrl;
      if (url) {
        const gitlabService = new GitLabService(gitlabToken, baseUrl);
        const urlValidation = await gitlabService.validateProjectUrl(url);
        if (!urlValidation.isValid) {
          throw new Error(urlValidation.error || 'Invalid project URL');
        }

        // Save URL to history
        const history = [
          { url, branch, lastUsed: Date.now() },
          ...projectUrlHistory.filter(h => h.url !== url).slice(0, 9)
        ];
        await chrome.storage.local.set({ projectUrlHistory: history });
        projectUrlHistory = history;
      }

      const settings = {
        gitlabToken,
        repoOwner,
        baseUrl,
        projectSettings,
      };

      if (parsedProjectId) {
        projectSettings[parsedProjectId] = {
          repoName,
          branch: branch || 'main' // Set default branch if not specified
        };
        settings.projectSettings = projectSettings;
      }

      await chrome.storage.sync.set(settings);
      hasInitialSettings = true;
      status = 'Settings saved successfully!';
      hasStatus = true;
      checkSettingsValidity();
      setTimeout(() => {
        status = '';
        hasStatus = false;
      }, 3000);

      onSave();
    } catch (error) {
      console.error('Error saving settings:', error);
      status = error instanceof Error ? error.message : 'Error saving settings';
      hasStatus = true;
      isSettingsValid = false;
    }
  };

  // Project settings removed - using last used values instead
</script>

<div class="space-y-6">
  <!-- Quick Links Section -->
  <NewUserGuide />

  <!-- Settings Form -->
  <form on:submit|preventDefault={handleSave} class="space-y-4">
    <div class="space-y-2">
      <Label for="gitlabToken" class="text-slate-200">
        GitLab Token
        <span class="text-sm text-slate-400 ml-2">(Required for uploading)</span>
      </Label>
      <div class="relative">
        <Input
          type="password"
          id="gitlabToken"
          bind:value={gitlabToken}
          on:input={handleTokenInput}
          placeholder="glpat_***********************************"
          class="bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500 pr-10"
        />
        {#if gitlabToken}
          <div class="absolute right-3 top-1/2 -translate-y-1/2">
            {#if isValidatingToken}
              <div
                class="animate-spin h-4 w-4 border-2 border-slate-400 border-t-transparent rounded-full"
              />
            {:else if isTokenValid === true}
              <Check class="h-4 w-4 text-green-500" />
            {:else if isTokenValid === false}
              <X class="h-4 w-4 text-red-500" />
            {/if}
          </div>
        {/if}
      </div>
      {#if validationError}
        <p class="text-sm text-red-400 mt-1">{validationError}</p>
      {:else if isTokenValid}
        <div class="space-y-2">
          <p class="text-sm text-emerald-400">✨ Token validated successfully</p>
          <div class="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="text-xs"
              on:click={checkTokenPermissions}
              disabled={isCheckingPermissions}
            >
              {#if isCheckingPermissions}
                <Loader2 class="h-3 w-3 mr-1 animate-spin" />
                Checking...
              {:else}
                Verify Permissions
              {/if}
            </Button>
            <div class="flex items-center gap-2">
              {#if previousToken === gitlabToken && lastPermissionCheck}
                <div class="relative group">
                  <HelpCircle class="h-3 w-3 text-slate-400" />
                  <div
                    class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block w-64 p-2 text-xs bg-slate-900 border border-slate-700 rounded-md shadow-lg"
                  >
                    <p>Last verified: {new Date(lastPermissionCheck).toLocaleString()}</p>
                    <p class="mt-1 text-slate-400">
                      Permissions are automatically re-verified when the token changes or after 30 days.
                    </p>
                  </div>
                </div>
              {/if}
              <div class="flex items-center gap-1.5 text-xs">
                <span class="flex items-center gap-0.5">
                  {#if currentCheck === 'api'}
                    <Loader2 class="h-3 w-3 animate-spin text-slate-400" />
                  {:else if permissionStatus.api !== undefined}
                    {#if permissionStatus.api}
                      <Check class="h-3 w-3 text-green-500" />
                    {:else}
                      <X class="h-3 w-3 text-red-500" />
                    {/if}
                  {:else if previousToken === gitlabToken && lastPermissionCheck}
                    <Check class="h-3 w-3 text-green-500 opacity-50" />
                  {/if}
                  API
                </span>
                <span class="flex items-center gap-0.5">
                  {#if currentCheck === 'read_api'}
                    <Loader2 class="h-3 w-3 animate-spin text-slate-400" />
                  {:else if permissionStatus.read_api !== undefined}
                    {#if permissionStatus.read_api}
                      <Check class="h-3 w-3 text-green-500" />
                    {:else}
                      <X class="h-3 w-3 text-red-500" />
                    {/if}
                  {:else if previousToken === gitlabToken && lastPermissionCheck}
                    <Check class="h-3 w-3 text-green-500 opacity-50" />
                  {/if}
                  Read
                </span>
                <span class="flex items-center gap-0.5">
                  {#if currentCheck === 'read_repository'}
                    <Loader2 class="h-3 w-3 animate-spin text-slate-400" />
                  {:else if permissionStatus.read_repository !== undefined}
                    {#if permissionStatus.read_repository}
                      <Check class="h-3 w-3 text-green-500" />
                    {:else}
                      <X class="h-3 w-3 text-red-500" />
                    {/if}
                  {:else if previousToken === gitlabToken && lastPermissionCheck}
                    <Check class="h-3 w-3 text-green-500 opacity-50" />
                  {/if}
                  Repo Read
                </span>
                <span class="flex items-center gap-0.5">
                  {#if currentCheck === 'write_repository'}
                    <Loader2 class="h-3 w-3 animate-spin text-slate-400" />
                  {:else if permissionStatus.write_repository !== undefined}
                    {#if permissionStatus.write_repository}
                      <Check class="h-3 w-3 text-green-500" />
                    {:else}
                      <X class="h-3 w-3 text-red-500" />
                    {/if}
                  {:else if previousToken === gitlabToken && lastPermissionCheck}
                    <Check class="h-3 w-3 text-green-500 opacity-50" />
                  {/if}
                  Repo Write
                </span>
              </div>
            </div>
          </div>
        </div>
        {#if permissionError}
          <p class="text-sm text-red-400 mt-1">{permissionError}</p>
        {/if}
      {/if}
    </div>

    <div class="space-y-2">
      <Label for="repoOwner" class="text-slate-200">
        Repository Owner
        <span class="text-sm text-slate-400 ml-2">(Your GitLab username)</span>
      </Label>
      <Input
        type="text"
        id="repoOwner"
        bind:value={repoOwner}
        on:input={handleOwnerInput}
        placeholder="username or organization"
        class="bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500"
      />
    </div>

    <div class="space-y-2">
      <Label for="baseUrl" class="text-slate-200">
        GitLab Base URL
        <span class="text-sm text-slate-400 ml-2">(Default: https://gitlab.com)</span>
      </Label>
      <Input
        type="text"
        id="baseUrl"
        bind:value={baseUrl}
        placeholder="https://gitlab.com"
        class="bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500"
      />
    </div>

    <div class="space-y-2">
      <Label for="projectUrl" class="text-slate-200">
        Project URL
        <span class="text-sm text-slate-400 ml-2">(GitLab repository URL)</span>
      </Label>
      {#if projectUrlHistory.length > 0}
        <select
          id="projectUrl"
          bind:value={selectedUrl}
          class="w-full px-3 py-2 text-sm rounded-md bg-slate-800 text-white border border-slate-700 focus:border-blue-500 focus:outline-none"
        >
          {#each projectUrlHistory as history}
            <option value={history.url}>{history.url} ({history.branch})</option>
          {/each}
          <option value="">Enter new URL...</option>
        </select>
      {/if}
      <Input
        type="text"
        id="newProjectUrl"
        bind:value={newUrl}
        placeholder="https://gitlab.com/username/repo.git"
        class="bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500"
      />
    </div>

    <div class="flex justify-end">
      <Button type="submit" disabled={buttonDisabled || !isTokenValid}>Save Settings</Button>
    </div>
  </form>
</div>
