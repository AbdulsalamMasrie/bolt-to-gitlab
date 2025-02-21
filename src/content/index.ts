// src/content/index.ts
import { ContentManager } from './ContentManager';

// Initialize immediately since content scripts have access to chrome APIs
console.log('🚀 Content script initializing...', {
  url: window.location.href,
  timestamp: new Date().toISOString(),
  runtime: chrome.runtime?.id,
  manifest: chrome.runtime.getManifest()
});

// Add more detailed error logging
try {
  if (!chrome.runtime?.id) {
    throw new Error('Chrome runtime not available. Extension context may be invalidated.');
  }

  ContentManager.create().catch(error => {
    console.error('Failed to initialize content script:', error, {
      url: window.location.href,
      timestamp: new Date().toISOString(),
      runtime: chrome.runtime?.id,
      manifest: chrome.runtime.getManifest()
    });
  });
} catch (error) {
  console.error('Critical error in content script initialization:', error, {
    url: window.location.href,
    timestamp: new Date().toISOString()
  });
}

// Export for extension updates/reloads if needed
export const onExecute = async ({ perf }: { perf: { injectTime: number; loadTime: number } }) => {
  console.log('🚀 Content script reinitializing...', perf);
  const manager = await ContentManager.create();
  await manager.reinitialize();
};
