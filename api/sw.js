const VERSION_CHECK_URL = 'https://raw.githubusercontent.com/JensTech/Sparx-AI-Tools/refs/heads/main/api/version.json';
const CHECK_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours
const GEMINI_URL = 'https://gemini.google.com/app';
const SAI_START_FLAG = 'SAI_JSON_START';
const SAI_END_FLAG = 'SAI_JSON_END';
const SAI_START_LINE_RE = /(^|\n)\s*SAI_JSON_START\s*(\n|$)/g;
const SAI_END_LINE_RE = /(^|\n)\s*SAI_JSON_END\s*(\n|$)/g;
const DEFAULT_SCIENCE_SETTINGS = {
    geminiResponseTimeoutMs: 120000,
    stableWaitMs: 1300,
    markerRetryCount: 5,
    markerRetryIntervalMs: 400,
    submitAttemptCount: 12,
    submitAttemptIntervalMs: 250,
    nudgeCount: 3,
    nudgeIntervalMs: 7000
};

const LOCAL_VERSION = chrome.runtime.getManifest().version;

async function checkForUpdate() {
    try {
        const response = await fetch(VERSION_CHECK_URL, { cache: 'no-store' });
        if (!response.ok) return;

        const data = await response.json();
        const latest = data.latest;

        if (latest !== LOCAL_VERSION) {
            const storage = await chrome.storage.local.get('notifiedVersion');
            if (storage.notifiedVersion !== latest) {
                chrome.notifications.create('update-notification', {
                    type: 'basic',
                    title: 'Sparx-AI-Tools',
                    message: `New version available: ${latest}. Click to update.`,
                    iconUrl: 'https://cdn.jsdelivr.net/gh/JensTech/jenstech.github.io@main/cdn/img/SparxLogo.png'
                });

                chrome.notifications.onClicked.addListener((id) => {
                    if (id === 'update-notification') {
                        chrome.tabs.create({ url: 'https://github.com/JensTech/Sparx-AI-Tools/releases/latest' });
                    }
                });

                await chrome.storage.local.set({ notifiedVersion: latest });
            }
        } else {
            await chrome.storage.local.set({ notifiedVersion: latest });
        }
    } catch (err) {
        console.error('Version check failed', err);
    }
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('Timed out waiting for Gemini tab to load'));
        }, timeoutMs);

        function listener(updatedTabId, changeInfo) {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        }

        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) return;
            if (tab && tab.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        });
    });
}

function getGeminiTab() {
    return new Promise((resolve) => {
        chrome.tabs.query({}, (tabs) => {
            const existing = (tabs || []).find((t) => (t.url || '').includes('gemini.google.com'));
            resolve(existing || null);
        });
    });
}

async function getOrCreateGeminiTab() {
    const existing = await getGeminiTab();
    if (existing) {
        await new Promise((resolve) => {
            chrome.tabs.update(existing.id, { pinned: true }, () => resolve());
        });
        await waitForTabComplete(existing.id, 30000).catch(() => {});
        return existing;
    }

    const created = await new Promise((resolve, reject) => {
        chrome.tabs.create({ url: GEMINI_URL, active: false, pinned: true }, (tab) => {
            if (chrome.runtime.lastError || !tab) {
                reject(new Error(chrome.runtime.lastError?.message || 'Failed to create Gemini tab'));
                return;
            }
            resolve(tab);
        });
    });

    await waitForTabComplete(created.id, 45000);
    return created;
}

function normalizeScienceImages(images) {
    if (!Array.isArray(images)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of images) {
        const url = String(raw || '').trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push(url);
        if (out.length >= 4) break;
    }
    return out;
}

