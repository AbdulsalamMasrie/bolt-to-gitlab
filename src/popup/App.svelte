<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card';
  import { Tabs, TabsContent } from '$lib/components/ui/tabs';
  import Header from '$lib/components/Header.svelte';
  import StatusAlert from '$lib/components/StatusAlert.svelte';
  import GitLabSettings from '$lib/components/GitLabSettings.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import type { GitLabSettingsInterface } from '$lib/types';
  import { GitLabService } from '../services/GitLabService';
  import { Button } from '$lib/components/ui/button';
  import Help from '$lib/components/Help.svelte';
  import ProjectStatus from '$lib/components/ProjectStatus.svelte';
  import { ConnectionManager } from '../lib/ConnectionManager';

  let gitlabToken: string = '';
  let repoOwner = '';
  let repoName = '';
  let branch: string = '';
  let projectSettings: Record<string, { repoName: string; branch: string }> = {};
  let status = '';
  let uploadProgress = 0;
  let uploadStatus = 'idle';
  let uploadMessage = '';
  let isSettingsValid = false;
  let activeTab = 'home';
  let currentUrl: string = '';
  let isBoltSite: boolean = false;
  let gitlabSettings: GitLabSettingsInterface;
  let parsedProjectId: string | null = null;
  const version = chrome.runtime.getManifest().version;
  let hasStatus = false;
  let isValidatingToken = false;
  let isTokenValid: boolean | null = null;
  let validationError: string | null = null;
  let hasInitialSettings = false;
  let connectionManager: ConnectionManager;
  let isConnected = false;
  let connectionError: string | null = null;
  let hasConnectionError = false;
  let projectStatusRef: ProjectStatus;

  async function connectToBackground(): Promise<void> {
    try {
      if (!connectionManager) {
        connectionManager = new ConnectionManager('popup');
        
        connectionManager.onConnectionChange((connected) => {
          isConnected = connected;
          if (!connected) {
            connectionError = 'Connection lost. Please refresh the page.';
            hasConnectionError = true;
          } else {
            connectionError = null;
            hasConnectionError = false;
          }
        });

        connectionManager.onMessage((message) => {
          if (message.type === 'UPLOAD_STATUS') {
            uploadStatus = message.status.status;
            uploadProgress = message.status.progress || 0;
            uploadMessage = message.status.message || '';
          }
        });
      }

      await connectionManager.connect();
    } catch (error) {
      console.error('Failed to connect to background:', error);
      connectionError = 'Failed to connect. Please refresh the page.';
      hasConnectionError = true;
    }
  }

  async function validateGitLabToken(token: string, username: string): Promise<boolean> {
    if (!token) {
      isTokenValid = false;
      validationError = 'GitLab token is required';
      return false;
    }

    try {
      isValidatingToken = true;
      const gitlabService = new GitLabService(token);
      const result = await gitlabService.validateTokenAndUser(username);
      isTokenValid = result.isValid;
      validationError = result.error || null;
      return result.isValid;
    } catch (error) {
      console.error('Error validating settings:', error);
      isTokenValid = false;
      validationError = 'Validation failed';
      return false;
    } finally {
      isValidatingToken = false;
    }
  }

  $: console.log('repoOwner', repoOwner);

  onMount(async () => {
    // Add dark mode to the document
    document.documentElement.classList.add('dark');

    // Initialize connection manager
    await connectToBackground();
    if (!isConnected) {
      console.error('Failed to establish connection');
      status = 'Error connecting to extension. Please refresh the page.';
      hasStatus = true;
      isSettingsValid = false;
    }

    try {
      gitlabSettings = (await chrome.storage.sync.get([
        'gitlabToken',
        'repoOwner',
        'repoName',
        'branch',
        'repositoryUrl',
        'projectSettings',
      ])) as GitLabSettingsInterface;
      
      // Initialize with empty values if not set
      gitlabToken = gitlabSettings.gitlabToken || '';
      repoOwner = gitlabSettings.repoOwner || '';
      repoName = gitlabSettings.repoName || '';
      branch = gitlabSettings.branch || 'main';
      projectSettings = gitlabSettings.projectSettings || {};

      // Load URL history
      const { projectUrlHistory = [] } = await chrome.storage.local.get('projectUrlHistory');
      if (gitlabSettings.repositoryUrl) {
        const history = [
          { url: gitlabSettings.repositoryUrl, branch, lastUsed: Date.now() },
          ...projectUrlHistory.filter(h => h.url !== gitlabSettings.repositoryUrl).slice(0, 9)
        ];
        await chrome.storage.local.set({ projectUrlHistory: history });
      }
      
      // Only mark as having initial settings if we have both required fields
      hasInitialSettings = Boolean(gitlabSettings.gitlabToken && gitlabSettings.repoOwner);
      
      // Validate existing token and username if they exist
      if (gitlabToken && repoOwner) {
        await validateGitLabToken(gitlabToken, repoOwner);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      status = 'Error loading settings. Please try again.';
      hasStatus = true;
      isSettingsValid = false;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log(`📄 App: ${tabs[0]?.url}`);
    if (tabs[0]?.url) {
      currentUrl = tabs[0].url;
      isBoltSite = currentUrl.includes('bolt.new');

      if (isBoltSite) {
        const match = currentUrl.match(/bolt\.new\/~\/([^/]+)/);
        parsedProjectId = match?.[1] || null;
        console.log(`📄 App: ${parsedProjectId}`);
        // Get projectId from storage
        const projectId = await chrome.storage.sync.get('projectId');

        if (match && parsedProjectId && projectId.projectId === parsedProjectId) {
          if (projectSettings[parsedProjectId]) {
            repoName = projectSettings[parsedProjectId].repoName;
            branch = projectSettings[parsedProjectId].branch || 'main';
          } else {
            // Initialize default settings for new project
            projectSettings[parsedProjectId] = {
              repoName: parsedProjectId,
              branch: 'main'
            };
            await saveSettings();
          }
        }
      }
    }

    checkSettingsValidity();

    // Message handling is now done through ConnectionManager

  });

  async function checkSettingsValidity() {
    try {
      const validation = validateSettings();
      isSettingsValid = validation.isValid && !isValidatingToken && isTokenValid === true;

      // Ensure settings are saved after validation
      if (isSettingsValid) {
        await saveSettings();
      }
    } catch (error) {
      console.error('Error checking settings validity:', error);
      isSettingsValid = false;
      status = error instanceof Error ? error.message : 'Error validating settings';
      hasStatus = true;
    }
  }

  function validateSettings(): { isValid: boolean; error?: string } {
    if (!gitlabToken) {
      return { isValid: false, error: 'GitLab token is required' };
    }
    if (!repoOwner) {
      return { isValid: false, error: 'Repository owner is required' };
    }
    if (parsedProjectId && !repoName) {
      return { isValid: false, error: 'Repository name is required for the current project' };
    }
    return { isValid: true };
  }

  async function saveSettings() {
    try {
      // Validate settings first
      const validation = validateSettings();
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      // Validate token and username with GitLab
      const isValid = await validateGitLabToken(gitlabToken, repoOwner);
      if (!isValid) {
        throw new Error(validationError || 'GitLab token validation failed');
      }

      const settings = {
        gitlabToken: gitlabToken,
        repoOwner: repoOwner,
        repoName: repoName,
        branch: branch,
        repositoryUrl: gitlabSettings.repositoryUrl,
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
    } catch (error) {
      console.error('Error saving settings:', error);
      status = error instanceof Error ? error.message : 'Error saving settings';
      hasStatus = true;
      isSettingsValid = false;
    }
  }

  function handleSwitchTab(event: CustomEvent<string>) {
    activeTab = event.detail;
  }
</script>

<main class="w-[400px] p-3 bg-slate-950 text-slate-50">
  <Card class="border-slate-800 bg-slate-900">
    <CardHeader>
      <CardTitle class="flex items-center gap-2">
        <img src="/assets/icons/icon48.png" alt="Bolt to GitLab" class="w-5 h-5" />
        Bolt to GitLab <span class="text-xs text-slate-400">v{version}</span>
      </CardTitle>
      <CardDescription class="text-slate-400">
        Upload and sync your Bolt projects to GitLab
      </CardDescription>
    </CardHeader>
    <CardContent>
      {#if isBoltSite && parsedProjectId}
        <Tabs bind:value={activeTab} class="w-full">
          <Header />

          <TabsContent value="home">
            <button
              class="w-full mb-3 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-md text-slate-200 transition-colors"
              on:click={() => (activeTab = 'projects')}
            >
              View All Projects
            </button>

            {#if !isSettingsValid || !parsedProjectId}
              <StatusAlert on:switchTab={handleSwitchTab} />
            {:else}
              <ProjectStatus
                bind:this={projectStatusRef}
                projectId={parsedProjectId}
                gitLabUsername={repoOwner}
                {repoName}
                {branch}
                token={gitlabToken}
                on:switchTab={handleSwitchTab}
              />
            {/if}


          </TabsContent>


          <TabsContent value="settings">
            <Card class="border-slate-800 bg-slate-900">
              <CardHeader>
                <CardTitle>GitLab Settings</CardTitle>
                <CardDescription class="text-slate-400">
                  Configure your GitLab repository settings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <GitLabSettings
                  bind:gitlabToken
                  bind:repoOwner
                  bind:repoName
                  bind:branch
                  projectId={parsedProjectId}
                  {status}
                  buttonDisabled={hasStatus}
                  onSave={saveSettings}
                  onInput={checkSettingsValidity}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="help">
            <Help />
          </TabsContent>
        </Tabs>
      {:else if hasInitialSettings && repoOwner && gitlabToken}
        <div class="flex flex-col items-center justify-center p-4 text-center space-y-6">
          <div class="space-y-2">
            <Button
              variant="outline"
              class="border-slate-800 hover:bg-slate-800 text-slate-200"
              on:click={() => window.open('https://bolt.new', '_blank')}
            >
              Go to bolt.new
            </Button>
          </div>
        </div>
      {:else}
        <div class="flex flex-col items-center justify-center p-4 text-center space-y-6">
          <div class="space-y-2">
            {#if !isBoltSite}
              <Button
                variant="outline"
                class="border-slate-800 hover:bg-slate-800 text-slate-200"
                on:click={() => window.open('https://bolt.new', '_blank')}
              >
                Go to bolt.new
              </Button>
            {/if}
            <p class="text-sm text-green-400">
              💡 No Bolt projects found. Create or load an existing Bolt project to get started.
            </p>
            <p class="text-sm text-green-400 pb-4">
              🌟 You can also load any of your GitLab repositories by providing your GitLab token
              and repository owner.
            </p>
            <GitLabSettings
              isOnboarding={true}
              bind:gitlabToken
              bind:repoName
              bind:branch
              bind:repoOwner
              {status}
              buttonDisabled={hasStatus}
              onSave={saveSettings}
              onInput={checkSettingsValidity}
            />
          </div>
        </div>
      {/if}
    </CardContent>
    <Footer />
  </Card>

</main>

<style>
  :global(.lucide) {
    stroke-width: 1.5px;
  }
</style>
