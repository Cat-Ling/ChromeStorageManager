/**
 * Main Popup Entry Point
 */
import { DataGrid } from './components/DataGrid.js';
import { CookiesManager } from './modules/CookiesManager.js';
import { PageStorageManager } from './modules/PageStorageManager.js';
import { IndexedDBManager } from './modules/IndexedDBManager.js';
import { CodeEditor } from './components/CodeEditor.js';

// Global Error Handler for Popup
window.addEventListener('error', (event) => {
    const mountPoint = document.getElementById('content-mount');
    if (mountPoint) {
        mountPoint.innerHTML = `
            <div style="padding: 16px; color: var(--danger);">
                <h3>An Error Occurred</h3>
                <pre style="white-space: pre-wrap; margin-top: 8px; font-size: 12px;">${event.message}</pre>
                <div style="margin-top:8px; font-size: 11px; color: var(--text-secondary);">${event.filename}:${event.lineno}</div>
            </div>
        `;
    }
});

window.addEventListener('unhandledrejection', (event) => {
    const mountPoint = document.getElementById('content-mount');
    if (mountPoint) {
        mountPoint.innerHTML = `
            <div style="padding: 16px; color: var(--danger);">
                <h3>Unhandled Promise Rejection</h3>
                <pre style="white-space: pre-wrap; margin-top: 8px; font-size: 12px;">${event.reason ? event.reason.message || event.reason : event.reason}</pre>
            </div>
        `;
    }
});

import { CacheManager } from './modules/CacheManager.js';

const cookiesManager = new CookiesManager();
const localStorageManager = new PageStorageManager('localStorage');
const sessionStorageManager = new PageStorageManager('sessionStorage');
const indexedDBManager = new IndexedDBManager();
const cacheManager = new CacheManager();
let editor = null;
let currentTabId = null;

// --- Image Preview Helper ---
function showImagePreview(src) {
    const modal = document.getElementById('image-modal');
    const img = document.getElementById('preview-image');
    const info = document.getElementById('preview-info');
    img.src = ''; // reset
    img.src = src;

    // basic info
    const size = Math.round(src.length * 0.75 / 1024);
    info.textContent = `${size} KB | ${src.substring(5, 20)}...`;

    modal.style.display = 'flex';
}

function renderValueWithPreviews(val, item) {
    if (typeof val === 'string' && val.startsWith('data:image/') && val.includes('base64,')) {
        // Return a button
        return `<button class="preview-btn" style="
            background: var(--bg-tertiary); 
            border: 1px solid var(--border-color); 
            color: var(--text-primary); 
            cursor: pointer; 
            font-size: 11px; 
            padding: 2px 6px; 
            border-radius: 4px; 
            display: inline-flex; 
            align-items: center; 
            gap: 4px;"
            data-src="${val.replace(/"/g, '&quot;')}"
            data-item-key="${item.name || item.key}"
        >📷 View Image</button>`;
    }
    // Deep State previews? 
    // If it's framework data, maybe just show [Object] unless expanded? - Already handled by DataGrid text limit
    return val;
}

document.addEventListener('DOMContentLoaded', () => {
    // Basic setup
    document.getElementById('close-modal').onclick = () => {
        document.getElementById('image-modal').style.display = 'none';
        document.getElementById('preview-image').src = '';
    };

    // Delegate grid clicks for previews
    document.body.addEventListener('click', (e) => {
        if (e.target.closest('.preview-btn')) {
            const btn = e.target.closest('.preview-btn');
            const src = btn.dataset.src;
            if (src) showImagePreview(src);
        }
    });
    try {
        console.log('Popup Initializing...');

        // Parse targetTabId from URL
        const params = new URLSearchParams(window.location.search);
        const paramId = params.get('targetTabId');
        if (paramId) {
            currentTabId = parseInt(paramId, 10);
            console.log('Targeting Tab ID:', currentTabId);
        }

        editor = new CodeEditor(document.body);
        setupNavigation();

        // Load default view (Cookies)
        const activeNav = document.querySelector('.nav-item.active');
        if (activeNav) {
            const target = activeNav.dataset.target;
            console.log('Loading default view:', target);
            loadView(target);
        }
    } catch (e) {
        console.error('Initialization failed:', e);
        throw e; // trigger window.onerror
    }
});