function executeGeminiPrompt(tabId, prompt, settings, requestId, images) {
    return new Promise((resolve, reject) => {
        const startMarker = requestId ? `${SAI_START_FLAG}:${requestId}` : SAI_START_FLAG;
        const endMarker = requestId ? `${SAI_END_FLAG}:${requestId}` : SAI_END_FLAG;
        const normalizedImages = normalizeScienceImages(images);
        const fallbackReadMarkerBlock = () => {
            chrome.scripting.executeScript(
                {
                    target: { tabId },
                    args: [startMarker, endMarker],
                    func: (startFlag, endFlag) => {
                        const text = (document.body?.innerText || '').trim();
                        if (!text) return '';

                        const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const startGlobalRe = new RegExp(`(^|\\n)\\s*${esc(startFlag)}\\s*(\\n|$)`, 'g');
                        const endGlobalRe = new RegExp(`(^|\\n)\\s*${esc(endFlag)}\\s*(\\n|$)`, 'g');
                        const endMatches = [...text.matchAll(endGlobalRe)];
                        const startMatches = [...text.matchAll(startGlobalRe)];
                        if (!endMatches.length || !startMatches.length) return '';

                        const endIdx = endMatches[endMatches.length - 1].index;
                        let startIdx = -1;
                        for (let i = startMatches.length - 1; i >= 0; i -= 1) {
                            const idx = startMatches[i].index;
                            if (idx < endIdx) {
                                startIdx = idx;
                                break;
                            }
                        }
                        if (startIdx === -1) return '';

                        const endTokenPos = text.indexOf(endFlag, endIdx);
                        if (endTokenPos === -1) return '';
                        return text.slice(startIdx, endTokenPos + endFlag.length).trim();
                    }
                },
                (fallbackResults) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    const fallbackText = fallbackResults?.[0]?.result;
                    if (fallbackText) {
                        resolve(fallbackText);
                        return;
                    }
                    reject(new Error('Gemini returned no code block text (or marker block not found)'));
                }
            );
        };

        chrome.scripting.executeScript(
            {
                target: { tabId },
                func: async (userPrompt, userSettings, startFlag, endFlag, userImages) => {
                    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
                    const localSettings = {
                        ...{
                            geminiResponseTimeoutMs: 120000,
                            stableWaitMs: 1300,
                            markerRetryCount: 5,
                            markerRetryIntervalMs: 400,
                            submitAttemptCount: 12,
                            submitAttemptIntervalMs: 250,
                            nudgeCount: 3,
                            nudgeIntervalMs: 7000
                        },
                        ...(userSettings || {})
                    };
                    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const START_FLAG = startFlag;
                    const END_FLAG = endFlag;
                    const START_LINE_GLOBAL_RE = new RegExp(`(^|\\n)\\s*${esc(START_FLAG)}\\s*(\\n|$)`, 'g');
                    const END_LINE_GLOBAL_RE = new RegExp(`(^|\\n)\\s*${esc(END_FLAG)}\\s*(\\n|$)`, 'g');
                    const START_LINE_RE = new RegExp(`(^|\\n)\\s*${esc(START_FLAG)}\\s*(\\n|$)`, 'm');
                    const END_LINE_RE = new RegExp(`(^|\\n)\\s*${esc(END_FLAG)}\\s*(\\n|$)`, 'm');

                    function findInput() {
                        return (
                            document.querySelector('textarea') ||
                            document.querySelector('div[contenteditable="true"][aria-label*="prompt" i]') ||
                            document.querySelector('div[contenteditable="true"][role="textbox"]')
                        );
                    }

                    function setPrompt(input, text) {
                        if (!input) return false;

                        if (input.tagName.toLowerCase() === 'textarea') {
                            const proto = Object.getPrototypeOf(input);
                            const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
                            if (descriptor && descriptor.set) {
                                descriptor.set.call(input, text);
                            } else {
                                input.value = text;
                            }
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            return true;
                        }

                        input.focus();
                        document.execCommand('selectAll', false);
                        document.execCommand('insertText', false, text);
                        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
                        return true;
                    }

                    function submitPrompt(input) {
                        const findSendButton = () => {
                            const buttons = Array.from(document.querySelectorAll('button'));
                            return (
                                buttons.find((btn) => {
                                    const label = `${btn.getAttribute('aria-label') || ''} ${btn.innerText || ''}`.toLowerCase();
                                    if (btn.disabled) return false;
                                    return label.includes('send') || label.includes('submit');
                                }) ||
                                document.querySelector('button[data-test-id*="send" i]:not([disabled])')
                            );
                        };

                        const sendBtn = findSendButton();
                        if (sendBtn) {
                            sendBtn.click();
                            return true;
                        }

                        if (!input) return false;
                        input.focus();
                        const keyOpts = {
                            bubbles: true,
                            cancelable: true,
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13
                        };
                        input.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
                        input.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
                        input.dispatchEvent(new KeyboardEvent('keyup', keyOpts));

                        const form = input.closest('form');
                        if (form) {
                            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                        }
                        return true;
                    }

                    function sanitizeImageUrls(list) {
                        if (!Array.isArray(list)) return [];
                        const seen = new Set();
                        const out = [];
                        for (const raw of list) {
                            const url = String(raw || '').trim();
                            if (!url || seen.has(url)) continue;
                            seen.add(url);
                            out.push(url);
                            if (out.length >= 4) break;
                        }
                        return out;
                    }

                    function pickFileInput() {
                        const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
                        return inputs.find((el) => !el.disabled) || null;
                    }

                    function extFromType(type) {
                        const t = String(type || '').toLowerCase();
                        if (t.includes('png')) return 'png';
                        if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
                        if (t.includes('webp')) return 'webp';
                        if (t.includes('gif')) return 'gif';
                        if (t.includes('bmp')) return 'bmp';
                        return 'png';
                    }

                    async function attachImagesToGemini(imageUrls) {
                        const urls = sanitizeImageUrls(imageUrls);
                        if (!urls.length) return;

                        const waitStart = Date.now();
                        let fileInput = pickFileInput();
                        while (!fileInput && Date.now() - waitStart < 6000) {
                            await sleep(250);
                            fileInput = pickFileInput();
                        }
                        if (!fileInput) return;

                        const dt = new DataTransfer();
                        let attachedCount = 0;
                        for (let i = 0; i < urls.length; i += 1) {
                            const url = urls[i];
                            try {
                                const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
                                if (!response.ok) continue;
                                const blob = await response.blob();
                                if (!blob || !String(blob.type || '').startsWith('image/')) continue;
                                const ext = extFromType(blob.type);
                                const file = new File([blob], `science-image-${i + 1}.${ext}`, {
                                    type: blob.type || `image/${ext}`,
                                    lastModified: Date.now()
                                });
                                dt.items.add(file);
                                attachedCount += 1;
                            } catch {}
                        }

                        if (!attachedCount) return;

                        try {
                            fileInput.files = dt.files;
                        } catch {
                            return;
                        }
                        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
                        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                        await sleep(Math.min(6000, 1200 + attachedCount * 700));
                    }

                    function codeSnapshots() {
                        const nodes = Array.from(document.querySelectorAll('pre, code'));
                        return new Set(
                            nodes
                                .map((n) => (n.innerText || '').trim())
                                .filter((t) => t.length > 6)
                        );
                    }

                    function looksLikeJsonPayload(text) {
                        if (!text) return false;
                        if (START_LINE_RE.test(text) || END_LINE_RE.test(text)) return true;
                        if (text.includes('```json') || text.includes('```')) return true;
                        return text.trim().startsWith('{') || text.trim().startsWith('[');
                    }

                    function extractFlaggedTextFromBody() {
                        const fullText = (document.body?.innerText || '').trim();
                        if (!fullText) return '';
                        const endMatches = [...fullText.matchAll(END_LINE_GLOBAL_RE)];
                        const startMatches = [...fullText.matchAll(START_LINE_GLOBAL_RE)];
                        if (!endMatches.length || !startMatches.length) return '';

                        const end = endMatches[endMatches.length - 1].index;
                        let start = -1;
                        for (let i = startMatches.length - 1; i >= 0; i -= 1) {
                            const idx = startMatches[i].index;
                            if (idx < end) {
                                start = idx;
                                break;
                            }
                        }
                        if (start === -1) return '';
                        return fullText.slice(start, end + END_FLAG.length).trim();
                    }

                    function getLatestCandidate(beforeSet) {
                        const blocks = Array.from(document.querySelectorAll('pre, code'));
                        let newestCandidate = '';

                        for (let i = blocks.length - 1; i >= 0; i -= 1) {
                            const text = (blocks[i].innerText || '').trim();
                            if (!text || !looksLikeJsonPayload(text)) continue;
                            if (!beforeSet.has(text)) {
                                if (!newestCandidate || text.length >= newestCandidate.length) {
                                    newestCandidate = text;
                                }
                            }
                        }

                        if (!newestCandidate) {
                            const flagged = extractFlaggedTextFromBody();
                            if (flagged) newestCandidate = flagged;
                        }

                        return newestCandidate;
                    }

                    function hasFlags(text) {
                        return START_LINE_RE.test(text) && END_LINE_RE.test(text);
                    }

                    const start = Date.now();
                    let input = null;
                    while (!input && Date.now() - start < 20000) {
                        input = findInput();
                        if (!input) await sleep(300);
                    }

                    if (!input) {
                        throw new Error('Gemini input box not found');
                    }

                    await attachImagesToGemini(userImages);

                    const before = codeSnapshots();
                    if (!setPrompt(input, userPrompt)) {
                        throw new Error('Failed to set Gemini prompt');
                    }

                    let sent = false;
                    for (let i = 0; i < Math.max(1, Number(localSettings.submitAttemptCount || 12)); i += 1) {
                        await sleep(Math.max(50, Number(localSettings.submitAttemptIntervalMs || 250)));
                        sent = submitPrompt(input);
                        if (sent) break;
                    }
                    if (!sent) {
                        throw new Error('Failed to submit Gemini prompt');
                    }

                    return await new Promise((resolvePrompt, rejectPrompt) => {
                        const timeout = setTimeout(() => {
                            if (stableTimer) clearTimeout(stableTimer);
                            if (retryTimer) clearInterval(retryTimer);
                            if (nudgeTimer) clearInterval(nudgeTimer);
                            if (pollTimer) clearInterval(pollTimer);
                            observer.disconnect();
                            rejectPrompt(new Error('Timed out waiting for Gemini code response'));
                        }, Math.max(10000, Number(localSettings.geminiResponseTimeoutMs || 120000)));

                        let stableTimer = null;
                        let retryTimer = null;
                        let nudgeTimer = null;
                        let pollTimer = null;
                        let lastCandidate = '';
                        let nudges = 0;

                        // Gemini occasionally keeps text in the composer unsent; nudge submit again.
                        nudgeTimer = setInterval(() => {
                            if (lastCandidate) return;
                            nudges += 1;
                            submitPrompt(input);
                            if (nudges >= Math.max(0, Number(localSettings.nudgeCount || 3))) {
                                clearInterval(nudgeTimer);
                                nudgeTimer = null;
                            }
                        }, Math.max(1000, Number(localSettings.nudgeIntervalMs || 7000)));

                        const tryExtract = () => {
                            const newestCandidate = getLatestCandidate(before);
                            if (!newestCandidate) return false;

                            if (newestCandidate !== lastCandidate) {
                                lastCandidate = newestCandidate;
                                if (stableTimer) clearTimeout(stableTimer);
                                if (retryTimer) {
                                    clearInterval(retryTimer);
                                    retryTimer = null;
                                }
                                // Wait for streaming to settle before resolving.
                                stableTimer = setTimeout(() => {
                                    if (hasFlags(lastCandidate)) {
                                        clearTimeout(timeout);
                                        if (retryTimer) clearInterval(retryTimer);
                                        if (nudgeTimer) clearInterval(nudgeTimer);
                                        if (pollTimer) clearInterval(pollTimer);
                                        observer.disconnect();
                                        resolvePrompt(lastCandidate);
                                        return;
                                    }

                                    // Incomplete capture fallback: retry 5 times across ~2 seconds.
                                    let attempts = 0;
                                    const retryEveryMs = Math.max(100, Number(localSettings.markerRetryIntervalMs || 400));
                                    const retryMax = Math.max(1, Number(localSettings.markerRetryCount || 5));
                                    retryTimer = setInterval(() => {
                                        attempts += 1;
                                        const current = getLatestCandidate(before) || lastCandidate;
                                        if (current.length >= lastCandidate.length) {
                                            lastCandidate = current;
                                        }

                                        if (hasFlags(lastCandidate)) {
                                            clearInterval(retryTimer);
                                            retryTimer = null;
                                            clearTimeout(timeout);
                                            if (nudgeTimer) clearInterval(nudgeTimer);
                                            if (pollTimer) clearInterval(pollTimer);
                                            observer.disconnect();
                                            resolvePrompt(lastCandidate);
                                            return;
                                        }

                                        if (attempts >= retryMax) {
                                            clearInterval(retryTimer);
                                            retryTimer = null;
                                            clearTimeout(timeout);
                                            if (nudgeTimer) clearInterval(nudgeTimer);
                                            if (pollTimer) clearInterval(pollTimer);
                                            observer.disconnect();
                                            rejectPrompt(new Error('INCOMPLETE_GEMINI_RESPONSE'));
                                        }
                                    }, retryEveryMs);
                                }, Math.max(100, Number(localSettings.stableWaitMs || 1300)));
                            }

                            return true;
                        };

                        tryExtract();

                        const observer = new MutationObserver(() => {
                            tryExtract();
                        });

                        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
                        // Also poll frequently because some Gemini UI updates are virtualized and do not always emit useful mutations.
                        pollTimer = setInterval(() => {
                            tryExtract();
                        }, 250);
                    });
                },
                args: [prompt, settings, startMarker, endMarker, normalizedImages]
            },
            (results) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                const first = results?.[0];
                const text = first?.result;
                if (!text) {
                    fallbackReadMarkerBlock();
                    return;
                }
                resolve(text);
            }
        );
    });
}

