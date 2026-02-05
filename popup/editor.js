/**
 * Standalone Editor Logic
 */

let cmInstance = null;
let parentTabId = null;
let returnId = null; // ID to match the save callback
let originalContent = null; // Raw encoded content
let decodedContent = null; // The pretty/decoded content
let isViewOriginal = false;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Parse URL params
    const params = new URLSearchParams(window.location.search);
    parentTabId = parseInt(params.get('parentTabId'), 10);
    returnId = params.get('returnId');
    const initialLang = params.get('lang') || 'javascript';

    // Modal Logic
    document.getElementById('close-modal').onclick = () => {
        document.getElementById('image-modal').style.display = 'none';
        document.getElementById('preview-image').src = '';
    };

    // 2. Init CodeMirror
    const mount = document.getElementById('editor-mount');
    cmInstance = CodeMirror(mount, {
        value: "",
        mode: initialLang === 'json' ? { name: "javascript", json: true } : "javascript",
        theme: "dracula",
        lineNumbers: true,
        autoCloseBrackets: true,
        matchBrackets: true,
        tabSize: 2
    });

    document.getElementById('lang-mode').textContent = initialLang.toUpperCase();

    // 3. Request Content from Parent
    if (parentTabId) {
        // Show a "Waiting for parent..." status or overlay
        const overlay = showLoadingOverlay("Initializing Editor...");

        try {
            chrome.tabs.sendMessage(parentTabId, { type: 'EDITOR_READY', returnId }, async (response) => {
                if (response && response.content !== undefined) {
                    let content = response.content;

                    // Handle Blob URLs
                    if (content && typeof content === 'object' && content.isBlob) {
                        try {
                            const res = await fetch(content.url);
                            content = await res.text();
                        } catch (e) {
                            console.error('Failed to fetch blob content:', e);
                            content = "Error: Failed to load large content blob.";
                        }
                    }

                    if (typeof content !== 'string') {
                        content = JSON.stringify(content, null, 2);
                    }

                    decodedContent = content; // Default start is decoded

                    // Optimization for Large Files (> 200KB)
                    if (content.length > 200000) {
                        loadContentChunked(content, overlay);
                    } else {
                        cmInstance.setValue(content);
                        cmInstance.clearHistory();
                        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    }

                    // Handle Original Content
                    if (response.originalContent !== undefined && response.originalContent !== null && response.originalContent !== content) {
                        originalContent = response.originalContent;
                        setupOriginalToggle();
                    }
                } else {
                    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    setStatus('Error: Could not retrieve content');
                }
            });
        } catch (e) {
            console.error('Failed to contact parent:', e);
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }
    }

    // 4. Bind Events
    setupMenu();
    setupShortcuts();

    // 5. Auto-scan for images
    setupImageScanning();
    setupLinkHandling();
});

