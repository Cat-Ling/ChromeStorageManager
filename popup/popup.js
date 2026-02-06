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
        let errorMsg = 'Unknown error';
        if (event.reason) {
            if (typeof event.reason === 'string') errorMsg = event.reason;
            else if (event.reason.message) errorMsg = event.reason.message;
            else errorMsg = JSON.stringify(event.reason);
        }
        mountPoint.innerHTML = `
            <div style="padding: 16px; color: var(--danger);">
                <h3>Unhandled Promise Rejection</h3>
                <pre style="white-space: pre-wrap; margin-top: 8px; font-size: 12px;">${errorMsg}</pre>
            </div>
        `;
    }
});

import { CacheManager } from './modules/CacheManager.js';
import { CodecManager } from './modules/ValueCodec.js';

const cookiesManager = new CookiesManager();
const localStorageManager = new PageStorageManager('localStorage');
const sessionStorageManager = new PageStorageManager('sessionStorage');
const indexedDBManager = new IndexedDBManager();
const cacheManager = new CacheManager();
const codecManager = new CodecManager();
import { PageVariablesManager } from './modules/PageVariablesManager.js';
const pageVariablesManager = new PageVariablesManager();
let editor = null;
let currentTabId = null;
let currentOrigin = null;

// --- Web Worker Manager for Codecs ---
let codecWorker = null;
function getCodecWorker() {
    if (!codecWorker) {
        codecWorker = new Worker(chrome.runtime.getURL('popup/modules/codec-worker.js'));
    }
    return codecWorker;
}

function decodeAsync(payload, codecName) {
    return new Promise((resolve, reject) => {
        const worker = getCodecWorker();
        const msgId = Date.now() + Math.random();

        const handleMsg = (e) => {
            if (e.data.success) {
                resolve(e.data.result);
            } else {
                reject(new Error(e.data.error));
            }
            worker.removeEventListener('message', handleMsg);
        };

        worker.addEventListener('message', handleMsg);
        worker.postMessage({ type: 'DECODE', payload, codecName });
    });
}

// --- Modal Helper: New Item ---
function showNewItemModal(title, fields, onSave) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 2000;
        display: flex; justify-content: center; align-items: center;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: var(--bg-secondary); border: 1px solid var(--border-color);
        border-radius: 8px; width: 350px; 
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        display: flex; flex-direction: column;
    `;

    let fieldHtml = '';
    fields.forEach(f => {
        fieldHtml += `
            <div style="margin-bottom: 12px;">
                <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:4px;">${f.label}</label>
                ${f.type === 'datetime-local' ?
                `<input id="new-item-${f.key}" type="datetime-local" 
                        style="background:var(--bg-main); border:1px solid var(--border-color); color:var(--text-primary); padding:6px; border-radius:4px; width:100%; font-size:13px;">` :
                `<input id="new-item-${f.key}" type="${f.type || 'text'}" value="${f.default || ''}" 
                        style="background:var(--bg-main); border:1px solid var(--border-color); color:var(--text-primary); padding:6px; border-radius:4px; width:100%; font-size:13px;">`
            }
            </div>
        `;
    });

    modal.innerHTML = `
        <div style="padding: 16px; border-bottom: 1px solid var(--border-color); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${title}</div>
        <div style="padding: 16px;">
            ${fieldHtml}
        </div>
        <div style="padding: 16px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 8px;">
            <button id="new-item-cancel" style="padding: 6px 12px; border: 1px solid var(--border-color); background: transparent; color: var(--text-primary); border-radius: 4px; cursor: pointer;">Cancel</button>
            <button id="new-item-save" style="padding: 6px 12px; border: 1px solid transparent; background: var(--accent-primary); color: var(--accent-text); border-radius: 4px; cursor: pointer;">Add</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.querySelector('#new-item-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#new-item-save').onclick = () => {
        const result = {};
        fields.forEach(f => {
            result[f.key] = overlay.querySelector(`#new-item-${f.key}`).value;
        });
        onSave(result);
        overlay.remove();
    };

    // Auto-focus first field
    setTimeout(() => {
        const first = overlay.querySelector('input');
        if (first) first.focus();
    }, 10);
}

