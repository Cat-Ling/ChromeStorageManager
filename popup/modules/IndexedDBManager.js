/**
 * IndexDB Manager
 */
export class IndexedDBManager {
    constructor() {
        this.tabId = null;
    }

    async connect(tabId) {
        this.tabId = tabId;
        await chrome.scripting.executeScript({
            target: { tabId: this.tabId },
            files: ['content/inspector.js']
        });
    }

    async getDatabases() {
        if (!this.tabId) return [];

        return new Promise((resolve) => {
            chrome.tabs.sendMessage(this.tabId, { type: 'getIndexedDBList' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn(chrome.runtime.lastError);
                    resolve([]);
                    return;
                }
                resolve(response && response.data ? response.data : []);
            });
        });
    }

    async getStoreData(dbName, storeName) {
        return new Promise((resolve) => {
            chrome.tabs.sendMessage(this.tabId, {
                type: 'getIndexedDBStoreData',
                dbName,
                storeName
            }, (response) => {
                if (response && response.data) {
                    resolve(response.data);
                } else {
                    resolve([]);
                }
            });
        });
    }

    async putItem(dbName, storeName, key, value) {
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(this.tabId, {
                type: 'putIndexedDBItem',
                dbName,
                storeName,
                key,
                value
            }, (response) => {
                if (response && response.error) reject(new Error(response.error));
                else resolve(response);
            });
        });
    }

    async createStore(dbName, storeName) {
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(this.tabId, {
                type: 'createIndexedDBStore',
                dbName,
                storeName
            }, (response) => {
                if (response && response.error) reject(new Error(response.error));
                else resolve(response);
            });
        });
    }
}