// --- Dynamic Chunked Loading ---
function showLoadingOverlay(title = "Loading...") {
    const overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.8); z-index: 3000;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        color: white; font-family: sans-serif;
    `;
    overlay.innerHTML = `
        <div id="loader-title" style="font-size: 1.2em; margin-bottom: 10px;">${title}</div>
        <div style="width: 300px; height: 10px; background: #333; border-radius: 5px; overflow: hidden;">
            <div id="loader-bar" style="width: 0%; height: 100%; background: var(--accent-primary, #0af); transition: width 0.1s;"></div>
        </div>
        <div id="loader-pct" style="margin-top: 5px; font-size: 0.9em; opacity: 0.8;">0%</div>
    `;
    document.body.appendChild(overlay);
    return overlay;
}

function loadContentChunked(content, existingOverlay = null) {
    const overlay = existingOverlay || showLoadingOverlay("Loading Large File...");
    const titleEl = document.getElementById('loader-title');
    if (titleEl) titleEl.textContent = "Loading Content...";

    cmInstance.setValue(""); // Clear first
    const chunkSize = 256 * 1024; // 256KB chunks
    let offset = 0;
    const total = content.length;
    const bar = document.getElementById('loader-bar');
    const pct = document.getElementById('loader-pct');

    function processChunk() {
        if (offset < total) {
            const end = Math.min(offset + chunkSize, total);
            const chunk = content.substring(offset, end);

            // Append to end of doc
            cmInstance.replaceRange(chunk, { line: cmInstance.lastLine(), ch: 100000000 });

            offset = end;

            const progress = Math.round((offset / total) * 100);
            if (bar) bar.style.width = `${progress}%`;
            if (pct) pct.textContent = `${progress}%`;

            // Request next chunk immediately if not finished
            requestAnimationFrame(processChunk);
        } else {
            // Done
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
            setStatus(`Loaded ${Math.round(total / 1024)}KB`);
            cmInstance.clearHistory();
        }
    }

    processChunk();
}

function setupOriginalToggle() {
    const menuBar = document.querySelector('.menubar');
    const btn = document.createElement('div');
    btn.className = 'menu-item';
    btn.style.marginLeft = 'auto'; // push to right
    btn.style.marginRight = '8px';
    btn.title = 'Switch between Decoded view and Original Raw value';

    // Initial State
    btn.innerHTML = `<span style="opacity: 0.7;">View: </span><span id="view-mode-label" style="font-weight:600; color:var(--accent-primary);">Decoded</span>`;

    menuBar.appendChild(btn);

    btn.id = 'view-toggle-btn';
    btn.onclick = toggleViewMode;
}

function toggleViewMode() {
    const btnLabel = document.getElementById('view-mode-label');

    if (isViewOriginal) {
        // Switch to Decoded
        originalContent = cmInstance.getValue(); // Update ref (though user knows editing raw might break decoding)

        // Check size again?
        if (decodedContent.length > 500000) {
            loadContentChunked(decodedContent);
        } else {
            cmInstance.setValue(decodedContent);
        }

        btnLabel.textContent = 'Decoded';
        setStatus('Switched to Decoded View');
        isViewOriginal = false;
    } else {
        // Switch to Original
        decodedContent = cmInstance.getValue(); // Save edits to decoded buffer

        if (originalContent.length > 500000) {
            loadContentChunked(originalContent);
        } else {
            cmInstance.setValue(originalContent);
        }

        btnLabel.textContent = 'Original (Raw)';
        setStatus('Switched to Raw View');
        isViewOriginal = true;
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Image Widget & Scanning Logic
let imageRanges = []; // Track ranges of collapsed images
let scannedLines = new Set(); // Track which lines we've already processed

function setupImageScanning() {
    // Initial scan of viewport
    cmInstance.on('viewportChange', (cm, from, to) => {
        scanViewportImages(from, to);
    });

    // On change, we might need to re-scan modified lines
    cmInstance.on('change', (cm, changeObj) => {
        const fromLine = changeObj.from.line;
        const toLine = changeObj.to.line;
        // Invalidate scanned status for touched lines
        for (let i = fromLine; i <= toLine; i++) {
            scannedLines.delete(i);
        }

        // Trigger a scan of the current viewport shortly after
        const vp = cmInstance.getViewport();
        scanViewportImages(vp.from, vp.to);
    });

    // Initial scan
    setTimeout(() => {
        const vp = cmInstance.getViewport();
        scanViewportImages(vp.from, vp.to);
    }, 500);
}

function scanViewportImages(from, to) {
    const doc = cmInstance.getDoc();

    // We iterate line by line in the viewport
    for (let i = from; i < to; i++) {
        if (scannedLines.has(i)) continue; // Skip already processed lines

        const lineText = doc.getLine(i);
        if (!lineText || lineText.length < 50) { // optimization: skip short lines
            scannedLines.add(i);
            continue;
        }

        // Fast check: does it even contain "data:image"?
        if (lineText.indexOf('data:image') === -1) {
            scannedLines.add(i);
            continue;
        }

        // Regex for header: quote + data:image/...;base64,
        const headerRegex = /(['"])data:image\/[a-zA-Z0-9.\-+]+;base64,/g;

        let match;
        while ((match = headerRegex.exec(lineText)) !== null) {
            const quote = match[1];
            const header = match[0];
            const startCh = match.index;
            const payloadStartCh = startCh + header.length;

            // Find closing quote starting from payload
            const endCh = lineText.indexOf(quote, payloadStartCh);
            if (endCh === -1) continue;

            if (payloadStartCh >= endCh) continue;

            const fromPos = { line: i, ch: payloadStartCh };
            const toPos = { line: i, ch: endCh };

            // Check existing marks to avoid duplication (Crucial for performance/memory)
            const existingMarks = cmInstance.findMarks(fromPos, toPos);
            const alreadyMarked = existingMarks.some(m => m.className === 'image-preview-mark');
            if (alreadyMarked) continue;

            createImageMark(fromPos, toPos);
            imageRanges.push({ from: fromPos, to: toPos });
        }
        scannedLines.add(i);
    }
}

function createImageMark(from, to) {
    const btn = document.createElement('span');
    btn.textContent = ' [IMAGE PREVIEW] ';
    btn.className = 'cm-image-widget';
    btn.style.backgroundColor = 'var(--accent-color, #007bff)';
    btn.style.color = '#fff';
    btn.style.padding = '2px 6px';
    btn.style.borderRadius = '4px';
    btn.style.fontSize = '11px';
    btn.style.cursor = 'pointer';
    btn.style.marginLeft = '4px';
    btn.style.verticalAlign = 'middle';
    btn.title = 'Content Hidden. Click to preview.';

    btn.onclick = (e) => {
        e.stopPropagation();
        const doc = cmInstance.getDoc();
        const lineText = doc.getLine(from.line);
        const textUpToPayload = lineText.substring(0, from.ch);
        const headerStart = textUpToPayload.lastIndexOf('data:image');
        if (headerStart !== -1) {
            const fullSrc = lineText.substring(headerStart, to.ch);
            showImagePreview(fullSrc);
        }
    };

    cmInstance.markText(from, to, {
        replacedWith: btn,
        atomic: true,
        className: 'image-preview-mark',
        clearOnEnter: false
    });
}

function showImagePreview(src) {
    const modal = document.getElementById('image-modal');
    const img = document.getElementById('preview-image');
    img.src = src;
    modal.style.display = 'flex';
}

function setupMenu() {
    document.getElementById('menu-save').onclick = saveToParent;
    document.getElementById('menu-format').onclick = prettyPrint;
    document.getElementById('menu-load').onclick = loadFromFile;
    document.getElementById('menu-export').onclick = exportToFile;
}

function setupShortcuts() {
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveToParent();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
            e.preventDefault();
            loadFromFile();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            toggleFind();
        }
        // Select All Instances (Ctrl+Shift+L)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
            e.preventDefault();
            selectAllInstances();
        }
    });

    setupFindEvents();
    setupContextMenu();
}

function setupContextMenu() {
    const menu = document.getElementById('context-menu');
    const editorEl = document.querySelector('.CodeMirror');

    editorEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        // Only show if text is selected? Or allow selecting word under cursor?
        if (!cmInstance.somethingSelected()) {
            const cursor = cmInstance.getCursor();
            const word = cmInstance.findWordAt(cursor);
            cmInstance.setSelection(word.anchor, word.head);
        }

        const sel = cmInstance.getSelection();
        if (!sel) return; // Should have selection now

        // Position menu
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
    });

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) {
            menu.style.display = 'none';
        }
    });

    document.getElementById('ctx-select-all').onclick = () => {
        selectAllInstances();
        menu.style.display = 'none';
    };
}

function selectAllInstances() {
    const query = cmInstance.getSelection();
    if (!query) return;

    const matches = findAllMatches(query, searchState.caseSensitive);
    if (matches.length === 0) return;

    const ranges = matches.map(m => ({
        anchor: { line: m.line, ch: m.ch },
        head: { line: m.line, ch: m.endCh }
    }));

    cmInstance.setSelections(ranges);
    cmInstance.focus();
}

async function saveToParent() {
    if (!parentTabId) return;

    // Use content from current view
    const content = cmInstance.getValue();
    setStatus('Saving...');

    // Update our internal refs
    if (isViewOriginal) {
        originalContent = content;
    } else {
        decodedContent = content;
    }

    chrome.tabs.sendMessage(parentTabId, {
        type: 'EDITOR_SAVE',
        returnId,
        content,
        isRaw: isViewOriginal // Flag to tell parent whether to encode or not
    }, (response) => {
        if (response && response.success) {
            setStatus('Saved!');
            setTimeout(() => {
                if (isViewOriginal) setStatus('Switched to Raw View');
                else setStatus('Switched to Decoded View');
            }, 2000);
        } else {
            setStatus('Error saving');
        }
    });
}

async function loadFromFile() {
    try {
        const [handle] = await window.showOpenFilePicker();
        const file = await handle.getFile();
        const text = await file.text();
        cmInstance.setValue(text);
        setStatus(`Loaded: ${file.name}`);
    } catch (e) {
        console.log(e);
    }
}

async function exportToFile() {
    try {
        const content = cmInstance.getValue();
        const handle = await window.showSaveFilePicker({
            types: [{
                description: 'Text Files',
                accept: { 'text/plain': ['.txt', '.js', '.json'] }
            }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        setStatus('Exported successfully');
    } catch (e) {
        console.log(e);
    }
}

async function prettyPrint() {
    const content = cmInstance.getValue();
    if (!content) return;

    try {
        // 1. Try JSON
        const json = JSON.parse(content);
        cmInstance.setValue(JSON.stringify(json, null, 2));
        cmInstance.setOption('mode', { name: "javascript", json: true });
        setStatus('Formatted JSON');
        return;
    } catch (e) {
        // Not simple JSON
    }

    try {
        // 2. Try URL Decoded JSON (common in cookies)
        const decoded = decodeURIComponent(content);
        if (decoded !== content) {
            try {
                const json = JSON.parse(decoded);
                cmInstance.setValue(JSON.stringify(json, null, 2));
                cmInstance.setOption('mode', { name: "javascript", json: true });
                setStatus('Decoded & Formatted JSON');
                return;
            } catch (e) { }
        }
    } catch (e) { }

    // 3. Simple generic format
    try {
        let formatted = content
            .replace(/{/g, '{\n')
            .replace(/}/g, '\n}')
            .replace(/;/g, ';\n')
            .replace(/,/g, ',\n');
        cmInstance.setValue(formatted);
        setStatus('Simple formatting applied');
    } catch (e) {
        setStatus('Formatting failed');
    }
}



// --- Find Logic ---
let searchState = {
    query: '',
    results: [], // { line, ch, endCh }
    currentIndex: -1,
    caseSensitive: false
};

function toggleFind() {
    const bar = document.getElementById('find-bar');
    const input = document.getElementById('find-input');

    if (bar.style.display === 'none') {
        bar.style.display = 'flex';
        input.focus();
        input.select();
        // If there's a selection in editor, prefills it
        const sel = cmInstance.getSelection();
        if (sel) {
            input.value = sel;
            performFind();
        }
    } else {
        bar.style.display = 'none';
        cmInstance.focus();
    }
}

function toggleCaseSensitivity() {
    searchState.caseSensitive = !searchState.caseSensitive;
    const btn = document.getElementById('find-case');
    if (searchState.caseSensitive) {
        btn.style.backgroundColor = 'var(--bg-active, #444)';
        btn.style.color = 'var(--text-primary)';
        btn.style.borderColor = 'var(--border-color)';
    } else {
        btn.style.backgroundColor = 'transparent';
        btn.style.color = 'var(--text-secondary)';
        btn.style.borderColor = 'transparent';
    }
    performFind();
}

function findAllMatches(query, caseSensitive) {
    if (!query) return [];

    const results = [];
    const doc = cmInstance.getDoc();
    const lineCount = doc.lineCount();

    // Validate inputs
    if (typeof query !== 'string') return [];

    const normQuery = caseSensitive ? query : query.toLowerCase();

    for (let i = 0; i < lineCount; i++) {
        const lineText = doc.getLine(i);
        const normLine = caseSensitive ? lineText : lineText.toLowerCase();

        let pos = 0;
        while (pos < lineText.length) {
            const idx = normLine.indexOf(normQuery, pos);
            if (idx === -1) break;

            const matchStart = { line: i, ch: idx };
            const matchEnd = { line: i, ch: idx + query.length };

            // Check overlap with hidden images
            const isInsideImage = imageRanges.some(img => {
                if (img.from.line !== i) return false;
                return (matchStart.ch >= img.from.ch && matchEnd.ch <= img.to.ch);
            });

            if (!isInsideImage) {
                results.push({
                    line: i,
                    ch: idx,
                    endCh: idx + query.length
                });
            }
            pos = idx + 1;
        }
    }
    return results;
}

function performFind() {
    const query = document.getElementById('find-input').value;
    const results = findAllMatches(query, searchState.caseSensitive);
    searchState = { ...searchState, query, results, currentIndex: -1 };

    if (results.length > 0) {
        findNext();
    } else {
        document.getElementById('find-count').textContent = '0/0';
    }
}

function findNext() {
    if (searchState.results.length === 0) return;
    searchState.currentIndex++;
    if (searchState.currentIndex >= searchState.results.length) {
        searchState.currentIndex = 0; // wrap
    }
    highlightResult(searchState.currentIndex);
}

function findPrev() {
    if (searchState.results.length === 0) return;
    searchState.currentIndex--;
    if (searchState.currentIndex < 0) {
        searchState.currentIndex = searchState.results.length - 1; // wrap
    }
    highlightResult(searchState.currentIndex);
}

function highlightResult(index) {
    const match = searchState.results[index];
    document.getElementById('find-count').textContent = `${index + 1}/${searchState.results.length}`;

    cmInstance.setSelection(
        { line: match.line, ch: match.ch },
        { line: match.line, ch: match.endCh }
    );
    cmInstance.scrollIntoView({
        from: { line: match.line, ch: match.ch },
        to: { line: match.line, ch: match.endCh }
    }, 200);
}

function setupFindEvents() {
    document.getElementById('find-input').addEventListener('input', performFind);
    document.getElementById('find-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (e.shiftKey) findPrev();
            else findNext();
        }
        if (e.key === 'Escape') toggleFind();
    });
    document.getElementById('find-next').onclick = findNext;
    document.getElementById('find-prev').onclick = findPrev;
    document.getElementById('find-close').onclick = toggleFind;
    document.getElementById('find-case').onclick = toggleCaseSensitivity;

    // Add menu item
    const menuBar = document.querySelector('.menubar');
    if (menuBar && !document.getElementById('menu-find')) {
        const btn = document.createElement('div');
        btn.className = 'menu-item';
        btn.id = 'menu-find';
        btn.textContent = 'Find (Ctrl+F)';
        btn.onclick = toggleFind;
        menuBar.insertBefore(btn, document.getElementById('menu-load'));
    }
}

function setStatus(msg) {
    document.getElementById('status-msg').textContent = msg;
}

function setupLinkHandling() {
    const wrapper = cmInstance.getWrapperElement();

    // Create Tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'link-tooltip';
    tooltip.style.cssText = `
        position: fixed; 
        background: var(--bg-secondary); 
        color: var(--text-primary); 
        padding: 4px 8px; 
        font-size: 11px; 
        border-radius: 4px; 
        pointer-events: none; 
        display: none; 
        z-index: 2000;
        border: 1px solid var(--accent-primary);
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;
    tooltip.textContent = 'Ctrl + Click to open';
    document.body.appendChild(tooltip);

    // Mouse Move - Hint
    wrapper.addEventListener('mousemove', (e) => {
        const coords = { left: e.clientX, top: e.clientY };
        const pos = cmInstance.coordsChar(coords);
        const token = cmInstance.getTokenAt(pos);

        if (token && isUrl(token.string)) {
            // Show hint
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX + 12) + 'px';
            tooltip.style.top = (e.clientY + 12) + 'px';

            // If Ctrl is held, show pointer
            if (e.ctrlKey || e.metaKey) {
                wrapper.style.cursor = 'pointer';
                tooltip.style.fontWeight = 'bold';
            } else {
                wrapper.style.cursor = 'text'; // or default
                tooltip.style.fontWeight = 'normal';
            }
        } else {
            tooltip.style.display = 'none';
            wrapper.style.cursor = '';
        }
    });

    // Keydown/up to update cursor if hovering
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Control' || e.key === 'Meta') {
            if (tooltip.style.display === 'block') wrapper.style.cursor = 'pointer';
        }
    });
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Control' || e.key === 'Meta') {
            if (tooltip.style.display === 'block') wrapper.style.cursor = 'text';
        }
    });

    // Click - Open
    wrapper.addEventListener('click', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;

        const pos = cmInstance.coordsChar({ left: e.clientX, top: e.clientY });
        const token = cmInstance.getTokenAt(pos);
        if (token && isUrl(token.string)) {
            let url = token.string;
            // Clean quotes
            url = url.replace(/['"]/g, '');
            // Handle incomplete URLs if tokenizer split them? 
            // Usually strings are whole.
            window.open(url, '_blank');
        }
    });
}

function isUrl(str) {
    if (!str) return false;
    // Simple check: contains http/https and looks somewhat valid
    const clean = str.replace(/['"]/g, '');
    return /^https?:\/\/[^\s]+$/.test(clean);
}
