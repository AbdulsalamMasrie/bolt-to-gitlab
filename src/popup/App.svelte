<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card';
  import Modal from '$lib/components/ui/modal/Modal.svelte';
  import { STORAGE_KEY } from '../background/TempRepoManager';
  import { Tabs, TabsContent } from '$lib/components/ui/tabs';
  import Header from '$lib/components/Header.svelte';
  import StatusAlert from '$lib/components/StatusAlert.svelte';
  import GitLabSettings from '$lib/components/GitLabSettings.svelte';
  import { GITLAB_LINK } from '$lib/constants';
  import Footer from '$lib/components/Footer.svelte';
  import type { GitLabSettingsInterface } from '$lib/types';
  import ProjectsList from '$lib/components/ProjectsList.svelte';
  import { GitLabService } from '../services/GitLabService';
  import { Button } from '$lib/components/ui/button';
  import Help from '$lib/components/Help.svelte';
  import ProjectStatus from '$lib/components/ProjectStatus.svelte';

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
  let showTempRepoModal = false;
  let tempRepoData: TempRepoMetadata | null = null;
  let port: chrome.runtime.Port;
  let hasDeletedTempRepo = false;
  let hasUsedTempRepoName = false;
  let projectStatusRef: ProjectStatus;
  const messageQueue: Array<{type: string, data: any}> = [];
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000;
  let retryCount = 0;

  interface TempRepoMetadata {
    originalRepo: string;
    tempRepo: string;
    createdAt: number;
    owner: string;
  }

  function sendMessage(type: string, data: any) {
    if (port) {
      try {
        port.postMessage({ type, data });
      } catch (error) {
        console.error('Error sending message:', error);
        messageQueue.push({ type, data });
      }
    } else {
      messageQueue.push({ type, data });
    }
  }

  async function connectToBackground(): Promise<chrome.runtime.Port | null> {
    try {
      const port = chrome.runtime.connect({ name: 'popup' });
      
      // Set up disconnect handler
      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        console.error('Port disconnected:', error?.message);
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          setTimeout(connectToBackground, RETRY_DELAY);
        }
      });
      
      return port;
    } catch (error) {
      console.error('Connection failed:', error);
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        return new Promise(resolve => 
          setTimeout(() => resolve(connectToBackground()), RETRY_DELAY)
        );
      }
      return null;
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

    // Initialize connection with retry logic
    port = await connectToBackground();
    if (!port) {
      console.error('Failed to establish connection after retries');
      status = 'Error connecting to extension. Please refresh the page.';
      hasStatus = true;
      isSettingsValid = false;
    }

    // Process queued messages when connection is established
    if (port && messageQueue.length > 0) {
      messageQueue.forEach(msg => {
        try {
          port.postMessage(msg);
        } catch (error) {
          console.error('Error sending queued message:', error);
        }
      });
      messageQueue.length = 0;
    }

    try {
      gitlabSettings = (await chrome.storage.sync.get([
        'gitlabToken',
        'repoOwner',
        'projectSettings',
      ])) as GitLabSettingsInterface;
      
      // Initialize with empty values if not set
      gitlabToken = gitlabSettings.gitlabToken || '';
      repoOwner = gitlabSettings.repoOwner || '';
      projectSettings = gitlabSettings.projectSettings || {};
      
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

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'UPLOAD_STATUS') {
        uploadStatus = message.status;
        uploadProgress = message.progress || 0;
        uploadMessage = message.message || '';
      }
    });

    // Check for temp repos
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const tempRepos: TempRepoMetadata[] = result[STORAGE_KEY] || [];

    if (tempRepos.length > 0 && parsedProjectId) {
      // Get the most recent temp repo
      tempRepoData = tempRepos[tempRepos.length - 1];
      showTempRepoModal = true;
    }
  });

  async function handleDeleteTempRepo() {
    if (tempRepoData) {
      sendMessage('DELETE_TEMP_REPO', {
        owner: tempRepoData.owner,
        repo: tempRepoData.tempRepo,
      });
      hasDeletedTempRepo = true;

      // Only close modal if both actions are completed
      if (hasDeletedTempRepo && hasUsedTempRepoName) {
        showTempRepoModal = false;
      }
    }
  }

  async function handleUseTempRepoName() {
    if (tempRepoData) {
      repoName = tempRepoData.originalRepo;
      await saveSettings();
      await projectStatusRef.getProjectStatus();
      hasUsedTempRepoName = true;

      // Only close modal if both actions are completed
      if (hasDeletedTempRepo && hasUsedTempRepoName) {
        showTempRepoModal = false;
      }
    }
  }

  async function checkSettingsValidity() {
    try {
      // Only consider settings valid if we have all required fields AND the validation passed
      isSettingsValid =
        Boolean(gitlabToken && repoOwner) &&
        !isValidatingToken &&
        isTokenValid === true;

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

  async function saveSettings() {
    try {
      // Ensure we have the minimum required settings
      if (!gitlabToken || !repoOwner) {
        throw new Error('Missing required settings');
      }

      // Validate token and username before saving
      const isValid = await validateGitLabToken(gitlabToken, repoOwner);
      if (!isValid) {
        throw new Error(validationError || 'Validation failed');
      }

      const settings = {
        gitlabToken: gitlabToken,
        repoOwner: repoOwner,
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

          <TabsContent value="projects">
            <ProjectsList
              {projectSettings}
              {repoOwner}
              token={gitlabToken}
              currentlyLoadedProjectId={parsedProjectId}
              {isBoltSite}
            />
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
        <ProjectsList
          {projectSettings}
          {repoOwner}
          token={gitlabToken}
          currentlyLoadedProjectId={parsedProjectId}
          {isBoltSite}
        />
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
  <Modal show={showTempRepoModal} title="Private Repository Import">
    <div class="space-y-4">
      <p class="text-amber-300 font-medium">
        It looks like you just imported a private GitLab repository. Would you like to:
      </p>

      <div class="space-y-2">
        {#if !hasDeletedTempRepo}
          <div class="space-y-2">
            <p class="text-sm text-slate-400">1. Clean up the temporary repository:</p>
            <Button
              variant="outline"
              class="w-full border-slate-700 hover:bg-slate-800"
              on:click={handleDeleteTempRepo}
            >
              Delete the temporary public repository now
            </Button>
          </div>
        {:else}
          <div
            class="text-sm text-green-400 p-2 border border-green-800 bg-green-900/20 rounded-md"
          >
            ✓ Temporary repository has been deleted
          </div>
        {/if}

        {#if !hasUsedTempRepoName}
          <div class="space-y-2">
            <p class="text-sm text-slate-400">2. Configure repository name:</p>
            <Button
              variant="outline"
              class="w-full border-slate-700 hover:bg-slate-800"
              on:click={handleUseTempRepoName}
            >
              Use original repository name ({tempRepoData?.originalRepo})
            </Button>
          </div>
        {:else}
          <div
            class="text-sm text-green-400 p-2 border border-green-800 bg-green-900/20 rounded-md"
          >
            ✓ Repository name has been configured
          </div>
        {/if}

        <Button
          variant="ghost"
          class="w-full text-slate-400 hover:text-slate-300"
          on:click={() => (showTempRepoModal = false)}
        >
          Dismiss
        </Button>
      </div>

      <p class="text-sm text-slate-400">
        Note: The temporary repository will be automatically deleted in 1 minute if not deleted
        manually.
      </p>
    </div>
  </Modal>
</main>

<style>
  :global(.lucide) {
    stroke-width: 1.5px;
  }
</style>
