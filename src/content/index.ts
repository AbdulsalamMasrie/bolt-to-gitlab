// src/content/index.ts
import { ContentManager } from './ContentManager';

console.log('🚀 Content script initializing...');
ContentManager.create().catch(error => {
  console.error('Failed to initialize content script:', error);
});

// Export for extension updates/reloads if needed
export const onExecute = async ({ perf }: { perf: { injectTime: number; loadTime: number } }) => {
  console.log('🚀 Content script reinitializing...', perf);
  const manager = await ContentManager.create();
  await manager.reinitialize();
};
