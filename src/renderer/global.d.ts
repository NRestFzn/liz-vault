// Electron renderer with nodeIntegration enabled exposes `require` on window.
// Declared globally so every renderer file can use `window.require('electron')`.
declare global {
  interface Window {
    require: (module: string) => any;
  }
}

export {};
