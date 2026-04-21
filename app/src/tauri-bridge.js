// Bridge Tauri : expose une API compatible `window.electronAPI`
// en s'appuyant sur les commandes Rust définies dans src-tauri/src/lib.rs.

export async function setupTauriBridge() {
  if (typeof window === 'undefined' || !window.__TAURI_INTERNALS__) {
    return false;
  }

  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');

  window.__IS_TAURI__ = true;

  window.electronAPI = {
    async openFile() {
      return await invoke('open_file');
    },

    async saveFile({ path, content }) {
      await invoke('save_file', { path, content });
      invoke('notify', {
        title: 'Markdownitor',
        body: `Fichier enregistré : ${fileName(path)}`,
      }).catch(() => {});
    },

    async saveFileAs({ content }) {
      const path = await invoke('save_file_as', { content });
      if (!path) return null;
      invoke('notify', {
        title: 'Markdownitor',
        body: `Fichier enregistré : ${fileName(path)}`,
      }).catch(() => {});
      return { path };
    },

    setWindowTitle(title) {
      invoke('set_window_title', { title }).catch((e) =>
        console.error('set_window_title failed', e),
      );
    },

    onMenuAction(callback) {
      listen('menu-action', (event) => callback(event.payload));
    },

    onBeforeClose(callback) {
      listen('before-close', () => callback());
    },

    confirmClose(ok) {
      invoke('confirm_close', { ok }).catch((e) =>
        console.error('confirm_close failed', e),
      );
    },
  };

  return true;
}

function fileName(p) {
  return p ? p.split(/[\\/]/).pop() : '';
}
