/**
 * Storage Manager Overlay
 * Injected into the page. Runs in the context of the page (if direct injection) or isolated world?
 * Wait, for Cache/IndexDB access WE NEED MAIN WORLD access usually for the cleanest API usage,
 * but Content Scripts run in isolated worlds.
 * Isolated worlds CAN access DOM and Cache/IndexDB of the origin, so we are good!
 */

// Verify singleton
if (window.__storageManagerOverlay) {
    // If already exists, toggle visibility
    window.__storageManagerOverlay.toggle();
} else {
    initOverlay();
}

function initOverlay() {
    const host = document.createElement('div');
    host.id = 'storage-manager-host';
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.left = '0';
    host.style.zIndex = '2147483647'; // Max z-index
    host.style.pointerEvents = 'none'; // Passthrough when minimized/hidden

    const shadow = host.attachShadow({ mode: 'open' });

    // Inject CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content/overlay.css');
    shadow.appendChild(link);

    // Also inject component CSS since we are in shadow DOM
    const gridCss = document.createElement('link');
    gridCss.rel = 'stylesheet';
    gridCss.href = chrome.runtime.getURL('popup/components/DataGrid.css');
    shadow.appendChild(gridCss);

    const editorCss = document.createElement('link');
    editorCss.rel = 'stylesheet';
    editorCss.href = chrome.runtime.getURL('popup/components/CodeEditor.css');
    shadow.appendChild(editorCss);

    // Common styling (popup.css adaptation)
    const popupCss = document.createElement('link');
    popupCss.rel = 'stylesheet';
    popupCss.href = chrome.runtime.getURL('popup/popup.css');
    shadow.appendChild(popupCss);

    // CM CSS
    // We need to inject CodeMirror CSS differently or ensure its vars work in ShadowDOM
    // For now let's link them
    ['codemirror.css', 'dracula.css'].forEach(f => {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = chrome.runtime.getURL(`popup/lib/codemirror/${f}`);
        shadow.appendChild(l);
    });


    // Window Container
    const container = document.createElement('div');
    container.className = 'overlay-window';
    container.style.pointerEvents = 'auto'; // Re-enable pointer events for the window

    container.innerHTML = `
    <header class="window-header" id="drag-handle">
      <div class="brand">
        <span>⚡ Storage Manager</span>
      </div>
      <div class="window-controls">
        <button class="win-btn minimize" title="Minimize">_</button>
        <button class="win-btn maximize" title="Maximize">□</button>
        <button class="win-btn close" title="Close">×</button>
      </div>
    </header>
    <div class="app-body" id="app-mount">
      <!-- App Content Matches popup.html structure -->
      <div class="app-container" style="height: 100%;">
        <aside class="sidebar">
          <nav class="nav-menu">
            <div class="nav-item active" data-target="cookies"><span>Cookies</span></div>
            <div class="nav-item" data-target="local-storage"><span>Local Storage</span></div>
            <div class="nav-item" data-target="session-storage"><span>Session Storage</span></div>
            <div class="nav-item" data-target="indexed-db"><span>IndexedDB</span></div>
            <div class="nav-item" data-target="cache"><span>Cache Storage</span></div>
          </nav>
        </aside>
        <main class="main-content">
          <header class="header">
            <h2 class="page-title" id="current-view-title">Cookies</h2>
          </header>
          <div class="content-area" id="content-mount">
            <div class="empty-state">Select a storage type.</div>
          </div>
        </main>
      </div>
    </div>
  `;

    shadow.appendChild(container);
    document.body.appendChild(host);

    // Setup Manager Class
    class OverlayController {
        constructor(root) {
            this.root = root;
            this.container = root.querySelector('.overlay-window');
            this.isMinimized = false;
            this.isMaximized = false;
            this.isVisible = true;

            this.bindEvents();
            this.makeDraggable();

            // Import Logic Dynamically to initialize
            this.initializeLogic();
        }

        toggle() {
            this.isVisible = !this.isVisible;
            this.root.host.style.display = this.isVisible ? 'block' : 'none';
        }

        bindEvents() {
            this.root.querySelector('.minimize').onclick = () => this.minimize();
            this.root.querySelector('.maximize').onclick = () => this.maximize();
            this.root.querySelector('.close').onclick = () => {
                this.isVisible = false;
                this.root.host.style.display = 'none';
            };
        }

        minimize() {
            this.isMinimized = !this.isMinimized;
            this.container.classList.toggle('minimized', this.isMinimized);
        }

        maximize() {
            this.isMaximized = !this.isMaximized;
            this.container.classList.toggle('maximized', this.isMaximized);
            this.container.style.top = this.isMaximized ? '0' : '100px';
            this.container.style.left = this.isMaximized ? '0' : '100px';
        }

        makeDraggable() {
            const handle = this.root.getElementById('drag-handle');
            let isDragging = false;
            let startX, startY, initialLeft, initialTop;

            handle.addEventListener('mousedown', (e) => {
                if (this.isMaximized) return;
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                const rect = this.container.getBoundingClientRect();
                initialLeft = rect.left;
                initialTop = rect.top;
                this.container.classList.add('dragging');
            });

            window.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                this.container.style.left = `${initialLeft + dx}px`;
                this.container.style.top = `${initialTop + dy}px`;
            });

            window.addEventListener('mouseup', () => {
                isDragging = false;
                this.container.classList.remove('dragging');
            });
        }

        async initializeLogic() {
            try {
                const src = chrome.runtime.getURL('content/overlay-app.js');
                const module = await import(src);
                // Initialize the App
                this.app = new module.OverlayApp(this, this.root);
            } catch (e) {
                console.error('Failed to load Overlay App:', e);
                this.root.getElementById('content-mount').innerHTML = `<div style="color:red">Failed to load app: ${e.message}</div>`;
            }
        }
    }

    // Attach controller to window for debugging/toggling
    window.__storageManagerOverlay = new OverlayController(shadow);
}