// --- Context Menu Helper for Addition ---
function setupAddContextMenu(container, addItems = []) {
    // Cleanup old listeners on this container if they exist
    if (container._hasAddMenuListener) {
        container.removeEventListener('contextmenu', container._hasAddMenuListener);
        delete container._hasAddMenuListener;
    }

    if (addItems.length === 0) return;

    const handler = (e) => {
        // Only trigger if we're NOT clicking a row (or let grid handle row clicks)
        if (e.target.closest('.data-row')) return;

        e.preventDefault();

        // Cleanup any existing menu
        const old = document.querySelector('.custom-context-menu');
        if (old) old.remove();

        const menu = document.createElement('div');
        menu.className = 'custom-context-menu';
        menu.style.display = 'block';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        addItems.forEach(item => {
            const div = document.createElement('div');
            div.className = 'context-menu-item';
            div.textContent = item.label;
            div.onclick = () => {
                item.action();
                menu.remove();
            };
            menu.appendChild(div);
        });

        document.body.appendChild(menu);

        const closeMenu = (ev) => {
            if (!menu.contains(ev.target)) {
                if (menu.parentNode) menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 10);
    };

    container.addEventListener('contextmenu', handler);
    container._hasAddMenuListener = handler;
}

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
        >View Image</button>`;
    }

    // Check for Codec
    const codec = codecManager.detect(val);
    if (codec && codec.name !== 'raw' && codec.name !== 'json') {
        return `
            <span style="
                display:inline-block; 
                font-size:10px; 
                background:var(--accent-primary); 
                color:white; 
                padding:1px 4px; 
                border-radius:2px; 
                margin-right:6px;
                vertical-align: middle;
            ">${codec.displayName}</span>
            <span style="opacity: 0.7;">${val.substring(0, 50)}${val.length > 50 ? '...' : ''}</span>
         `;
    }

    // Base truncation for performance
    if (typeof val === 'string' && val.length > 500) {
        return `<span style="opacity: 0.7;">${val.substring(0, 500)}...</span>`;
    }

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

// --- Helper: Restricted Pages ---
function isRestrictedPage(url) {
    if (!url) return true;
    const restrictedSchemes = ['chrome:', 'chrome-extension:', 'about:', 'edge:'];
    const restrictedDomains = ['chrome.google.com', 'chromewebstore.google.com'];

    try {
        const parsed = new URL(url);
        if (restrictedSchemes.includes(parsed.protocol)) return true;
        if (restrictedDomains.includes(parsed.hostname)) return true;
    } catch (e) {
        return true;
    }
    return false;
}

function renderRestrictedView(container, viewName) {
    container.innerHTML = `
        <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 24px;
            text-align: center;
            height: 100%;
            color: var(--text-secondary);
        ">
            <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;">🔒</div>
            <h3 style="color: var(--text-primary); margin-bottom: 8px;">Access Restricted</h3>
            <p style="font-size: 13px; line-height: 1.5; margin-bottom: 24px; max-width: 280px;">
                Chrome security policies prevent extensions from accessing <strong>${viewName}</strong> on this page.
            </p>
            <div style="
                background: var(--bg-tertiary);
                border: 1px solid var(--border-color);
                border-radius: 6px;
                padding: 12px;
                font-size: 11px;
                text-align: left;
            ">
                <strong>Why?</strong> Browser internal pages and the Web Store are protected to prevent unauthorized manipulation of browser settings.
            </div>
            <a href="https://developer.chrome.com/docs/extensions/mv3/content_scripts/#capabilities" target="_blank" style="
                margin-top: 24px;
                color: var(--accent-primary);
                font-size: 12px;
                text-decoration: none;
            ">Learn more about restrictions</a>
        </div>
    `;
}

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

        // --- Restricted Page Check ---
        const restricted = isRestrictedPage(url);
        const injectionRequired = ['cache', 'file-system', 'quota', 'service-workers', 'page-vars', 'deep-storage', 'local-storage', 'session-storage', 'indexed-db'].includes(viewName);

        if (restricted && injectionRequired) {
            renderRestrictedView(mountPoint, viewName);
            return;
        }

        // Derive and store current origin
        try {
            const parsedUrl = new URL(url);
            currentOrigin = parsedUrl.origin;
        } catch (e) {
            console.error('Failed to parse origin from URL:', url);
            currentOrigin = null;
        }

        // Connect managers to current tab
        // cookiesManager doesn't need connect() as it uses chrome.cookies (background)
        // debuggerManager uses cdp (attach)

        if (viewName === 'cache') await cacheManager.connect(tabId);
        if (viewName === 'file-system' || viewName === 'quota' || viewName === 'service-workers') await fsManager.connect(tabId);
        if (viewName === 'page-vars') pageVariablesManager.setTabId(tabId);

        // Cookies manager setup
        await cookiesManager.setUrl(url);
        if (viewName !== 'deep-storage') {
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
                await renderDeepStorage(mountPoint, currentOrigin);
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
    setupAddContextMenu(container, []);
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
                { key: 'url', label: 'URL', width: '250px' },
                { key: 'method', label: 'Method', width: '60px' },
                { key: 'status', label: 'Status', width: '50px' }
            ],
            enableGlobalContextMenu: false
        });
        grid.render(items);
    } catch (e) {
        container.innerHTML = 'Error loading cache';
    }
}

function generateDuplicateName(currentName, existingNames) {
    let n = 1;
    let candidate = `${currentName} (${n})`;
    while (existingNames.has(candidate)) {
        n++;
        candidate = `${currentName} (${n})`;
    }
    return candidate;
}

async function renderCookies(container, url) {
    const cookies = await cookiesManager.getAll();
    const cookieNames = new Set(cookies.map(c => c.name));

    const grid = new DataGrid(container, {
        defaultSortCol: 'name',
        columns: [
            { key: 'name', label: 'Name', width: '120px' },
            {
                key: 'value',
                label: 'Value',
                width: '180px',
                render: (val, item) => renderValueWithPreviews(val, item)
            },
            { key: 'domain', label: 'Domain', width: '100px' },
            {
                key: 'httpOnly',
                label: 'HTTP',
                width: '50px',
                render: (val) => val ? '<span style="color:var(--danger); font-size:10px; font-weight:bold;">ONLY</span>' : '<span style="color:var(--text-secondary); font-size:10px;">No</span>'
            },
            {
                key: 'expirationDate',
                label: 'Expires',
                width: '120px',
                render: (val) => val ? new Date(val * 1000).toLocaleString() : 'Session'
            },
            {
                key: 'partitionKey',
                label: 'CHIPS',
                width: '60px',
                render: (val) => val ? `<span title="Partitioned cookie (CHIPS)" style="cursor:help;">🍪 Yes</span>` : '<span style="color:var(--text-secondary);">No</span>'
            }
        ],
        onEdit: async (item) => {
            const val = item.value;
            const codec = codecManager.detect(val);
            let decoded = val;
            let lang = 'text';

            if (codec) {
                if (val.length > 100000) {
                    try { decoded = await decodeAsync(val, codec.name); }
                    catch (e) { decoded = codec.decode(val); }
                } else {
                    decoded = codec.decode(val);
                }
                if (typeof decoded === 'string' && (decoded.trim().startsWith('{') || decoded.trim().startsWith('['))) {
                    lang = 'json';
                }
            }

            editor.open(decoded, lang, async (newVal, isRaw) => {
                try {
                    let saveVal = newVal;
                    if (codec && !isRaw) {
                        saveVal = codec.encode(newVal);
                    }
                    const updatedCookie = { ...item, value: saveVal };
                    await cookiesManager.set(updatedCookie);
                    loadView('cookies');
                } catch (e) {
                    console.error('Failed to set cookie:', e);
                    alert(`Failed to save cookie: ${e.message}`);
                }
            }, item.name, val);
        },
        onDelete: async (item) => {
            await cookiesManager.delete(item);
            loadView('cookies'); // reload
        },
        onDuplicate: async (item) => {
            try {
                const newName = generateDuplicateName(item.name, cookieNames);
                const newCookie = {
                    ...item,
                    name: newName,
                    url: `http${item.secure ? 's' : ''}://${item.domain.startsWith('.') ? item.domain.substring(1) : item.domain}${item.path}`
                };
                // expirationDate might be null for session cookies, set it explicitly if it exists
                if (item.expirationDate) newCookie.expirationDate = item.expirationDate;
                else delete newCookie.expirationDate;

                await cookiesManager.set(newCookie);
                loadView('cookies');
            } catch (e) {
                console.error('Failed to duplicate cookie:', e);
                alert(`Duplicate failed: ${e.message}`);
            }
        },
        extraContextItems: [
            {
                label: 'Export All (Netscape)',
                action: async () => {
                    const allCookies = await cookiesManager.getAll();
                    const netscapeStr = cookiesManager.toNetscape(allCookies);

                    try {
                        const handle = await window.showSaveFilePicker({
                            suggestedName: 'cookies.txt',
                            types: [{
                                description: 'Netscape Cookie File',
                                accept: { 'text/plain': ['.txt'] }
                            }],
                        });
                        const writable = await handle.createWritable();
                        await writable.write(netscapeStr);
                        await writable.close();
                    } catch (e) {
                        if (e.name !== 'AbortError') {
                            const blob = new Blob([netscapeStr], { type: 'text/plain' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'cookies.txt';
                            a.click();
                            URL.revokeObjectURL(url);
                        }
                    }
                }
            }
        ],
        onUpdate: async (newItem, oldItem) => {
            try {
                // If name changed, we must delete the old one first
                if (newItem.name !== oldItem.name) {
                    await cookiesManager.delete(oldItem);
                }

                let cookieUrl = `http${newItem.secure ? 's' : ''}://${newItem.domain.startsWith('.') ? newItem.domain.substring(1) : newItem.domain}${newItem.path}`;
                const newCookie = {
                    url: cookieUrl,
                    name: newItem.name,
                    value: newItem.value,
                    domain: newItem.domain,
                    path: newItem.path,
                    secure: newItem.secure,
                    httpOnly: newItem.httpOnly,
                    sameSite: newItem.sameSite,
                    storeId: newItem.storeId,
                    expirationDate: newItem.expirationDate
                };
                if (!newItem.expirationDate) delete newCookie.expirationDate;
                await cookiesManager.set(newCookie);
                loadView('cookies');
            } catch (e) {
                console.error('Failed to update property:', e);
                alert(`Update failed: ${e.message}`);
            }
        },
        enableGlobalContextMenu: false // We use setupAddContextMenu now
    });

    setupAddContextMenu(container, [
        {
            label: 'Add New Cookie',
            action: () => {
                let currentDomain = '';
                try { currentDomain = new URL(url).hostname; } catch (e) { }

                showNewItemModal('Add New Cookie', [
                    { key: 'name', label: 'Name', default: 'new_cookie' },
                    { key: 'value', label: 'Value', default: '' },
                    { key: 'domain', label: 'Domain', default: currentDomain },
                    { key: 'path', label: 'Path', default: '/' },
                    { key: 'expiry', label: 'Expiration', type: 'datetime-local' }
                ], async (result) => {
                    if (!result.name) return;
                    try {
                        const cookieDetails = {
                            name: result.name,
                            value: result.value,
                            domain: result.domain,
                            path: result.path,
                            secure: false
                        };
                        if (result.expiry) {
                            const date = new Date(result.expiry);
                            if (!isNaN(date.getTime())) {
                                cookieDetails.expirationDate = date.getTime() / 1000;
                            }
                        }
                        await cookiesManager.set(cookieDetails);
                        loadView('cookies');
                    } catch (e) {
                        alert('Add Cookie Failed: ' + e.message);
                    }
                });
            }
        }
    ]);

    // Pass raw cookies to grid (don't convert date to string in the object itself)
    grid.render(cookies);
}

