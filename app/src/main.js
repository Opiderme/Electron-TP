import { marked } from 'marked';
import hljs from 'highlight.js';
import { setupTauriBridge } from './tauri-bridge.js';

// Installe window.electronAPI si on tourne dans Tauri (avant toute détection)
await setupTauriBridge();

// ─── Configuration de marked ─────────────────────────────────────────────────
marked.setOptions({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true,
});

// ─── État de l'application ───────────────────────────────────────────────────
const state = {
  currentFile: null,    // chemin fichier (null en mode web)
  isDirty: false,
  view: 'split',
  theme: 'dark',
  isDraggingDivider: false,
};

// ─── Éléments DOM ────────────────────────────────────────────────────────────
const editor      = document.getElementById('editor');
const preview     = document.getElementById('preview');
const workspace   = document.getElementById('workspace');
const fileInput   = document.getElementById('file-input');
const fileName    = document.getElementById('file-name');
const unsavedDot  = document.getElementById('unsaved-dot');
const cursorPos   = document.getElementById('cursor-pos');
const wordCount   = document.getElementById('word-count');
const charCount   = document.getElementById('char-count');
const divider     = document.getElementById('divider');

// ─── Détection contexte natif (Electron ou Tauri) ──────────────────────────
const isElectron = typeof window.electronAPI !== 'undefined';
const isTauri = window.__IS_TAURI__ === true;

if (isElectron) {
  const label = isTauri ? 'Mode Tauri' : 'Mode Electron';
  document.getElementById('web-warning').textContent = `✓ ${label} — toutes les fonctionnalités disponibles`;
  document.getElementById('web-warning').style.background = 'rgba(166,227,161,0.1)';
  document.getElementById('web-warning').style.color = 'var(--success)';
  document.getElementById('web-warning').style.borderColor = 'rgba(166,227,161,0.2)';
}

// ─── Rendu Markdown ───────────────────────────────────────────────────────────
function renderMarkdown() {
  const md = editor.value;
  preview.innerHTML = marked.parse(md);
  // Re-highlight les blocs de code non gérés par marked
  preview.querySelectorAll('pre code:not(.hljs)').forEach(el => hljs.highlightElement(el));
}

// ─── Mise à jour stats ────────────────────────────────────────────────────────
function updateStats() {
  const text = editor.value;
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  const chars = text.length;
  wordCount.textContent = `${words} mot${words !== 1 ? 's' : ''}`;
  charCount.textContent = `${chars} caractère${chars !== 1 ? 's' : ''}`;
}

function updateCursorPos() {
  const pos  = editor.selectionStart;
  const text = editor.value.substring(0, pos);
  const line = (text.match(/\n/g) || []).length + 1;
  const col  = pos - text.lastIndexOf('\n');
  cursorPos.textContent = `Ln ${line}, Col ${col}`;
}

// ─── Gestion du titre / état non sauvegardé ────────────────────────────────
function syncWindowTitle() {
  if (!isElectron || !window.electronAPI.setWindowTitle) return;
  const name = state.currentFile ? state.currentFile.split(/[\\/]/).pop() : 'Sans titre';
  const mark = state.isDirty ? ' •' : '';
  window.electronAPI.setWindowTitle(`Markdownitor — ${name}${mark}`);
}

function setDirty(dirty) {
  state.isDirty = dirty;
  unsavedDot.classList.toggle('hidden', !dirty);

  if (isElectron && window.electronAPI.setWindowModified) {
    window.electronAPI.setWindowModified(dirty);
  }
  syncWindowTitle();
}

function setCurrentFile(filePath) {
  state.currentFile = filePath;
  if (filePath) {
    const name = filePath.split(/[\\/]/).pop();
    fileName.textContent = `— ${name}`;
  } else {
    fileName.textContent = '— Sans titre';
  }
  syncWindowTitle();
}

// ─── Toast notifications ───────────────────────────────────────────────────
function toast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ─── Opérations fichier ───────────────────────────────────────────────────────
async function openFile() {
  if (isElectron) {
    // ✅ Electron : dialogue natif
    const result = await window.electronAPI.openFile();
    if (result) {
      editor.value = result.content;
      setCurrentFile(result.path);
      setDirty(false);
      renderMarkdown();
      updateStats();
      toast(`Fichier ouvert : ${result.path.split(/[\\/]/).pop()}`);
    }
  } else {
    // ⚠ Web : fallback input[type=file]
    fileInput.click();
  }
}

