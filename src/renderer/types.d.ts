import type { ElectronApi } from '@shared/types';

declare global {
  interface Window {
    electronApi: ElectronApi;
  }
}

export {};
