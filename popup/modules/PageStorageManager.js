/**
 * Page Storage Manager (LocalStorage / SessionStorage)
 */
export class PageStorageManager {
    constructor(storageType = 'localStorage') {
        this.storageType = storageType; // 'localStorage' or 'sessionStorage'
        this.tabId = null;
    }

    async connect(tabId) {
        this.tabId = tabId;
        // Inject the inspector script
        await chrome.scripting.executeScript({
            target: { tabId: this.tabId },
            files: ['content/inspector.js']
        });
    }

    async getAll() {
        if (!this.tabId) return [];

        const method = this.storageType === 'localStorage' ? 'getLocalStorage' : 'getSessionStorage';

        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(this.tabId, { type: method }, (response) => {
                if (chrome.runtime.lastError) {
                    // If message fails, maybe script isn't ready or frame issues. 
                    // Retry injection? For now, resolve empty.
                    console.warn('Message failed:', chrome.runtime.lastError);
                    resolve([]);
                    return;
                }

                if (response && response.data) {
                    // Convert object to array of { key, value }
                    const items = Object.entries(response.data).map(([key, value]) => ({
                        key,
                        value,
                        type: this.storageType
                    }));
                    resolve(items);
                } else {
                    resolve([]);
                }
            });
        });
    }

    async delete(item) {
        const method = this.storageType === 'localStorage' ? 'removeLocalStorage' : 'removeSessionStorage';

        return new Promise((resolve) => {
            chrome.tabs.sendMessage(this.tabId, { type: method, key: item.key }, (response) => {
                resolve(response);
            });
        });
    }
}
