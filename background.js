// Background Service Worker

// Listen for icon click
chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;

    const targetTabId = tab.id.toString();
    const extensionUrl = chrome.runtime.getURL('popup/popup.html');

    // Check if window already exists
    // We remove the type filter to be safe and check all windows
    const windows = await chrome.windows.getAll({ populate: true });

    const existingWindow = windows.find(w => {
        if (!w.tabs) return false;
        return w.tabs.some(t => {
            if (!t.url || !t.url.startsWith(extensionUrl)) return false;
            try {
                const urlObj = new URL(t.url);
                return urlObj.searchParams.get('targetTabId') === targetTabId;
            } catch (e) {
                return false;
            }
        });
    });

    if (existingWindow) {
        await chrome.windows.update(existingWindow.id, { focused: true });
        return;
    }

    const targetUrl = `popup/popup.html?targetTabId=${tab.id}`;

    // Create a new window (Popup type) pointing to our app
    // Pass the target tabId in the URL so the popup knows which tab to inspect
    const width = 1000;
    const height = 700;

    await chrome.windows.create({
        url: targetUrl,
        type: 'popup',
        width: width,
        height: height,
        focused: true
    });
});

// Handle Cookies API proxy logic if needed
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'getCookies') {
        const url = request.url || (sender.tab ? sender.tab.url : null);
        if (!url) {
            sendResponse([]);
            return;
        }
        chrome.cookies.getAll({ url }, (cookies) => {
            sendResponse(cookies);
        });
        return true; // async
    }
});