async function saveFile() {
  if (isElectron) {
    if (state.currentFile) {
      await window.electronAPI.saveFile({ path: state.currentFile, content: editor.value });
      setDirty(false);
      toast('Fichier enregistré');
    } else {
      await saveFileAs();
    }
  } else {
    // ⚠ Web : téléchargement
    downloadFile();
    toast('Téléchargement démarré (mode navigateur)', 'warning');
  }
}

async function saveFileAs() {
  if (isElectron) {
    const result = await window.electronAPI.saveFileAs({ content: editor.value });
    if (result) {
      setCurrentFile(result.path);
      setDirty(false);
      toast(`Enregistré : ${result.path.split(/[\\/]/).pop()}`);
    }
  } else {
    downloadFile();
    toast('Téléchargement démarré (mode navigateur)', 'warning');
  }
}

function downloadFile() {
  const blob = new Blob([editor.value], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = state.currentFile?.split(/[\\/]/).pop() || 'document.md';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Ouverture via input[type=file] (fallback web) ────────────────────────
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    editor.value = e.target.result;
    setCurrentFile(file.name);
    setDirty(false);
    renderMarkdown();
    updateStats();
    toast(`Fichier ouvert : ${file.name}`);
  };
  reader.readAsText(file);
  fileInput.value = '';
});

// ─── Formatage texte ──────────────────────────────────────────────────────────
const formats = {
  bold:      { wrap: ['**', '**'],   default: 'texte en gras' },
  italic:    { wrap: ['*', '*'],     default: 'texte en italique' },
  code:      { wrap: ['`', '`'],     default: 'code' },
  link:      { wrap: ['[', '](url)'],default: 'lien' },
  h1:        { line: '# ',           default: 'Titre 1' },
  h2:        { line: '## ',          default: 'Titre 2' },
  h3:        { line: '### ',         default: 'Titre 3' },
  ul:        { line: '- ',           default: 'élément' },
  codeblock: { wrap: ['```\n', '\n```'], default: 'code' },
};

function applyFormat(formatKey) {
  const fmt  = formats[formatKey];
  const start = editor.selectionStart;
  const end   = editor.selectionEnd;
  const sel   = editor.value.substring(start, end);
  const text  = sel || fmt.default;
  let newText, cursorOff;

  if (fmt.wrap) {
    newText   = fmt.wrap[0] + text + fmt.wrap[1];
    cursorOff = fmt.wrap[0].length;
  } else {
    newText   = fmt.line + text;
    cursorOff = fmt.line.length;
  }

  editor.setRangeText(newText, start, end, 'select');
  if (!sel) {
    editor.selectionStart = start + cursorOff;
    editor.selectionEnd   = start + cursorOff + text.length;
  }
  editor.focus();
  renderMarkdown();
  setDirty(true);
}

// ─── Vue (split / editor / preview) ──────────────────────────────────────────
function setView(view) {
  state.view = view;
  workspace.className = `view-${view}`;

  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', btn.dataset.view === view ? 'true' : 'false');
  });

  if (view !== 'editor') renderMarkdown();
}

// ─── Redimensionnement du divider ─────────────────────────────────────────────
let startX = 0, startLeft = 0;

divider.addEventListener('mousedown', (e) => {
  state.isDraggingDivider = true;
  startX    = e.clientX;
  startLeft = document.getElementById('editor-pane').offsetWidth;
  divider.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!state.isDraggingDivider) return;
  const dx      = e.clientX - startX;
  const newLeft = Math.max(200, Math.min(window.innerWidth - 200, startLeft + dx));
  const pct     = (newLeft / workspace.offsetWidth) * 100;
  document.getElementById('editor-pane').style.flex = `0 0 ${pct}%`;
  document.getElementById('preview-pane').style.flex = `0 0 ${100 - pct}%`;
});

document.addEventListener('mouseup', () => {
  if (state.isDraggingDivider) {
    state.isDraggingDivider = false;
    divider.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

// ─── Thème ────────────────────────────────────────────────────────────────────
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme === 'light' ? 'light' : '');
  localStorage.setItem('markdownitor-theme', state.theme);
}

// ─── Raccourcis clavier ───────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    switch (e.key) {
      case 'o': e.preventDefault(); openFile(); break;
      case 's':
        e.preventDefault();
        if (e.shiftKey) saveFileAs(); else saveFile();
        break;
      case 'b': e.preventDefault(); applyFormat('bold');   break;
      case 'i': e.preventDefault(); applyFormat('italic'); break;
    }
  }
  // Tab → insérer 2 espaces dans l'éditeur
  if (e.key === 'Tab' && document.activeElement === editor) {
    e.preventDefault();
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    renderMarkdown();
  }
});

