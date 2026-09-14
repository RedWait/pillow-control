import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("pillow", {
  state: () => ipcRenderer.invoke("state"),
  action: (action: string, address?: string) =>
    ipcRenderer.invoke("action", action, address),
  subscribe: (callback: (state: unknown) => void) => {
    const listener = (_: unknown, state: unknown) => callback(state);
    ipcRenderer.on("state", listener);
    return () => ipcRenderer.removeListener("state", listener);
  },
});
