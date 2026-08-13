import type { IpcRenderer, WebUtils } from 'electron';

declare global {
  interface Window {
    require: (module: string) => { ipcRenderer: IpcRenderer; webUtils: WebUtils };
  }
}