// ─── Listeners toolbar ────────────────────────────────────────────────────────
document.querySelectorAll('[data-action]').forEach(btn => {
  btn.addEventListener('click', () => {
    switch (btn.dataset.action) {
      case 'open':    openFile();    break;
      case 'save':    saveFile();    break;
      case 'save-as': saveFileAs();  break;
      case 'theme':   toggleTheme(); break;
    }
  });
});

document.querySelectorAll('[data-format]').forEach(btn => {
  btn.addEventListener('click', () => applyFormat(btn.dataset.format));
});

document.querySelectorAll('[data-view]').forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

// ─── Listener éditeur ────────────────────────────────────────────────────────
editor.addEventListener('input', () => {
  renderMarkdown();
  updateStats();
  setDirty(true);
});

editor.addEventListener('keyup', updateCursorPos);
editor.addEventListener('click', updateCursorPos);

// ─── À propos ─────────────────────────────────────────────────────────────────
document.getElementById('about-close').addEventListener('click', () => {
  document.getElementById('about-modal').classList.add('hidden');
  document.getElementById('modal-overlay').classList.add('hidden');
});

// ─── Menu Electron : écoute des commandes depuis le processus principal ───────
if (isElectron) {
  // Le menu natif enverra des événements via ipcRenderer
  window.electronAPI.onMenuAction?.((action) => {
    switch (action) {
      case 'open':    openFile();    break;
      case 'save':    saveFile();    break;
      case 'save-as': saveFileAs();  break;
      case 'about':
        document.getElementById('about-modal').classList.remove('hidden');
        document.getElementById('modal-overlay').classList.remove('hidden');
        break;
      case 'toggle-theme': toggleTheme(); break;
    }
  });

  // Confirmation avant fermeture si non sauvegardé
  window.electronAPI.onBeforeClose?.(() => {
    if (state.isDirty) {
      const ok = confirm('Des modifications non enregistrées seront perdues. Quitter quand même ?');
      window.electronAPI.confirmClose(ok);
    } else {
      window.electronAPI.confirmClose(true);
    }
  });
}

// ─── Contenu de démonstration ─────────────────────────────────────────────────
const DEMO_CONTENT = `# Bienvenue dans Markdownitor 📝

Cet éditeur Markdown est la **base de votre TP** sur l'intégration Electron.

## Ce que vous voyez ici

- Un éditeur avec **coloration syntaxique**
- Une prévisualisation en temps réel
- Des raccourcis clavier (\`Ctrl+S\`, \`Ctrl+O\`, etc.)
- Une barre d'état avec statistiques

## Ce qui manque (pour l'instant)

> ⚠️ En mode navigateur, certaines fonctionnalités sont limitées.

| Fonctionnalité | Web | Electron |
|---|:---:|:---:|
| Ouvrir un fichier .md | ⚠ (input) | ✅ Dialogue natif |
| Enregistrer sur le disque | ❌ | ✅ |
| Menu natif + raccourcis | ❌ | ✅ |
| Notifications OS | ❌ | ✅ |
| Zone de notification | ❌ | ✅ |
| Fermeture avec confirmation | ❌ | ✅ |

## Exemple de code

\`\`\`javascript
// Exemple d'IPC Electron
ipcMain.handle('save-file', async (event, { path, content }) => {
  await fs.writeFile(path, content, 'utf-8');
  return { success: true };
});
\`\`\`

## Markdown supporté

Texte en **gras**, en *italique*, du \`code inline\`, [des liens](https://electronjs.org).

---

*Commencez à éditer pour voir la prévisualisation se mettre à jour !*
`;

// ─── Initialisation ───────────────────────────────────────────────────────────
function init() {
  // Restaurer le thème
  const savedTheme = localStorage.getItem('markdownitor-theme');
  if (savedTheme) {
    state.theme = savedTheme;
    document.documentElement.setAttribute('data-theme', savedTheme === 'light' ? 'light' : '');
  }

  // Restaurer le contenu (ou afficher la démo)
  const savedContent = localStorage.getItem('markdownitor-content');
  editor.value = savedContent ?? DEMO_CONTENT;

  renderMarkdown();
  updateStats();
  updateCursorPos();

  // Auto-sauvegarde dans localStorage (web fallback)
  setInterval(() => {
    localStorage.setItem('markdownitor-content', editor.value);
  }, 5000);
}

init();
