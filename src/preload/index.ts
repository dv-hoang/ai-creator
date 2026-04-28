import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronApi } from '@shared/types';

const api: ElectronApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
    validateProvider: (provider, apiKey) => ipcRenderer.invoke('settings:validateProvider', provider, apiKey),
    listModels: (provider, apiKey) => ipcRenderer.invoke('settings:listModels', provider, apiKey),
    testVoice: (settings, sampleText) => ipcRenderer.invoke('settings:testVoice', settings, sampleText),
    checkForUpdates: () => ipcRenderer.invoke('settings:checkForUpdates')
  },
  projects: {
    list: (options) => ipcRenderer.invoke('projects:list', options),
    create: (input) => ipcRenderer.invoke('projects:create', input),
    getWorkspace: (projectId) => ipcRenderer.invoke('projects:getWorkspace', projectId),
    retryGenerateScript: (projectId) => ipcRenderer.invoke('projects:retryGenerateScript', projectId),
    archive: (projectId) => ipcRenderer.invoke('projects:archive', projectId),
    unarchive: (projectId) => ipcRenderer.invoke('projects:unarchive', projectId)
  },
  characters: {
    updatePrompt: (characterId, prompt) => ipcRenderer.invoke('characters:updatePrompt', characterId, prompt),
    linkAsset: (characterId, assetId) => ipcRenderer.invoke('characters:linkAsset', characterId, assetId),
    generateImage: (characterId) => ipcRenderer.invoke('characters:generateImage', characterId)
  },
  scenes: {
    updatePrompts: (sceneId, prompts) => ipcRenderer.invoke('scenes:updatePrompts', sceneId, prompts),
    generateImage: (sceneId) => ipcRenderer.invoke('scenes:generateImage', sceneId),
    generateVideo: (sceneId, firstFrameAssetId) => ipcRenderer.invoke('scenes:generateVideo', sceneId, firstFrameAssetId)
  },
  assets: {
    listByProject: (projectId) => ipcRenderer.invoke('assets:listByProject', projectId),
    download: (projectId, assetIds) => ipcRenderer.invoke('assets:download', projectId, assetIds)
  },
  transcript: {
    untimedText: (projectId) => ipcRenderer.invoke('transcript:untimedText', projectId),
    exportSrt: (projectId) => ipcRenderer.invoke('transcript:exportSrt', projectId),
    generateSpeech: (projectId, options) => ipcRenderer.invoke('transcript:generateSpeech', projectId, options),
    generateSpeechAllInOne: (projectId, options) =>
      ipcRenderer.invoke('transcript:generateSpeechAllInOne', projectId, options),
    generateSpeechForScene: (sceneId, options) =>
      ipcRenderer.invoke('transcript:generateSpeechForScene', sceneId, options),
    updateRow: (transcriptId, patch) => ipcRenderer.invoke('transcript:updateRow', transcriptId, patch),
    updateSpeakerVoice: (projectId, speaker, voiceId) =>
      ipcRenderer.invoke('transcript:updateSpeakerVoice', projectId, speaker, voiceId)
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    updateFromLatestRelease: (repo?: string) =>
      ipcRenderer.invoke('app:updateFromLatestRelease', repo)
  }
};

contextBridge.exposeInMainWorld('electronApi', api);
