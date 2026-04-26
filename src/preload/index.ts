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
    list: () => ipcRenderer.invoke('projects:list'),
    create: (input) => ipcRenderer.invoke('projects:create', input),
    getWorkspace: (projectId) => ipcRenderer.invoke('projects:getWorkspace', projectId),
    retryGenerateScript: (projectId) => ipcRenderer.invoke('projects:retryGenerateScript', projectId)
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
    generateSpeech: (projectId) => ipcRenderer.invoke('transcript:generateSpeech', projectId),
    generateSpeechAllInOne: (projectId) => ipcRenderer.invoke('transcript:generateSpeechAllInOne', projectId),
    generateSpeechForScene: (sceneId) => ipcRenderer.invoke('transcript:generateSpeechForScene', sceneId),
    updateRow: (transcriptId, patch) => ipcRenderer.invoke('transcript:updateRow', transcriptId, patch),
    updateSpeakerVoice: (projectId, speaker, voiceId) =>
      ipcRenderer.invoke('transcript:updateSpeakerVoice', projectId, speaker, voiceId)
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url)
  }
};

contextBridge.exposeInMainWorld('electronApi', api);