// Ensure debugger detaches when popup closes
window.addEventListener('unload', () => {
    debuggerManager.detach().catch(() => { });
});

function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const titleEl = document.getElementById('current-view-title');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            console.log('Nav clicked:', item.dataset.target);
            // Remove active class from all
            navItems.forEach(nav => nav.classList.remove('active'));
            // Add active to clicked
            item.classList.add('active');

            const target = item.dataset.target;
            titleEl.textContent = item.querySelector('span').textContent;

            loadView(target);
        });
    });
}

async function loadView(viewName) {
    const mountPoint = document.getElementById('content-mount');
    mountPoint.innerHTML = '<div class="empty-state">Loading...</div>';

    try {
        let tabId = currentTabId;
        let url = null;

        if (!tabId) {
            // Fallback to active tab query (legacy behavior)
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                tabId = tab.id;
                url = tab.url;
            }
        } else {
            // Get URL of target tab
            const tab = await chrome.tabs.get(tabId);
            url = tab.url;
        }

        if (!tabId || !url) {
            mountPoint.innerHTML = '<div class="empty-state">No target tab found.</div>';
            return;
        }

        console.log('Loading view for tab:', url);

        await cookiesManager.setUrl(url);
        // Setup cache manager
        cacheManager.setTabId(tabId);
        fsManager.setTabId(tabId);

        // Auto-detach debugger if leaving deep storage view
        // Auto-detach debugger if leaving deep storage or page vars view
        if (viewName !== 'deep-storage' && viewName !== 'page-vars') {
            debuggerManager.detach().catch(() => { });
        }

        switch (viewName) {
            case 'cookies':
                await renderCookies(mountPoint, url);
                break;
            case 'local-storage':
                await renderPageStorage(mountPoint, tabId, localStorageManager, 'localStorage');
                break;
            case 'session-storage':
                await renderPageStorage(mountPoint, tabId, sessionStorageManager, 'sessionStorage');
                break;
            case 'indexed-db':
                await renderIndexedDB(mountPoint, tabId);
                break;
            case 'cache':
                await renderCache(mountPoint);
                break;
            case 'file-system':
                await renderFileSystem(mountPoint);
                break;
            case 'quota':
                await renderQuota(mountPoint);
                break;
            case 'service-workers':
                await renderServiceWorkers(mountPoint);
                break;
            case 'deep-storage':
                await renderDeepStorage(mountPoint);
                break;
            case 'page-vars':
                await renderPageVariables(mountPoint);
                break;
            default:
                mountPoint.innerHTML = `<div class="empty-state">View ${viewName} not implemented yet.</div>`;
        }
    } catch (e) {
        console.error('Error in loadView:', e);
        mountPoint.innerHTML = `
            <div style="padding: 16px; color: var(--danger);">
                <h3>Failed to load view</h3>
                <pre style="white-space: pre-wrap; margin-top: 8px;">${e.message}</pre>
            </div>
        `;
    }
}

async function renderCache(container) {
    const keys = await cacheManager.getCaches();
    if (keys.length === 0) {
        container.innerHTML = '<div class="empty-state">No Caches found</div>';
        return;
    }

    container.innerHTML = `
    <div style="padding:16px;">
        <h3>Caches</h3>
        <div style="display:flex; gap:8px;">
            ${keys.map(k => `<button class="cache-btn nav-item" style="padding:4px 12px; border:1px solid var(--border-color);" data-key="${k}">${k}</button>`).join('')}
        </div>
        <div id="cache-view"></div>
    </div>`;

    container.querySelectorAll('.cache-btn').forEach(b => {
        b.onclick = () => readCache(container.querySelector('#cache-view'), b.dataset.key);
    });
}

async function readCache(container, cacheName) {
    container.innerHTML = 'Loading cache items...';
    try {
        const items = await cacheManager.getCacheItems(cacheName);
        const grid = new DataGrid(container, {
            columns: [
                { key: 'url', label: 'URL', width: '300px' },
                { key: 'method', label: 'Method' },
                { key: 'status', label: 'Status' }
            ]
        });
        grid.render(items);
    } catch (e) {
        container.innerHTML = 'Error loading cache';
    }
}