function extractJsonCandidate(text, requestId) {
    const startToken = requestId ? `${SAI_START_FLAG}:${requestId}` : SAI_START_FLAG;
    const endToken = requestId ? `${SAI_END_FLAG}:${requestId}` : SAI_END_FLAG;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startLineRe = new RegExp(`(^|\\n)\\s*${esc(startToken)}\\s*(\\n|$)`, 'g');
    const endLineRe = new RegExp(`(^|\\n)\\s*${esc(endToken)}\\s*(\\n|$)`, 'g');
    const endMatches = [...text.matchAll(endLineRe)];
    const startMatches = [...text.matchAll(startLineRe)];
    if (endMatches.length && startMatches.length) {
        const endIdx = endMatches[endMatches.length - 1].index;
        let startIdx = -1;
        for (let i = startMatches.length - 1; i >= 0; i -= 1) {
            const idx = startMatches[i].index;
            if (idx < endIdx) {
                startIdx = idx;
                break;
            }
        }

        if (startIdx !== -1) {
            const startContentIdx = text.indexOf(startToken, startIdx) + startToken.length;
            text = text.slice(startContentIdx, endIdx).trim();
        }
    }

    // Gemini sometimes prefixes fenced blocks with a plain "JSON" line.
    text = text.replace(/^\s*json\s*\n/i, '').trim();

    const fencedJson = text.match(/```json\s*([\s\S]*?)\s*```/i);
    if (fencedJson?.[1]) return fencedJson[1].trim();

    const fenced = text.match(/```\s*([\s\S]*?)\s*```/);
    if (fenced?.[1]) return fenced[1].trim();

    return text.trim();
}

