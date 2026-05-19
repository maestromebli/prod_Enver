const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("enverDesktop", {
  isDesktop: true,
  requestExit: () => ipcRenderer.invoke("kiosk:request-exit")
});