async function renderCookies(container, url) {
    const cookies = await cookiesManager.getAll();
    // Sort cookies alphabetically by Name to prevent jumping after edits
    cookies.sort((a, b) => a.name.localeCompare(b.name));


    const grid = new DataGrid(container, {
        columns: [
            { key: 'name', label: 'Name', width: '200px' },
            {
                key: 'value',
                label: 'Value',
                width: '300px',
                render: (val, item) => renderValueWithPreviews(val, item)
            },
            { key: 'domain', label: 'Domain', width: '150px' },
            {
                key: 'expirationDate',
                label: 'Expires',
                width: '150px',
                render: (val) => val ? new Date(val * 1000).toLocaleString() : 'Session'
            }
        ],
        onEdit: (item) => {
            editor.open(item.value, 'text', async (newVal) => {
                try {
                    // Create a copy of the item with the new value
                    const updatedCookie = { ...item, value: newVal };
                    await cookiesManager.set(updatedCookie);
                    loadView('cookies'); // Refresh view
                } catch (e) {
                    console.error('Failed to set cookie:', e);
                    alert(`Failed to save cookie: ${e.message}`);
                }
            }, item.name); // Unique key: cookie name
        },
        onDelete: async (item) => {
            await cookiesManager.delete(item);
            loadView('cookies'); // reload
        }
    });

    // Pass raw cookies to grid (don't convert date to string in the object itself)
    grid.render(cookies);
}

async function renderPageStorage(container, tabId, manager, type) {
    try {
        await manager.connect(tabId);
        const items = await manager.getAll();

        const grid = new DataGrid(container, {
            columns: [
                { key: 'key', label: 'Key', width: '200px' },
                { key: 'value', label: 'Value' }
            ],
            onEdit: (item) => {
                let val = item.value;
                let lang = 'text';

                // --- Robust LZ-String Detection ---
                let isCompressedObj = false;

                // 1. Fast Check: Look for marker ᯡ (0x1BE1) common in LZString UTF16
                // OR try decompress if it looks "gibberish" enough? 
                // We'll just try decompressing anything that isn't obviously plain JSON first.

                if (typeof val === 'string') {
                    try {
                        const decompressed = LZString.decompressFromUTF16(val);
                        // Validation: Must be non-empty and Valid JSON
                        if (decompressed && decompressed !== val) {
                            try {
                                // Check if it's JSON
                                const parsed = JSON.parse(decompressed);
                                // If we got here, it's valid compressed JSON
                                val = JSON.stringify(parsed, null, 2); // Pretty print
                                lang = 'json';
                                isCompressedObj = true;
                            } catch (e) {
                                // Decompressed but not JSON? Maybe just compressed text.
                                // Treat as text but mark as compressed
                                val = decompressed;
                                isCompressedObj = true;
                            }
                        }
                    } catch (e) { }
                }

                if (!isCompressedObj) {
                    // Regular JSON Check
                    try {
                        const parsed = JSON.parse(val);
                        val = JSON.stringify(parsed, null, 2);
                        lang = 'json';
                    } catch (e) {
                        // Plain text
                    }
                }

                editor.open(val, lang, async (newVal) => {
                    let saveVal = newVal;

                    if (isCompressedObj) {
                        try {
                            // Minify JSON before compressing if it was pretty-printed
                            try { saveVal = JSON.stringify(JSON.parse(saveVal)); } catch (e) { }
                            saveVal = LZString.compressToUTF16(saveVal);
                        } catch (e) {
                            console.error('Failed to compress state:', e);
                            alert('Failed to compress state!');
                            return;
                        }
                    } else {
                        // Minify regular JSON if it was pretty-printed
                        if (lang === 'json') {
                            try { saveVal = JSON.stringify(JSON.parse(saveVal)); } catch (e) { }
                        }
                    }

                    await chrome.tabs.sendMessage(tabId, {
                        type: type === 'localStorage' ? 'setLocalStorage' : 'setSessionStorage',
                        key: item.key,
                        value: saveVal
                    });
                    const activeNav = document.querySelector('.nav-item.active');
                    if (activeNav) loadView(activeNav.dataset.target);
                }, item.key); // Unique key: storage key
            },
            onDelete: async (item) => {
                await manager.delete(item);
                const activeNav = document.querySelector('.nav-item.active');
                if (activeNav) loadView(activeNav.dataset.target);
            }
        });

        grid.render(items);
    } catch (e) {
        console.error('Storage rendering failed:', e);
        throw e;
    }
}