function parseGeminiJson(text, requestId) {
    const candidate = extractJsonCandidate(text, requestId);
    const normalized = candidate
        .replace(/^\uFEFF/, '')
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");

    const attempts = [normalized];
    // Common Gemini issue: trailing commas in objects/arrays.
    attempts.push(normalized.replace(/,\s*([}\]])/g, '$1'));

    try {
        for (const attempt of attempts) {
            return JSON.parse(attempt);
        }
    } catch {}

    for (const attempt of attempts) {
        const firstBrace = attempt.indexOf('{');
        const lastBrace = attempt.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            try {
                return JSON.parse(attempt.slice(firstBrace, lastBrace + 1));
            } catch {}
        }

        const firstBracket = attempt.indexOf('[');
        const lastBracket = attempt.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket > firstBracket) {
            try {
                return JSON.parse(attempt.slice(firstBracket, lastBracket + 1));
            } catch {}
        }
    }

    throw new Error('Gemini response did not contain parseable JSON');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'SCIENCE_RELOAD_GEMINI') {
        (async () => {
            try {
                const tab = await getOrCreateGeminiTab();
                await new Promise((resolve, reject) => {
                    chrome.tabs.reload(tab.id, {}, () => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }
                        resolve();
                    });
                });
                sendResponse({ ok: true, reloadedTabId: tab.id });
            } catch (err) {
                sendResponse({ ok: false, error: err?.message || String(err) });
            }
        })();
        return true;
    }

    if (message?.type !== 'SCIENCE_PROCESS') return;

    (async () => {
        try {
            if (!message.prompt || typeof message.prompt !== 'string') {
                throw new Error('Missing science prompt');
            }

            const tab = await getOrCreateGeminiTab();
            const mergedSettings = { ...DEFAULT_SCIENCE_SETTINGS, ...(message.settings || {}) };
            const images = normalizeScienceImages(message.images);
            const raw = await executeGeminiPrompt(tab.id, message.prompt, mergedSettings, message.requestId, images);
            let data = null;
            let parseError = null;
            try {
                data = parseGeminiJson(raw, message.requestId);
            } catch (err) {
                parseError = err?.message || String(err);
                data = { rawResponse: raw };
            }

            if (sender?.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, {
                    type: 'SCIENCE_RESPONSE',
                    data,
                    raw,
                    parseError,
                    sourceUrl: message.sourceUrl || sender.tab.url || ''
                });
            }

            sendResponse({ ok: true, data, raw, parseError, geminiTabId: tab.id });
        } catch (err) {
            sendResponse({ ok: false, error: err?.message || String(err) });
        }
    })();

    return true;
});

checkForUpdate();
setInterval(checkForUpdate, CHECK_INTERVAL);