async function renderPageStorage(container, tabId, manager, type) {
    try {
        await manager.connect(tabId);
        const items = await manager.getAll();

        const grid = new DataGrid(container, {
            defaultSortCol: 'key',
            columns: [
                { key: 'key', label: 'Key', width: '100px' },
                {
                    key: 'value',
                    label: 'Value',
                    render: (val, item) => renderValueWithPreviews(val, item)
                }
            ],
            onEdit: async (item) => {
                const val = item.value;
                const codec = codecManager.detect(val);

                let decoded = val;
                let lang = 'text';

                // Decode if possible
                if (codec) {
                    if (val.length > 100000) { // > 100KB, use worker
                        try {
                            decoded = await decodeAsync(val, codec.name);
                        } catch (e) {
                            console.error('Worker decoding failed:', e);
                            decoded = codec.decode(val); // Fallback
                        }
                    } else {
                        decoded = codec.decode(val);
                    }

                    // Heuristic: If decoded starts with { or [, assume JSON for highlighting
                    if (typeof decoded === 'string' && (decoded.trim().startsWith('{') || decoded.trim().startsWith('['))) {
                        lang = 'json';
                    }
                }

                editor.open(decoded, lang, async (newVal, isRaw) => {
                    let saveVal = newVal;

                    try {
                        // Re-encode if codec exists AND we are not editing raw
                        if (codec && !isRaw) {
                            // For encoding, if it's huge, maybe also use worker?
                            // Encoding is usually faster unless it's massive compression
                            saveVal = codec.encode(newVal);
                        }
                    } catch (e) {
                        console.error('Failed to encode state:', e);
                        alert(`Failed to encode state with ${codec ? codec.displayName : 'Unknown'}: ${e.message}`);
                        return;
                    }

                    await chrome.tabs.sendMessage(tabId, {
                        type: type === 'localStorage' ? 'setLocalStorage' : 'setSessionStorage',
                        key: item.key,
                        value: saveVal
                    });
                    const activeNav = document.querySelector('.nav-item.active');
                    if (activeNav) loadView(activeNav.dataset.target);
                }, item.key, val); // Pass original value as 5th arg
            },
            onDelete: async (item) => {
                await manager.delete(item);
                const activeNav = document.querySelector('.nav-item.active');
                if (activeNav) loadView(activeNav.dataset.target);
            },
            onDuplicate: async (item) => {
                try {
                    const keys = new Set(items.map(i => i.key));
                    const newKey = generateDuplicateName(item.key, keys);
                    await chrome.tabs.sendMessage(tabId, {
                        type: type === 'localStorage' ? 'setLocalStorage' : 'setSessionStorage',
                        key: newKey,
                        value: item.value
                    });
                    loadView(type === 'localStorage' ? 'local-storage' : 'session-storage');
                } catch (e) {
                    console.error('Failed to duplicate storage item:', e);
                    alert(`Duplicate failed: ${e.message}`);
                }
            },
            onUpdate: async (newItem, oldItem) => {
                try {
                    // If key changed, delete old one
                    if (newItem.key !== oldItem.key) {
                        await manager.delete(oldItem);
                    }

                    await chrome.tabs.sendMessage(tabId, {
                        type: type === 'localStorage' ? 'setLocalStorage' : 'setSessionStorage',
                        key: newItem.key,
                        value: newItem.value
                    });

                    loadView(type === 'localStorage' ? 'local-storage' : 'session-storage');
                } catch (e) {
                    console.error('Failed to update storage item:', e);
                    alert(`Update failed: ${e.message}`);
                }
            },
            enableGlobalContextMenu: false
        });

        if (type === 'localStorage') {
            setupAddContextMenu(container, [
                {
                    label: 'Add New Local Item',
                    action: () => {
                        showNewItemModal('Add New Local Item', [
                            { key: 'key', label: 'Key', default: 'new_key' },
                            { key: 'value', label: 'Value', default: '' }
                        ], async (result) => {
                            if (!result.key) return;
                            await chrome.tabs.sendMessage(tabId, {
                                type: 'setLocalStorage',
                                key: result.key,
                                value: result.value
                            });
                            loadView('local-storage');
                        });
                    }
                }
            ]);
        } else {
            // Remove any existing add menu for session storage
            setupAddContextMenu(container, []);
        }

        grid.render(items);
    } catch (e) {
        console.error('Storage rendering failed:', e);
        throw e;
    }
}