async function renderIndexedDB(container, tabId) {
    await indexedDBManager.connect(tabId);
    const dbs = await indexedDBManager.getDatabases();

    if (dbs.length === 0) {
        container.innerHTML = '<div class="empty-state">No IndexedDB databases found.</div>';
        return;
    }

    const listContainer = document.createElement('div');
    listContainer.className = 'db-list';
    listContainer.style.padding = '16px';

    dbs.forEach(db => {
        const dbCard = document.createElement('div');
        dbCard.style.marginBottom = '16px';
        dbCard.innerHTML = `<h3 style="font-size: 14px; margin-bottom: 8px;">${db.name} (v${db.version})</h3>`;

        if (db.stores.length === 0) {
            dbCard.innerHTML += `<div style="color: var(--text-secondary); font-size: 13px;">No stores</div>`;
        } else {
            const storesList = document.createElement('div');
            storesList.style.display = 'flex';
            storesList.style.gap = '8px';
            storesList.style.flexWrap = 'wrap';

            db.stores.forEach(storeName => {
                const chip = document.createElement('button');
                chip.textContent = storeName;
                chip.className = 'nav-item'; // reuse style but caution with class conflicts
                chip.style.padding = '4px 12px';
                chip.style.backgroundColor = 'var(--bg-tertiary)';
                chip.style.border = '1px solid var(--border-color)';
                chip.style.cursor = 'pointer';

                chip.onclick = async () => {
                    // Manual call to same container updates
                    container.innerHTML = `<div style="padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 8px;">
                <button id="back-btn" class="icon-btn">←</button>
                <span>${db.name} / ${storeName}</span>
            </div>
            <div id="store-data-grid" class="content-area">Loading...</div>`;

                    document.getElementById('back-btn').onclick = () => renderIndexedDB(container, tabId);

                    try {
                        const data = await indexedDBManager.getStoreData(db.name, storeName);
                        const gridContainer = document.getElementById('store-data-grid');
                        gridContainer.innerHTML = '';

                        const grid = new DataGrid(gridContainer, {
                            columns: [
                                { key: 'key', label: 'Key', width: '200px' },
                                { key: 'value', label: 'Value' }
                            ],
                            onEdit: (item) => {
                                let val = item.value;
                                let lang = 'json';
                                editor.open(val, lang, (newVal) => {
                                    console.warn('IndexDB saving not implemented yet');
                                });
                            }
                        });
                        grid.render(data);
                    } catch (e) {
                        const gridContainer = document.getElementById('store-data-grid');
                        gridContainer.innerHTML = `<div style="color:var(--danger); padding:16px;">Error: ${e.message}</div>`;
                    }
                };
                storesList.appendChild(chip);
            });
            dbCard.appendChild(storesList);
        }
        listContainer.appendChild(dbCard);
    });

    container.innerHTML = '';
    container.appendChild(listContainer);
}

import { FileSystemManager } from './modules/FileSystemManager.js';
const fsManager = new FileSystemManager();

