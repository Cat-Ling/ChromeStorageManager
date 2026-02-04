/**
 * Overlay App Logic (ES Module)
 */
import { DataGrid } from '/popup/components/DataGrid.js';
import { CodeEditor } from '/popup/components/CodeEditor.js';
// We can re-use Managers if they don't depend on "popup-only" chrome APIs.
// PageStorageManager depends on `chrome.tabs.sendMessage` -> BAD for content script (it's already in page).
// CookiesManager depends on `chrome.cookies` -> BAD (needs background).
// So we need specific logic here.

export class OverlayApp {
    constructor(root, shadow) {
        this.root = root;
        this.shadow = shadow;
        this.container = this.shadow.querySelector('.overlay-window');
        this.editor = null;

        this.init();
    }

    async init() {
        this.editor = new CodeEditor(this.container);
        // Fix Editor containment since it appends to body by default
        // We need to patch CodeEditor to append to our shadow container's body or specific target
        // Actually CodeEditor.js provided previously appended to document.body. 
        // We might need to modify CodeEditor to accept a root.
        // Let's monkey patch or just adjust the class if possible.
        // Checking CodeEditor.js... it does `document.body.appendChild`. We need to fix that.

        this.setupNavigation();
        this.loadView('cookies');
    }

    setupNavigation() {
        const navItems = this.shadow.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                navItems.forEach(n => n.classList.remove('active'));
                item.classList.add('active');
                this.loadView(item.dataset.target);
            });
        });
    }

    async loadView(target) {
        const mount = this.shadow.getElementById('content-mount');
        const title = this.shadow.getElementById('current-view-title');
        title.textContent = target; // Capitalize?
        mount.innerHTML = '<div class="empty-state">Loading...</div>';

        try {
            if (target === 'cookies') {
                const cookies = await chrome.runtime.sendMessage({ type: 'getCookies' });
                this.renderCookies(mount, cookies);
            }
            else if (target === 'local-storage') {
                this.renderStorage(mount, localStorage, 'localStorage');
            }
            else if (target === 'session-storage') {
                this.renderStorage(mount, sessionStorage, 'sessionStorage');
            }
            else if (target === 'indexed-db') {
                this.renderIndexedDB(mount);
            }
            else if (target === 'cache') {
                this.renderCache(mount);
            }
        } catch (e) {
            mount.innerHTML = `<div style="color:var(--danger)">Error: ${e.message}</div>`;
        }
    }

    renderCookies(container, cookies) {
        const grid = new DataGrid(container, {
            columns: [
                { key: 'name', label: 'Name', width: '200px' },
                { key: 'value', label: 'Value' },
                { key: 'domain', label: 'Domain', width: '150px' }
            ],
            onEdit: (item) => {
                this.openEditor(item.value, 'text', async (val) => {
                    // Stub
                    console.log('Update cookie', val);
                });
            },
            onDelete: async (item) => {
                // Send delete msg
                console.log('Delete cookie', item);
            }
        });
        grid.render(cookies);
    }

    renderStorage(container, storage, type) {
        const data = Object.entries(storage).map(([k, v]) => ({ key: k, value: v }));
        const grid = new DataGrid(container, {
            columns: [{ key: 'key', label: 'Key', width: '200px' }, { key: 'value', label: 'Value' }],
            onEdit: (item) => {
                this.openEditor(item.value, 'json', (val) => {
                    storage.setItem(item.key, val);
                    this.loadView(type === 'localStorage' ? 'local-storage' : 'session-storage');
                });
            },
            onDelete: (item) => {
                storage.removeItem(item.key);
                this.loadView(type === 'localStorage' ? 'local-storage' : 'session-storage');
            }
        });
        grid.render(data);
    }

    async renderIndexedDB(container) {
        // Native access to IDB
        const dbs = await window.indexedDB.databases();
        if (!dbs || dbs.length === 0) {
            container.innerHTML = '<div class="empty-state">No DBs found</div>';
            return;
        }

        const list = document.createElement('div');
        list.className = 'db-list';
        list.style.padding = '16px';

        dbs.forEach(db => {
            const card = document.createElement('div');
            card.innerHTML = `<h3>${db.name} (v${db.version})</h3>`;
            const stores = document.createElement('div');
            // We can't synchronously get stores without opening. 
            // `indexedDB.databases` returns name/version (and sometimes stores depending on browser implementation).
            // Chrome usually returns generic info.

            const btn = document.createElement('button');
            btn.textContent = 'Explore';
            btn.className = 'btn btn-secondary';
            btn.onclick = () => this.exploreDB(container, db.name);
            card.appendChild(btn);
            list.appendChild(card);
        });

        container.innerHTML = '';
        container.appendChild(list);
    }

    async exploreDB(container, dbName) {
        // Open DB
        const req = indexedDB.open(dbName);
        req.onsuccess = (e) => {
            const db = e.target.result;
            const storeNames = [...db.objectStoreNames];
            db.close();

            // Render Stores
            container.innerHTML = `
            <div style="padding:16px;">
                <button class="btn btn-secondary back-btn">← Back</button>
                <h3>${dbName}</h3>
                <div style="display:flex; gap:8px; margin-top:8px;">
                    ${storeNames.map(s => `<button class="store-btn btn btn-secondary" data-store="${s}">${s}</button>`).join('')}
                </div>
                <div id="store-view"></div>
            </div>
          `;

            container.querySelector('.back-btn').onclick = () => this.renderIndexedDB(container);
            container.querySelectorAll('.store-btn').forEach(b => {
                b.onclick = () => this.readStore(container.querySelector('#store-view'), dbName, b.dataset.store);
            });
        };
    }

    async readStore(container, dbName, storeName) {
        const db = await new Promise(r => {
            const req = indexedDB.open(dbName);
            req.onsuccess = e => r(e.target.result);
        });
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const items = await new Promise(r => {
            store.getAll().onsuccess = e => r(e.target.result);
        });
        const keys = await new Promise(r => {
            store.getAllKeys().onsuccess = e => r(e.target.result);
        });
        db.close();

        const data = items.map((val, i) => ({ key: keys[i], value: val }));

        const grid = new DataGrid(container, {
            columns: [{ key: 'key', label: 'Key' }, { key: 'value', label: 'Value' }],
            onEdit: (item) => {
                this.openEditor(item.value, 'json', (v) => console.log('IDB Edit stub', v));
            }
        });
        grid.render(data);
    }

    async renderCache(container) {
        const keys = await window.caches.keys();
        if (keys.length === 0) {
            container.innerHTML = '<div class="empty-state">No Caches found</div>';
            return;
        }

        container.innerHTML = `
        <div style="padding:16px">
            <h3>Caches</h3>
            <div style="display:flex; gap:8px;">
                ${keys.map(k => `<button class="cache-btn btn btn-secondary" data-key="${k}">${k}</button>`).join('')}
            </div>
            <div id="cache-view"></div>
        </div>
      `;

        container.querySelectorAll('.cache-btn').forEach(b => {
            b.onclick = () => this.readCache(container.querySelector('#cache-view'), b.dataset.key);
        });
    }

    async readCache(container, cacheName) {
        container.innerHTML = 'Loading cache...';
        const cache = await window.caches.open(cacheName);
        const requests = await cache.keys();

        const data = await Promise.all(requests.map(async req => {
            const res = await cache.match(req);
            // Get text or blob?
            // For now, just show URL and status
            return {
                url: req.url,
                method: req.method,
                status: res.status,
                type: res.type
            };
        }));

        const grid = new DataGrid(container, {
            columns: [
                { key: 'url', label: 'URL', width: '300px' },
                { key: 'method', label: 'Method', width: '80px' },
                { key: 'status', label: 'Status', width: '80px' }
            ]
        });
        grid.render(data);
    }

    openEditor(content, lang, onSave) {
        // Check if CodeEditor modal exists in shadow
        // Since CodeEditor creates its own modal in 'container', we need to make sure we passed the right container
        // The updated CodeEditor (which we need to modify) should append to a specific root

        // Workaround: We will query for .editor-modal in shadow. If not found, creating new CodeEditor appended to shadow host?
        // Actually the simpler way is to patch CodeEditor class to accept a 'mountRoot'
        // For now, let's assume I patch CodeEditor.js in next step.
        // OR: we manually force it here.

        // Quick hack: temporarily shim document.body.appendChild if possible? No.

        // We will rely on `this.editor` already initialized with `this.container` (shadow container)
        this.editor.open(content, lang, onSave);
    }
}
