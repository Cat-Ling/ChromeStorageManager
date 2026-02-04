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
                callback(request.content);

                sendResponse({ success: true });
                // We keep the callback in the map so they can save multiple times
            }
        });
    }

    async open(content, language = 'javascript', onSave, uniqueKey = null) {
        // If a uniqueKey is provided, check if we already have a window for it
        if (uniqueKey && this.activeEdits.has(uniqueKey)) {
            const existingCallback = this.activeEdits.get(uniqueKey);
            // If we have a window ID stored (we need to track it separately or augment the map)
            // Actually, let's change the map structure or add a secondary map.
            // For simplicity, let's assume we can focus if we find it.
        }

        // Better approach:
        // Maintains a map of uniqueKey -> { windowId, returnId }
        // If uniqueKey exists, try to focus that window.
        // If focusing fails (window closed), remove from map and proceed.

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
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) myTabId = tab.id;

        if (!myTabId) {
            console.error('Could not determine my own tab ID');
            return;
        }

        // Prepare content transfer
        chrome.runtime.onMessage.addListener(function handShake(request, sender, sendResponse) {
            if (request.type === 'EDITOR_READY' && request.returnId === returnId) {
                sendResponse({ content: content });
                chrome.runtime.onMessage.removeListener(handShake);
            }
        });

        // Open the window
        const win = await chrome.windows.create({
            url: `popup/editor.html?parentTabId=${myTabId}&returnId=${returnId}&lang=${language}`,
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
