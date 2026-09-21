import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('spotCanvasHost', {
  kind: 'desktop',
  layout: {
    read: (): Promise<string | null> => ipcRenderer.invoke('layout:read'),
    write: (json: string): Promise<void> => ipcRenderer.invoke('layout:write', json)
  }
});
