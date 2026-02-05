/**
 * Storage Manager Inspector Script
 * Injected into the page to access storage APIs.
 */

(function () {
    if (window.__storageManagerInjected) {
        return;
    }
    window.__storageManagerInjected = true;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // console.log('StorageManager: Message received', request);

        try {
            if (request.type === 'getLocalStorage') {
                sendResponse({ data: { ...localStorage } });
            }
            else if (request.type === 'getSessionStorage') {
                sendResponse({ data: { ...sessionStorage } });
            }
            else if (request.type === 'setLocalStorage') {
                localStorage.setItem(request.key, request.value);
                sendResponse({ success: true });
            }
            else if (request.type === 'removeLocalStorage') {
                localStorage.removeItem(request.key);
                sendResponse({ success: true });
            }
            else if (request.type === 'setSessionStorage') {
                sessionStorage.setItem(request.key, request.value);
                sendResponse({ success: true });
            }
            else if (request.type === 'removeSessionStorage') {
                sessionStorage.removeItem(request.key);
                sendResponse({ success: true });
            }
            else if (request.type === 'getIndexedDBList') {
                (async () => {
                    try {
                        const dbs = await indexedDB.databases();
                        const result = [];
                        for (const dbInfo of dbs) {
                            if (!dbInfo.name) continue; // Skip unnamed?
                            try {
                                const db = await new Promise((resolve, reject) => {
                                    const req = indexedDB.open(dbInfo.name);
                                    req.onsuccess = () => resolve(req.result);
                                    req.onerror = () => reject(req.error);
                                });
                                result.push({
                                    name: dbInfo.name,
                                    version: dbInfo.version,
                                    stores: [...db.objectStoreNames]
                                });
                                db.close();
                            } catch (e) {
                                console.error(`Failed to open DB ${dbInfo.name}`, e);
                                // Push minimal info if open fails
                                result.push({ name: dbInfo.name, version: dbInfo.version, stores: [], error: e.message });
                            }
                        }
                        sendResponse({ data: result });
                    } catch (e) {
                        sendResponse({ error: e.message });
                    }
                })();
                return true;
            }
            else if (request.type === 'getIndexedDBStoreData') {
                (async () => {
                    try {
                        const db = await new Promise((resolve, reject) => {
                            const req = indexedDB.open(request.dbName);
                            req.onsuccess = () => resolve(req.result);
                            req.onerror = () => reject(req.error);
                        });

                        const tx = db.transaction(request.storeName, 'readonly');
                        const store = tx.objectStore(request.storeName);
                        const items = await new Promise((resolve, reject) => {
                            const req = store.getAll();
                            req.onsuccess = () => resolve(req.result);
                            req.onerror = () => reject(req.error);
                        });

                        const keys = await new Promise((resolve, reject) => {
                            const req = store.getAllKeys();
                            req.onsuccess = () => resolve(req.result);
                            req.onerror = () => reject(req.error);
                        });

                        // Zip keys and values
                        const data = items.map((val, i) => ({ key: keys[i], value: val }));

                        db.close();
                        sendResponse({ data: data });
                    } catch (e) {
                        sendResponse({ error: e.message });
                    }
                })();
                return true;
            }
            else if (request.type === 'putIndexedDBItem') {
                (async () => {
                    try {
                        const db = await new Promise((resolve, reject) => {
                            const req = indexedDB.open(request.dbName);
                            req.onsuccess = () => resolve(req.result);
                            req.onerror = () => reject(req.error);
                        });
                        const tx = db.transaction(request.storeName, 'readwrite');
                        const store = tx.objectStore(request.storeName);
                        // Using 'put' handles both add and update.
                        // If 'key' is provided separately, use it if store doesn't have auto-increment/keyPath issues
                        // For KV-style (no keyPath), put(value, key) is standard.
                        await new Promise((resolve, reject) => {
                            const req = store.put(request.value, request.key);
                            req.onsuccess = () => resolve();
                            req.onerror = () => reject(req.error);
                        });
                        db.close();
                        sendResponse({ success: true });
                    } catch (e) {
                        sendResponse({ error: e.message });
                    }
                })();
                return true;
            }
            else if (request.type === 'createIndexedDBStore') {
                (async () => {
                    try {
                        // Get current version to increment it
                        const dbs = await indexedDB.databases();
                        const dbInfo = dbs.find(d => d.name === request.dbName);
                        const nextVersion = dbInfo ? (dbInfo.version + 1) : 1;

                        const req = indexedDB.open(request.dbName, nextVersion);
                        req.onupgradeneeded = (e) => {
                            const db = e.target.result;
                            if (!db.objectStoreNames.contains(request.storeName)) {
                                db.createObjectStore(request.storeName);
                            }
                        };
                        req.onsuccess = (e) => {
                            e.target.result.close();
                            sendResponse({ success: true });
                        };
                        req.onerror = (e) => {
                            sendResponse({ error: e.target.error ? e.target.error.message : 'Unknown error' });
                        };
                    } catch (e) {
                        sendResponse({ error: e.message });
                    }
                })();
                return true;
            }
            else if (request.type === 'getCacheList') {
                (async () => {
                    try {
                        const keys = await caches.keys();
                        sendResponse({ data: keys });
                    } catch (e) {
                        sendResponse({ error: e.message });
                    }
                })();
                return true;
            }
            else if (request.type === 'getCacheItems') {
                (async () => {
                    try {
                        const cache = await caches.open(request.cacheName);
                        const requests = await cache.keys();
                        // Limit to 50 for performance? or serialize properly
                        const items = await Promise.all(requests.map(async (req) => {
                            const responses = await cache.match(req);
                            return {
                                url: req.url,
                                method: req.method,
                                status: responses ? responses.status : 'N/A',
                                type: responses ? responses.type : 'N/A'
                            };
                        }));
                        sendResponse({ data: items });
                    } catch (e) {
                        sendResponse({ error: e.message });
                    }
                })();
                return true;
            }
            else if (request.type === 'addCacheItem') {
                (async () => {
                    try {
                        const cache = await caches.open(request.cacheName);
                        await cache.add(request.url);
                        sendResponse({ success: true });
                    } catch (e) {
                        sendResponse({ error: e.message });
                    }
                })();
                return true;
            }
            else if (request.type === 'getQuota') {
                navigator.storage.estimate().then(estimate => {
                    sendResponse({ data: estimate });
                }).catch(e => sendResponse({ error: e.message }));
                return true;
            }
            else if (request.type === 'getStorageBuckets') {
                (async () => {
                    try {
                        if (navigator.storageBuckets && navigator.storageBuckets.keys) {
                            const keys = await navigator.storageBuckets.keys();
                            sendResponse({ data: keys });
                        } else {
                            sendResponse({ data: [], supported: false });
                        }
                    } catch (e) {
                        sendResponse({ error: e.message });
                    }
                })();
                return true;
            }
            else if (request.type === 'getFileSystem') {
                (async () => {
                    try {
                        const root = await navigator.storage.getDirectory();
                        // Recursive reader
                        const readDir = async (dirHandle) => {
                            const entries = [];
                            for await (const [name, handle] of dirHandle.entries()) {
                                if (handle.kind === 'file') {
                                    const file = await handle.getFile();
                                    entries.push({
                                        name,
                                        kind: 'file',
                                        size: file.size,
                                        type: file.type,
                                        lastModified: file.lastModified
                                    });
                                } else {
                                    const children = await readDir(handle);
                                    entries.push({ name, kind: 'directory', children });
                                }
                            }
                            return entries;
                        };
                        const files = await readDir(root);
                        sendResponse({ data: files });
                    } catch (e) {
                        sendResponse({ error: e.message });
                    }
                })();
                return true;
            }
            else if (request.type === 'downloadFile') {
                (async () => {
                    try {
                        const root = await navigator.storage.getDirectory();
                        const parts = request.path.split('/').filter(p => p);
                        let handle = root;

                        // Navigate to file
                        for (let i = 0; i < parts.length - 1; i++) {
                            handle = await handle.getDirectoryHandle(parts[i]);
                        }

                        const fileHandle = await handle.getFileHandle(parts[parts.length - 1]);
                        const file = await fileHandle.getFile();

                        // Convert to base64 for message passing
                        // For very large files, this might be slow, but it's the most compatible way for a response
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            sendResponse({
                                data: reader.result.split(',')[1],
                                name: file.name,
                                type: file.type
                            });
                        };
                        reader.onerror = () => sendResponse({ error: 'Failed to read file' });
                        reader.readAsDataURL(file);
                    } catch (e) {
                        sendResponse({ error: e.message });
                    }
                })();
                return true;
            }
            else if (request.type === 'getServiceWorkers') {
                navigator.serviceWorker.getRegistrations().then(regs => {
                    const data = regs.map(r => ({
                        scope: r.scope,
                        active: r.active ? { scriptURL: r.active.scriptURL, state: r.active.state } : null,
                        waiting: r.waiting ? { scriptURL: r.waiting.scriptURL, state: r.waiting.state } : null,
                        installing: r.installing ? { scriptURL: r.installing.scriptURL, state: r.installing.state } : null,
                        updateViaCache: r.updateViaCache
                    }));
                    sendResponse({ data: data });
                }).catch(e => sendResponse({ error: e.message }));
                return true;
            }
            else if (request.type === 'getSharedStorage') {
                // Shared Storage is very restricted and often write-only or worklet-only.
                // We can't easily iterate keys like localStorage.
                // We'll check if API exists.
                if (window.sharedStorage) {
                    // Can't read directly unless in specific context, usually. 
                    // Reporting availability.
                    sendResponse({ data: { available: true, message: 'Shared Storage API is present but read-protected by privacy sandbox.' } });
                } else {
                    sendResponse({ data: { available: false } });
                }
                return true;
            }
            else {
                return false; // synchronous response
            }
        } catch (e) {
            sendResponse({ error: e.message });
        }
        return true; // Keep channel open
    });
})();