async function renderQuota(container) {
    const quota = await fsManager.getQuota();
    if (!quota) {
        container.innerHTML = '<div class="empty-state">Could not retrieve quota info</div>';
        return;
    }

    const usage = (quota.usage / 1024 / 1024).toFixed(2);
    const total = (quota.quota / 1024 / 1024).toFixed(2);
    const percent = ((quota.usage / quota.quota) * 100).toFixed(1);

    container.innerHTML = `
        <div style="padding: 24px; max-width: 600px; margin: 0 auto;">
            <h3 style="margin-bottom: 16px;">Storage Quota</h3>
            
            <div style="background: var(--bg-tertiary); padding: 24px; border-radius: 8px; border: 1px solid var(--border-color);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: var(--text-secondary);">Used</span>
                    <span style="font-weight: 600;">${usage} MB</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
                    <span style="color: var(--text-secondary);">Total Quota</span>
                    <span style="font-weight: 600;">${total} MB</span>
                </div>
                
                <div style="height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden;">
                    <div style="height: 100%; width: ${percent}%; background: var(--accent-primary);"></div>
                </div>
                <div style="text-align: right; margin-top: 4px; font-size: 12px; color: var(--text-secondary);">
                    ${percent}%
                </div>
            </div>
            
            <h4 style="margin: 24px 0 12px;">Breakdown</h4>
            <div style="background: var(--bg-tertiary); padding: 16px; border-radius: 8px; border: 1px solid var(--border-color);">
                ${quota.usageDetails ? Object.entries(quota.usageDetails).map(([k, v]) => `
                    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span style="text-transform: capitalize;">${k}</span>
                        <span>${(v / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                `).join('') : '<div style="color: var(--text-secondary);">Detail breakdown not available in this browser.</div>'}
            </div>
        </div>
    `;
}

async function renderFileSystem(container) {
    const files = await fsManager.getFileSystem();

    if (files.length === 0) {
        container.innerHTML = '<div class="empty-state">Origin Private File System is empty.</div>';
        return;
    }

    function buildTree(node, depth = 0) {
        // Recursively build tree HTML
        let html = '';
        const padding = depth * 20 + 16;

        if (node.kind === 'directory') {
            html += `
                <div style="padding: 8px 16px 8px ${padding}px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border-color);">
                    <span style="color: var(--accent-primary);">📁</span>
                    <span>${node.name}</span>
                </div>
            `;
            if (node.children) {
                node.children.forEach(child => {
                    html += buildTree(child, depth + 1);
                });
            }
        } else {
            html += `
                <div style="padding: 8px 16px 8px ${padding}px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-color); background: rgba(255,255,255,0.02);">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="color: var(--text-secondary);">📄</span>
                        <span>${node.name}</span>
                    </div>
                    <span style="color: var(--text-secondary); font-size: 12px;">
                        ${(node.size / 1024).toFixed(1)} KB
                    </span>
                </div>
            `;
        }
        return html;
    }

    const treeHtml = files.map(f => buildTree(f)).join('');

    container.innerHTML = `
        <div style="padding: 0;">
            <div style="padding: 12px 16px; background: var(--bg-tertiary); font-weight: 600; font-size: 12px; color: var(--text-secondary); border-bottom: 1px solid var(--border-color);">
                ROOT DIRECTORY
            </div>
            ${treeHtml}
        </div>
    `;
}

import { DebuggerManager } from './modules/DebuggerManager.js';
const debuggerManager = new DebuggerManager();

async function renderDeepStorage(container) {
    if (!currentTabId) return;

    container.innerHTML = '<div class="empty-state">Connecting to Debugger... (Check for browser warning)</div>';

    try {
        debuggerManager.setTabId(currentTabId);
        await debuggerManager.attach();

        container.innerHTML = '<div class="empty-state">Fetching deep storage data...</div>';

        const cookies = await debuggerManager.getAllCookies();
        // Filter for "interesting" cookies: HTTP Only or SameSite=Strict (things usually hidden or hard to modify)
        const gatekeptCookies = cookies.filter(c => c.httpOnly || c.sameSite === 'Strict' || c.sameSite === 'Lax');

        let html = '<div style="padding:16px;">';

        html += '<h3 style="margin-bottom:8px;">Deep Storage (CDP)</h3>';
        html += '<p style="color:var(--text-secondary); margin-bottom:16px; font-size:12px;">Accessing HTTP-Only cookies and Trust Tokens via Native Debugger Protocol.</p>';

        html += '<div id="deep-cookies-grid"></div>';
        html += '</div>';

        container.innerHTML = html;

        const gridContainer = container.querySelector('#deep-cookies-grid');

        if (gatekeptCookies.length > 0) {
            const grid = new DataGrid(gridContainer, {
                columns: [
                    { key: 'name', label: 'Name (HTTP Only)', width: '200px' },
                    { key: 'value', label: 'Value' },
                    { key: 'secure', label: 'Secure', width: '60px', render: (val) => val ? '🔒' : '' },
                    { key: 'httpOnly', label: 'HttpOnly', width: '80px', render: (val) => val ? '✅' : '❌' }
                ],
                onEdit: (item) => {
                    // Use existing editor
                    editor.open(item.value, 'text', async (newVal) => {
                        try {
                            const updated = { ...item, value: newVal };
                            await debuggerManager.setCookie(updated);
                            renderDeepStorage(container); // reload
                        } catch (e) {
                            alert('CDP Set Failed: ' + e.message);
                        }
                    }, item.name); // Unique Key: cookie name
                },
                onDelete: async (item) => {
                    if (confirm('Delete this HttpOnly cookie via Debugger?')) {
                        await debuggerManager.deleteCookie(item);
                        renderDeepStorage(container);
                    }
                }
            });
            grid.render(gatekeptCookies);
        } else {
            gridContainer.innerHTML = '<div class="empty-state">No HTTP-Only or restricted cookies found for this origin.</div>';
        }

    } catch (e) {
        container.innerHTML = `
            <div style="padding:16px; color:var(--danger);">
                <h3>Debugger Connection Failed</h3>
                <p>Could not attach to this tab. This might be because:</p>
                <ul>
                    <li>You denied the permission request.</li>
                    <li>Another debugger is already attached.</li>
                    <li>This is a restricted browser page.</li>
                </ul>
                <pre>${e.message}</pre>
            </div>`;
    }
}

async function renderPageVariables(container, force = false) {
    if (!currentTabId) return;

    if (force) {
        container.innerHTML = '<div class="empty-state">Refreshing Variables...</div>';
    } else {
        // If not forced, we might be loading. 
        // We rely on previous "Loading..." state from loadView or keep current if verifying.
        // But to be safe, show status if we suspect it might take a moment (attaching).
        if (!container.innerHTML.includes('Page Variables')) {
            container.innerHTML = '<div class="empty-state">Connecting to Debugger...</div>';
        }
    }

    try {
        debuggerManager.setTabId(currentTabId);
        await debuggerManager.attach();

        if (force || !container.querySelector('#page-vars-grid')) {
            // Only show scanning msg if we are truly scanning or building from scratch
            // But if we have cache, getGlobalVariables returns fast.
        }

        const globals = await debuggerManager.getGlobalVariables(force);

        container.innerHTML = `
            <div style="padding:16px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <div>
                        <h3 style="margin: 0;">Page Variables</h3>
                        <p style="color:var(--text-secondary); margin-top:4px; font-size:12px;">Global variables defined by the page.</p>
                    </div>
                    <button id="refresh-vars-btn" style="
                        padding: 6px 12px; 
                        font-size: 13px; 
                        display: flex; 
                        align-items: center; 
                        gap: 6px; 
                        border: 1px solid var(--border-color); 
                        background: var(--bg-secondary); 
                        color: var(--text-primary);
                        cursor: pointer; 
                        border-radius: 4px;">
                        <span>🔄</span> Refresh
                    </button>
                </div>
                <div id="page-vars-grid"></div>
            </div>
        `;

        // Re-attach listener
        const refreshBtn = container.querySelector('#refresh-vars-btn');
        if (refreshBtn) {
            refreshBtn.onclick = () => renderPageVariables(container, true);
        }

        if (globals && globals.length > 0) {
            // Sort: Framework ones first, then alphabetical
            globals.sort((a, b) => {
                if (a.details && !b.details) return -1;
                if (!a.details && b.details) return 1;
                return a.key.localeCompare(b.key);
            });

            const grid = new DataGrid(container.querySelector('#page-vars-grid'), {
                columns: [
                    {
                        key: 'key',
                        label: 'Variable Name',
                        width: '250px',
                        render: (val, item) => {
                            if (item.details) {
                                return `${item.key}   <span style="font-size:10px; background:var(--accent-primary); color:white; padding:1px 4px; border-radius:2px; margin-left:4px;">${item.details}</span>`;
                            }
                            return item.key;
                        }
                    },
                    { key: 'type', label: 'Type', width: '100px' },
                    {
                        key: 'value',
                        label: 'Value',
                        render: (val, item) => renderValueWithPreviews(val, item)
                    }
                ],
                onEdit: (item) => {
                    // Prettify if it looks like an object/array
                    let val = item.value;
                    let lang = 'json'; // default to json/js highlighting

                    editor.open(val, lang, async (newVal) => {
                        try {
                            await debuggerManager.setGlobalVariable(item.key, newVal);
                            renderPageVariables(container); // reload (will fetch fresh)
                        } catch (e) {
                            alert('Failed to set variable: ' + e.message);
                        }
                    }, item.key); // Unique key
                }
            });
            grid.render(globals);
        } else {
            container.querySelector('#page-vars-grid').innerHTML = '<div class="empty-state">No custom global variables found.</div>';
        }

    } catch (e) {
        container.innerHTML = `<div style="padding:16px; color:var(--danger);">Error scanning variables: ${e.message}</div>`;
    }
}