async function renderIndexedDB(container, tabId) {
    const addAction = () => {
        showNewItemModal('Create New IndexedDB Store', [
            { key: 'dbName', label: 'Database Name', default: 'NewDatabase' },
            { key: 'storeName', label: 'Store Name', default: 'NewStore' }
        ], async (result) => {
            if (!result.dbName || !result.storeName) return;
            try {
                await indexedDBManager.createStore(result.dbName, result.storeName);
                renderIndexedDB(container, tabId);
            } catch (e) {
                alert('Creation Failed: ' + e.message);
            }
        });
    };

    setupAddContextMenu(container, [{ label: 'Add New Database / Store', action: addAction }]);

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
                <button id="back-btn" class="icon-btn" style="font-size: 13px; font-weight: 500;">Back</button>
                <span>${db.name} / ${storeName}</span>
            </div>
            <div id="store-data-grid" class="content-area">Loading...</div>`;

                    document.getElementById('back-btn').onclick = () => renderIndexedDB(container, tabId);

                    const addEntryAction = () => {
                        showNewItemModal('Add New IndexedDB Entry', [
                            { key: 'key', label: 'Key', default: '' },
                            { key: 'value', label: 'Value (JSON)', default: '{}' }
                        ], async (result) => {
                            if (!result.key) return;
                            try {
                                let parsed = result.value;
                                try { parsed = JSON.parse(result.value); } catch (e) { }
                                await indexedDBManager.putItem(db.name, storeName, result.key, parsed);
                                const newData = await indexedDBManager.getStoreData(db.name, storeName);
                                // The grid already exists or will be created below, but for simple refresh:
                                renderIndexedDBStore(db.name, storeName);
                            } catch (e) {
                                alert('Add Entry Failed: ' + e.message);
                            }
                        });
                    };

                    setupAddContextMenu(container, [{ label: 'Add New Entry', action: addEntryAction }]);

                    const renderIndexedDBStore = async (dbName, sName) => {
                        try {
                            const data = await indexedDBManager.getStoreData(dbName, sName);
                            const gridContainer = document.getElementById('store-data-grid');
                            if (!gridContainer) return;
                            gridContainer.innerHTML = '';

                            const grid = new DataGrid(gridContainer, {
                                defaultSortCol: 'key',
                                columns: [
                                    { key: 'key', label: 'Key', width: '150px' },
                                    {
                                        key: 'value',
                                        label: 'Value',
                                        width: '200px',
                                        render: (val, item) => renderValueWithPreviews(val, item)
                                    }
                                ],
                                enableGlobalContextMenu: false,
                                onEdit: async (item) => {
                                    let val = item.value;
                                    let lang = 'json';

                                    if (typeof val === 'object' && val !== null) {
                                        val = JSON.stringify(val, null, 2);
                                    } else if (typeof val === 'string' && val.length > 100000) {
                                        // If it's a large string, let's treat it as potential JSON/Compressed
                                        const codec = codecManager.detect(val);
                                        if (codec) {
                                            try { val = await decodeAsync(val, codec.name); }
                                            catch (e) { val = codec.decode(val); }
                                        }
                                    }

                                    editor.open(val, lang, async (newVal) => {
                                        try {
                                            let parsed = newVal;
                                            try { parsed = JSON.parse(newVal); } catch (e) { }
                                            await indexedDBManager.putItem(dbName, sName, item.key, parsed);
                                            renderIndexedDBStore(dbName, sName);
                                        } catch (e) {
                                            alert('Save Failed: ' + e.message);
                                        }
                                    }, item.key, item.value);
                                },
                                onDelete: async (item) => {
                                    await indexedDBManager.deleteItem(dbName, sName, item.key);
                                    renderIndexedDBStore(dbName, sName);
                                },
                                onDuplicate: async (item) => {
                                    try {
                                        const keys = new Set(data.map(i => i.key));
                                        const newKey = generateDuplicateName(item.key, keys);
                                        await indexedDBManager.putItem(dbName, sName, newKey, item.value);
                                        renderIndexedDBStore(dbName, sName);
                                    } catch (e) {
                                        console.error('Failed to duplicate IndexedDB entry:', e);
                                        alert(`Duplicate failed: ${e.message}`);
                                    }
                                },
                                onUpdate: async (newItem, oldItem) => {
                                    try {
                                        // If key changed, delete old
                                        if (newItem.key !== oldItem.key) {
                                            await indexedDBManager.deleteItem(dbName, sName, oldItem.key);
                                        }
                                        await indexedDBManager.putItem(dbName, sName, newItem.key, newItem.value);
                                        renderIndexedDBStore(dbName, sName);
                                    } catch (e) {
                                        console.error('Failed to update IndexedDB entry:', e);
                                        alert(`Update failed: ${e.message}`);
                                    }
                                }
                            });
                            grid.render(data);
                        } catch (e) {
                            const gridContainer = document.getElementById('store-data-grid');
                            if (gridContainer) gridContainer.innerHTML = `<div style="color:var(--danger); padding:16px;">Error: ${e.message}</div>`;
                        }
                    };

                    renderIndexedDBStore(db.name, storeName);
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

    function buildTree(node, path = '', depth = 0) {
        let html = '';
        const padding = depth * 20 + 16;
        const currentPath = path ? `${path}/${node.name}` : node.name;

        if (node.kind === 'directory') {
            html += `
                <div class="fs-dir" style="padding: 8px 16px 8px ${padding}px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border-color); cursor: pointer; background: rgba(255,255,255,0.01);">
                    <span class="fs-toggle" style="color: var(--text-secondary); font-size: 10px; width: 12px;">▼</span>
                    <span style="color: var(--accent-primary); font-family: monospace;">[D]</span>
                    <span style="font-weight: 500;">${node.name}</span>
                </div>
                <div class="fs-children">
                    ${node.children ? node.children.map(child => buildTree(child, currentPath, depth + 1)).join('') : ''}
                </div>
            `;
        } else {
            html += `
                <div style="padding: 8px 16px 8px ${padding}px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-color); background: rgba(255,255,255,0.03);">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="width: 12px;"></span>
                        <span style="color: var(--text-secondary); font-size: 14px;">📄</span>
                        <span>${node.name}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="color: var(--text-secondary); font-size: 11px;">
                            ${(node.size / 1024).toFixed(1)} KB
                        </span>
                        <button class="fs-download-btn icon-btn" data-path="${currentPath}" title="Download File">📥</button>
                    </div>
                </div>
            `;
        }
        return html;
    }

    const treeHtml = files.map(f => buildTree(f)).join('');

    container.innerHTML = `
        <div style="padding: 0;">
            <div style="padding: 12px 16px; background: var(--bg-tertiary); font-weight: 600; font-size: 11px; color: var(--text-secondary); border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                <span>ORIGIN PRIVATE FILE SYSTEM (OPFS)</span>
                <span style="font-size: 10px; opacity: 0.7;">EXPERIMENTAL</span>
            </div>
            <div class="fs-tree-container">
                ${treeHtml}
            </div>
        </div>
    `;

    // Handlers
    container.querySelectorAll('.fs-dir').forEach(dir => {
        dir.onclick = (e) => {
            const children = dir.nextElementSibling;
            const toggle = dir.querySelector('.fs-toggle');
            if (children.style.display === 'none') {
                children.style.display = 'block';
                toggle.textContent = '▼';
            } else {
                children.style.display = 'none';
                toggle.textContent = '▶';
            }
        };
    });

    container.querySelectorAll('.fs-download-btn').forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            const path = btn.dataset.path;
            try {
                const fileData = await fsManager.downloadFile(path);
                if (fileData) {
                    const blob = new Blob([Uint8Array.from(atob(fileData.data), c => c.charCodeAt(0))], { type: fileData.type });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fileData.name;
                    a.click();
                    URL.revokeObjectURL(url);
                }
            } catch (e) {
                alert('Download failed: ' + e.message);
            }
        };
    });
}

async function renderServiceWorkers(container) {
    const regs = await fsManager.getServiceWorkers();
    if (regs.length === 0) {
        container.innerHTML = '<div class="empty-state">No Service Worker registrations found for this origin.</div>';
        return;
    }

    const grid = new DataGrid(container, {
        columns: [
            { key: 'scope', label: 'Scope', width: '200px' },
            {
                key: 'active',
                label: 'Status',
                width: '100px',
                render: (val, item) => {
                    if (item.active) return `<span style="color:var(--accent-primary)">Active</span>`;
                    if (item.waiting) return `<span style="color:orange">Waiting</span>`;
                    if (item.installing) return `<span style="color:cyan">Installing</span>`;
                    return 'Unknown';
                }
            },
            {
                key: 'scriptURL',
                label: 'Script',
                render: (val, item) => (item.active || item.waiting || item.installing || {}).scriptURL || 'N/A'
            }
        ]
    });
    grid.render(regs);
}

import { DebuggerManager } from './modules/DebuggerManager.js';
const debuggerManager = new DebuggerManager();

async function renderDeepStorage(container, origin) {
    if (!currentTabId) return;

    container.innerHTML = '<div class="empty-state">Connecting to Debugger... (Check for browser warning)</div>';

    try {
        debuggerManager.setTabId(currentTabId);
        await debuggerManager.attach();

        container.innerHTML = '<div class="empty-state">Fetching deep storage data...</div>';

        let html = '<div style="padding:16px;">';

        html += '<h3 style="margin-bottom:8px;">Deep Storage (CDP)</h3>';
        html += '<p style="color:var(--text-secondary); margin-bottom:16px; font-size:12px;">Managing features that strictly require the Native Debugger Protocol.</p>';

        html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">';
        html += '<h3 style="margin: 0;">Trust Tokens</h3>';
        html += '<button id="refresh-tokens-btn" class="icon-btn" style="padding: 4px 8px; font-size: 11px; border: 1px solid var(--border-color);">Refresh Tokens</button>';
        html += '</div>';
        html += '<p style="color:var(--text-secondary); margin-bottom:12px; font-size:11px;">Privacy-preserving tokens issued by third parties.</p>';
        html += '<div id="trust-tokens-grid" style="margin-bottom:24px;"></div>';

        const usage = await debuggerManager.getStorageUsage(origin);
        if (usage) {
            html += '<h3 style="margin-bottom:8px;">Protocol-Level Quota</h3>';
            html += `<pre style="font-size:11px; background:var(--bg-tertiary); padding:8px; border-radius:4px;">Usage: ${(usage.usage / 1024 / 1024).toFixed(2)} MB\nQuota: ${(usage.quota / 1024 / 1024).toFixed(2)} MB</pre>`;
        }

        html += '</div>';

        container.innerHTML = html;

        // --- Trust Tokens Render ---
        const tokensContainer = container.querySelector('#trust-tokens-grid');
        const renderTokens = async () => {
            tokensContainer.innerHTML = '<div class="empty-state">Loading Tokens...</div>';
            try {
                const tokens = await debuggerManager.getTrustTokens();
                if (tokens && tokens.length > 0) {
                    const tokenGrid = new DataGrid(tokensContainer, {
                        columns: [
                            { key: 'issuerOrigin', label: 'Issuer', width: '200px' },
                            { key: 'count', label: 'Count', width: '80px' }
                        ],
                        enableGlobalContextMenu: false
                    });
                    tokenGrid.render(tokens);
                } else {
                    tokensContainer.innerHTML = '<div class="empty-state">No Trust Tokens found.</div>';
                }
            } catch (e) {
                tokensContainer.innerHTML = `<div style="color:var(--danger); font-size:12px;">Failed to fetch tokens: ${e.message}</div>`;
            }
        };

        container.querySelector('#refresh-tokens-btn').onclick = renderTokens;
        renderTokens(); // Initial load

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
        if (!container.innerHTML.includes('Page Variables')) {
            container.innerHTML = '<div class="empty-state">Analyzing Page...</div>';
        }
    }

    try {
        const globals = await pageVariablesManager.getVariables(force);

        const addAction = () => {
            showNewItemModal('Add Global Variable', [
                { key: 'name', label: 'Variable Name', default: 'newVar' },
                { key: 'value', label: 'Value (JSON/String)', default: '""' }
            ], async (result) => {
                if (!result.name) return;
                try {
                    await pageVariablesManager.setVariable(result.name, result.value);
                    renderPageVariables(container, true);
                } catch (e) {
                    alert('Add Variable Failed: ' + e.message);
                }
            });
        };

        setupAddContextMenu(container, [{ label: 'Add Global Variable', action: addAction }]);

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
                        Refresh
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
                        width: '150px',
                        render: (val, item) => {
                            if (item.details) {
                                return `${item.key}   <span style="font-size:10px; background:var(--accent-primary); color:white; padding:1px 4px; border-radius:2px; margin-left:4px;">${item.details}</span>`;
                            }
                            return item.key;
                        }
                    },
                    { key: 'type', label: 'Type', width: '80px' },
                    {
                        key: 'value',
                        label: 'Value',
                        width: '200px',
                        render: (val, item) => renderValueWithPreviews(val, item)
                    }
                ],
                enableGlobalContextMenu: false,
                onEdit: (item) => {
                    // Prettify if it looks like an object/array
                    let val = item.value;
                    let lang = 'json'; // default to json/js highlighting

                    editor.open(val, lang, async (newVal) => {
                        try {
                            await pageVariablesManager.setVariable(item.key, newVal);
                            renderPageVariables(container);
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
