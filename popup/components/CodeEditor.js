/**
 * Code Editor Component (Standalone Window Launcher)
 */
export class CodeEditor {
    constructor(container) {
        this.activeEdits = new Map(); // returnId -> onSave callback

        // Listen for save messages from editor windows
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === 'EDITOR_SAVE' && this.activeEdits.has(request.returnId)) {

                const callback = this.activeEdits.get(request.returnId);
                // We now support (content, isRaw) signature
                // But old callbacks might expect just (content).
                // JS ignores extra args, so passing (content, request.isRaw) is safe.
                callback(request.content, request.isRaw);

                sendResponse({ success: true });
                // We keep the callback in the map so they can save multiple times
            }
        });
    }

    async open(content, language = 'javascript', onSave, uniqueKey = null, originalContent = null) {
        // Option to reuse window if uniqueKey provided
        if (uniqueKey) {
            if (!this.windowMap) this.windowMap = new Map();

            if (this.windowMap.has(uniqueKey)) {
                const winData = this.windowMap.get(uniqueKey);
                try {
                    await chrome.windows.update(winData.windowId, { focused: true });
                    // Update the callback just in case? Usually the callback is stable for the same item.
                    this.activeEdits.set(winData.returnId, onSave);
                    return;
                } catch (e) {
                    // Window likely closed externally, cleanup
                    this.windowMap.delete(uniqueKey);
                }
            }
        }

        const returnId = Date.now().toString();
        this.activeEdits.set(returnId, onSave); // Register callback

        // Get current window tab ID to pass as parentTabId
        let myTabId = null;
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) myTabId = tab.id;
        } catch (e) { }

        if (!myTabId) {
            console.error('Could not determine my own tab ID');
            // Can't proceed without parent ID for messaging in some contexts, but let's try
        }

        // Prepare content transfer
        let blobUrl = null;
        let contentToPass = content;
        let originalToPass = originalContent;

        // Optimization: Use Blob URL for very large content to avoid IPC overhead
        if (typeof content === 'string' && content.length > 1024 * 512) {
            const blob = new Blob([content], { type: 'text/plain' });
            blobUrl = URL.createObjectURL(blob);
            contentToPass = { isBlob: true, url: blobUrl };
        }

        chrome.runtime.onMessage.addListener(function handShake(request, sender, sendResponse) {
            if (request.type === 'EDITOR_READY' && request.returnId === returnId) {
                // Pass both decoded content and original (raw) content
                sendResponse({
                    content: contentToPass,
                    originalContent: originalToPass
                });

                // Cleanup Blob URL after some time to ensure it's fetched
                if (blobUrl) {
                    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
                }

                chrome.runtime.onMessage.removeListener(handShake);
            }
        });

        // Open the window
        // Ensure language is safe for URL
        const safeLang = encodeURIComponent(language);
        const win = await chrome.windows.create({
            url: `popup/editor.html?parentTabId=${myTabId || ''}&returnId=${returnId}&lang=${safeLang}`,
            type: 'popup',
            width: 800,
            height: 600,
            focused: true
        });

        if (uniqueKey && win.id) {
            if (!this.windowMap) this.windowMap = new Map();
            this.windowMap.set(uniqueKey, { windowId: win.id, returnId: returnId });
        }
    }
}
