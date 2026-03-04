// Sparx Science AI module
// One-click flow: extract science question -> ask Gemini for JSON in a code block -> return parsed data.

(function initScienceModule() {
    if (!window.location.hostname.endsWith("science.sparx-learning.com")) return;

    const BTN_ID = "sai-science-btn";
    const STATUS_ID = "sai-science-status";
    const PANEL_ID = "sai-science-panel";
    const FAIL_MODAL_ID = "sai-science-fail-modal";
    const SETTINGS_MODAL_ID = "sai-science-settings-modal";
    const MENU_ITEM_ID = "sai-science-menu-item";
    const STYLES_ID = "sai-science-styles";
    const SCIENCE_SETTINGS_KEY = "sai_science_settings";
    const DEFAULT_SETTINGS = {
        requestTimeoutMs: 25000,
        requestRetries: 2,
        geminiResponseTimeoutMs: 120000,
        stableWaitMs: 1300,
        markerRetryCount: 5,
        markerRetryIntervalMs: 400,
        submitAttemptCount: 12,
        submitAttemptIntervalMs: 250,
        nudgeCount: 3,
        nudgeIntervalMs: 7000
    };
    let activeRunId = 0;
    const SETTINGS_META = [
        { key: "requestTimeoutMs", label: "Request timeout (ms)", help: "Maximum total time for one request from this page before it fails." },
        { key: "requestRetries", label: "Request retries", help: "How many times to retry if a request fails or times out." },
        { key: "geminiResponseTimeoutMs", label: "Gemini response timeout (ms)", help: "Maximum wait for Gemini output after prompt submission." },
        { key: "stableWaitMs", label: "Stable wait before capture (ms)", help: "How long output must stay unchanged before capture." },
        { key: "markerRetryCount", label: "Marker retry count", help: "Extra checks for SAI_JSON_START/SAI_JSON_END before giving up." },
        { key: "markerRetryIntervalMs", label: "Marker retry interval (ms)", help: "Delay between each marker retry check." },
        { key: "submitAttemptCount", label: "Submit attempt count", help: "How many submit attempts are made after filling the prompt." },
        { key: "submitAttemptIntervalMs", label: "Submit attempt interval (ms)", help: "Delay between submit attempts." },
        { key: "nudgeCount", label: "Auto re-submit nudges", help: "How many extra submit nudges are sent while waiting for output." },
        { key: "nudgeIntervalMs", label: "Nudge interval (ms)", help: "Delay between auto re-submit nudges." }
    ];

    function isMessagingContextError(message) {
        const text = String(message || "").toLowerCase();
        return (
            text.includes("extension context invalidated") ||
            text.includes("message channel closed before a response was received")
        );
    }

    function isRetryableGeminiError(message) {
        const text = String(message || "").toLowerCase();
        return (
            text.includes("timed out") ||
            text.includes("incomplete_gemini_response") ||
            text.includes("no code block text") ||
            text.includes("marker block not found")
        );
    }

    function sendRuntimeMessage(message) {
        return new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    resolve(response);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    function withTimeout(promise, timeoutMs, message) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(message || "Operation timed out"));
            }, timeoutMs);
            promise
                .then((value) => {
                    clearTimeout(timer);
                    resolve(value);
                })
                .catch((err) => {
                    clearTimeout(timer);
                    reject(err);
                });
        });
    }

    function getScienceSettings() {
        return new Promise((resolve) => {
            try {
                chrome.storage.local.get([SCIENCE_SETTINGS_KEY], (items) => {
                    const saved = items?.[SCIENCE_SETTINGS_KEY];
                    resolve({ ...DEFAULT_SETTINGS, ...(saved || {}) });
                });
            } catch {
                resolve({ ...DEFAULT_SETTINGS });
            }
        });
    }

    function saveScienceSettings(nextSettings) {
        return new Promise((resolve) => {
            try {
                chrome.storage.local.set({ [SCIENCE_SETTINGS_KEY]: nextSettings }, () => resolve(true));
            } catch {
                resolve(false);
            }
        });
    }

    function ensureUi() {
        if (document.getElementById(BTN_ID)) return;
        ensureGlobalStyles();

        const btn = document.createElement("button");
        btn.id = BTN_ID;
        btn.textContent = "Solve Science";
        Object.assign(btn.style, {
            position: "fixed",
            right: "16px",
            bottom: "16px",
            zIndex: "2147483647",
            border: "none",
            borderRadius: "8px",
            padding: "10px 14px",
            background: "#0b5e52",
            color: "#fff",
            cursor: "pointer",
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
            fontSize: "14px",
            boxShadow: "0 6px 16px rgba(0,0,0,.22)"
        });

        const status = document.createElement("div");
        status.id = STATUS_ID;
        Object.assign(status.style, {
            position: "fixed",
            right: "16px",
            bottom: "62px",
            zIndex: "2147483647",
            maxWidth: "340px",
            background: "#111",
            color: "#fff",
            borderRadius: "8px",
            padding: "8px 10px",
            fontSize: "12px",
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
            opacity: "0",
            transform: "translateY(6px)",
            transition: "all .2s ease",
            pointerEvents: "none"
        });

        btn.addEventListener("click", () => void runScienceFlow(btn, status));

        document.body.appendChild(btn);
        document.body.appendChild(status);
        ensureResultPanel();
        ensureFailureModal();
        ensureSettingsModal();
    }

    function ensureGlobalStyles() {
        if (document.getElementById(STYLES_ID)) return;
        const style = document.createElement("style");
        style.id = STYLES_ID;
        style.textContent = `
#${SETTINGS_MODAL_ID} .sai-scroll {
  scrollbar-width: thin;
  scrollbar-color: #0b5e52 #111827;
}
#${SETTINGS_MODAL_ID} .sai-scroll::-webkit-scrollbar {
  width: 10px;
}
#${SETTINGS_MODAL_ID} .sai-scroll::-webkit-scrollbar-track {
  background: #111827;
}
#${SETTINGS_MODAL_ID} .sai-scroll::-webkit-scrollbar-thumb {
  background: #0b5e52;
  border-radius: 8px;
  border: 2px solid #111827;
}
`;
        document.head.appendChild(style);
    }

    function ensureResultPanel() {
        if (document.getElementById(PANEL_ID)) return;

        const panel = document.createElement("div");
        panel.id = PANEL_ID;
        Object.assign(panel.style, {
            position: "fixed",
            right: "16px",
            bottom: "110px",
            width: "min(520px, calc(100vw - 32px))",
            maxHeight: "55vh",
            zIndex: "2147483647",
            background: "#0f172a",
            color: "#e2e8f0",
            border: "1px solid #1f2937",
            borderRadius: "10px",
            boxShadow: "0 12px 28px rgba(0,0,0,.35)",
            overflow: "hidden",
            display: "none",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        });

        const header = document.createElement("div");
        Object.assign(header.style, {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 10px",
            background: "#111827",
            borderBottom: "1px solid #1f2937"
        });

        const title = document.createElement("strong");
        title.textContent = "Answer Response";
        title.style.fontSize = "12px";

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "6px";

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.textContent = "Copy";
        copyBtn.dataset.role = "copy";

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.textContent = "Close";
        closeBtn.dataset.role = "close";

        [copyBtn, closeBtn].forEach((btnEl) => {
            Object.assign(btnEl.style, {
                border: "1px solid #374151",
                background: "#1f2937",
                color: "#e5e7eb",
                borderRadius: "6px",
                fontSize: "12px",
                padding: "4px 8px",
                cursor: "pointer"
            });
        });

        const body = document.createElement("pre");
        body.dataset.role = "content";
        Object.assign(body.style, {
            margin: "0",
            padding: "10px",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflow: "auto",
            maxHeight: "calc(55vh - 42px)",
            fontSize: "12px",
            lineHeight: "1.45"
        });

        actions.appendChild(copyBtn);
        actions.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(actions);
        panel.appendChild(header);
        panel.appendChild(body);
        document.body.appendChild(panel);

        closeBtn.addEventListener("click", () => {
            panel.style.display = "none";
        });

        copyBtn.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(body.textContent || "");
            } catch (err) {
                console.error("Copy failed:", err);
            }
        });
    }

    function showResultPanel(response) {
        ensureResultPanel();
        const panel = document.getElementById(PANEL_ID);
        const content = panel?.querySelector('[data-role="content"]');
        if (!panel || !content) return;

        const lines = [];
        if (response.parseError) {
            lines.push(`Parse warning: ${response.parseError}`);
            lines.push("");
        }

        if (response.data && typeof response.data === "object" && Array.isArray(response.data.answers)) {
            const answers = response.data.answers;
            const toAlphaLabel = (n) => String.fromCharCode(97 + Math.max(0, n));
            const partToLabel = (part, idx, total) => {
                const p = String(part || "").trim().toLowerCase();
                if (!p || p === "main") return total > 1 ? `${toAlphaLabel(idx)})` : "Answer:";
                const partNum = p.match(/^part\s*(\d+)$/);
                if (partNum) return `${toAlphaLabel(Number(partNum[1]) - 1)})`;
                const singleLetter = p.match(/^([a-z])\)?$/);
                if (singleLetter) return `${singleLetter[1]})`;
                return `${part}:`;
            };

            lines.push("Answers");
            lines.push("");
            answers.forEach((item, idx) => {
                const label = partToLabel(item?.part, idx, answers.length);
                const answer = String(item?.answer || "").trim() || "(blank)";
                lines.push(`${label} ${answer}`);
            });

            if (Array.isArray(response.data.checks) && response.data.checks.length) {
                lines.push("");
                lines.push("Checks");
                lines.push("");
                response.data.checks.forEach((check) => {
                    lines.push(`- ${String(check)}`);
                });
            }
        } else if (response.raw) {
            lines.push(String(response.raw));
        } else {
            lines.push("No response data.");
        }

        content.textContent = lines.join("\n");
        panel.style.display = "block";
    }

    function hideResultPanel() {
        const panel = document.getElementById(PANEL_ID);
        const content = panel?.querySelector('[data-role="content"]');
        if (content) content.textContent = "";
        if (panel) panel.style.display = "none";
    }

    function ensureSettingsModal() {
        if (document.getElementById(SETTINGS_MODAL_ID)) return;

        const modal = document.createElement("div");
        modal.id = SETTINGS_MODAL_ID;
        Object.assign(modal.style, {
            position: "fixed",
            inset: "0",
            zIndex: "2147483647",
            display: "none",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,.45)",
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
        });

        const card = document.createElement("div");
        Object.assign(card.style, {
            width: "min(520px, calc(100vw - 32px))",
            maxHeight: "75vh",
            overflow: "auto",
            background: "#111827",
            color: "#e5e7eb",
            border: "1px solid #374151",
            borderRadius: "12px",
            padding: "16px",
            boxShadow: "0 16px 40px rgba(0,0,0,.4)"
        });
        card.classList.add("sai-scroll");

        const title = document.createElement("h3");
        title.textContent = "Sparx AI Settings";
        Object.assign(title.style, { margin: "0 0 10px 0", fontSize: "18px" });

        const form = document.createElement("div");
        form.dataset.role = "settings-form";
        Object.assign(form.style, {
            display: "grid",
            gap: "10px",
            marginBottom: "14px"
        });

        SETTINGS_META.forEach(({ key, label, help }) => {
            const wrap = document.createElement("label");
            Object.assign(wrap.style, { display: "grid", gap: "4px", fontSize: "13px" });
            const labelRow = document.createElement("div");
            Object.assign(labelRow.style, { display: "flex", alignItems: "center", gap: "6px" });
            const labelText = document.createElement("span");
            labelText.textContent = label;
            const tip = document.createElement("span");
            tip.textContent = "(?)";
            tip.title = help;
            Object.assign(tip.style, {
                fontSize: "12px",
                opacity: "0.85",
                cursor: "help",
                border: "1px solid #4b5563",
                borderRadius: "10px",
                padding: "0 5px",
                lineHeight: "16px"
            });
            labelRow.appendChild(labelText);
            labelRow.appendChild(tip);

            const input = document.createElement("input");
            input.type = "number";
            input.min = "0";
            input.step = "1";
            input.dataset.key = key;
            Object.assign(input.style, {
                border: "1px solid #4b5563",
                background: "#1f2937",
                color: "#e5e7eb",
                borderRadius: "8px",
                padding: "7px 9px",
                fontSize: "13px"
            });
            wrap.appendChild(labelRow);
            wrap.appendChild(input);
            form.appendChild(wrap);
        });

        const actions = document.createElement("div");
        Object.assign(actions.style, { display: "flex", gap: "8px", justifyContent: "flex-end" });

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.textContent = "Close";
        Object.assign(closeBtn.style, {
            border: "1px solid #4b5563",
            background: "#1f2937",
            color: "#e5e7eb",
            borderRadius: "8px",
            padding: "7px 10px",
            cursor: "pointer"
        });

        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.textContent = "Save";
        Object.assign(saveBtn.style, {
            border: "1px solid #0b5e52",
            background: "#0b5e52",
            color: "#fff",
            borderRadius: "8px",
            padding: "7px 10px",
            cursor: "pointer"
        });

        closeBtn.addEventListener("click", () => {
            modal.style.display = "none";
        });
        modal.addEventListener("click", (ev) => {
            if (ev.target === modal) modal.style.display = "none";
        });

        saveBtn.addEventListener("click", async () => {
            const inputs = Array.from(form.querySelectorAll("input[data-key]"));
            const next = { ...DEFAULT_SETTINGS };
            inputs.forEach((inp) => {
                const key = inp.dataset.key;
                const val = Number(inp.value);
                if (!key || Number.isNaN(val)) return;
                next[key] = Math.max(0, Math.floor(val));
            });
            await saveScienceSettings(next);
            modal.style.display = "none";
        });

        actions.appendChild(closeBtn);
        actions.appendChild(saveBtn);
        card.appendChild(title);
        card.appendChild(form);
        card.appendChild(actions);
        modal.appendChild(card);
        document.body.appendChild(modal);
    }

    async function openSettingsModal() {
        ensureSettingsModal();
        const modal = document.getElementById(SETTINGS_MODAL_ID);
        const form = modal?.querySelector('[data-role="settings-form"]');
        if (!modal || !form) return;
        const settings = await getScienceSettings();
        const inputs = Array.from(form.querySelectorAll("input[data-key]"));
        inputs.forEach((inp) => {
            const key = inp.dataset.key;
            if (!key) return;
            inp.value = String(settings[key] ?? DEFAULT_SETTINGS[key] ?? 0);
        });
        modal.style.display = "flex";
    }

    function ensureGlobalMenuItem() {
        const openMenus = Array.from(document.querySelectorAll('[role="menu"]'));
        for (const menu of openMenus) {
            if (menu.querySelector(`#${MENU_ITEM_ID}`)) continue;

            const candidates = Array.from(menu.querySelectorAll("button,a,[role='menuitem']"));
            const cookieNode = candidates.find((el) => /cookie settings/i.test((el.textContent || "").trim()));

            const item = document.createElement("button");
            item.type = "button";
            item.id = MENU_ITEM_ID;
            item.setAttribute("role", "menuitem");
            item.className = cookieNode?.className || candidates[0]?.className || "";
            Object.assign(item.style, {
                width: "100%",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 12px",
                cursor: "pointer"
            });
            const logo = document.createElement("img");
            logo.src = chrome.runtime.getURL("cdn/img/logo.png");
            logo.alt = "";
            logo.width = 16;
            logo.height = 16;
            logo.style.borderRadius = "3px";
            const text = document.createElement("span");
            text.textContent = "Sparx-AI-Tools";
            item.appendChild(logo);
            item.appendChild(text);

            item.addEventListener("click", (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                openSettingsModal();
            });

            if (cookieNode?.parentElement === menu) {
                menu.insertBefore(item, cookieNode);
            } else if (cookieNode?.parentElement) {
                cookieNode.parentElement.insertBefore(item, cookieNode);
            } else {
                menu.insertBefore(item, menu.firstChild);
            }
        }
    }

    function ensureFailureModal() {
        if (document.getElementById(FAIL_MODAL_ID)) return;

        const modal = document.createElement("div");
        modal.id = FAIL_MODAL_ID;
        Object.assign(modal.style, {
            position: "fixed",
            inset: "0",
            zIndex: "2147483647",
            display: "none",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,.45)",
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
        });

        const card = document.createElement("div");
        Object.assign(card.style, {
            width: "min(420px, calc(100vw - 32px))",
            background: "#111827",
            color: "#e5e7eb",
            border: "1px solid #374151",
            borderRadius: "12px",
            padding: "16px",
            boxShadow: "0 16px 40px rgba(0,0,0,.4)"
        });

        const title = document.createElement("h3");
        title.textContent = "Request failed";
        Object.assign(title.style, { margin: "0 0 8px 0", fontSize: "18px" });

        const msg = document.createElement("p");
        msg.dataset.role = "message";
        msg.textContent = "Could not complete the Gemini request.";
        Object.assign(msg.style, { margin: "0 0 14px 0", fontSize: "14px", opacity: "0.95" });

        const actions = document.createElement("div");
        Object.assign(actions.style, { display: "flex", gap: "8px", justifyContent: "flex-end" });

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.textContent = "Close";
        Object.assign(cancelBtn.style, {
            border: "1px solid #4b5563",
            background: "#1f2937",
            color: "#e5e7eb",
            borderRadius: "8px",
            padding: "7px 10px",
            cursor: "pointer"
        });

        const retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.textContent = "Try again";
        Object.assign(retryBtn.style, {
            border: "1px solid #0b5e52",
            background: "#0b5e52",
            color: "#fff",
            borderRadius: "8px",
            padding: "7px 10px",
            cursor: "pointer"
        });

        cancelBtn.addEventListener("click", () => {
            modal.style.display = "none";
        });

        retryBtn.addEventListener("click", () => {
            sendRuntimeMessage({ type: "SCIENCE_RELOAD_GEMINI" })
                .catch((err) => {
                    if (!isMessagingContextError(err?.message)) {
                        console.error("Gemini reload failed:", err);
                    }
                })
                .finally(() => {
                    modal.style.display = "none";
                });
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(retryBtn);
        card.appendChild(title);
        card.appendChild(msg);
        card.appendChild(actions);
        modal.appendChild(card);
        document.body.appendChild(modal);
    }

    function showFailureModal(message) {
        ensureFailureModal();
        const modal = document.getElementById(FAIL_MODAL_ID);
        const msg = modal?.querySelector('[data-role="message"]');
        if (!modal || !msg) return;
        msg.textContent = message || "Could not complete the Gemini request.";
        modal.style.display = "flex";
    }

    function hideFailureModal() {
        const modal = document.getElementById(FAIL_MODAL_ID);
        if (!modal) return;
        modal.style.display = "none";
    }

    function showStatus(el, text, isError) {
        el.textContent = text;
        el.style.background = isError ? "#7a1717" : "#111";
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
        window.clearTimeout(showStatus._timer);
        showStatus._timer = window.setTimeout(() => {
            el.style.opacity = "0";
            el.style.transform = "translateY(6px)";
        }, 2800);
    }

    function extractTextFromTable(table) {
        const rows = Array.from(table.querySelectorAll("tr"));
        if (!rows.length) return table.innerText.trim();

        return rows
            .map((row) =>
                Array.from(row.querySelectorAll("th,td"))
                    .map((cell) => cell.innerText.replace(/\s+/g, " ").trim())
                    .filter(Boolean)
                    .join(" | ")
            )
            .filter(Boolean)
            .join("\n");
    }

    function extractQuestionText() {
        const partNodes = Array.from(document.querySelectorAll("[data-part-name]"));
        if (!partNodes.length) return null;

        const orderedParts = partNodes.sort((a, b) => {
            const pa = a.getAttribute("data-part-name") || "";
            const pb = b.getAttribute("data-part-name") || "";
            if (pa === "" && pb !== "") return -1;
            if (pb === "" && pa !== "") return 1;
            return pa.localeCompare(pb);
        });

        const chunks = [];
        for (const part of orderedParts) {
            const partName = part.getAttribute("data-part-name") || "";
            const body = [];

            const elements = part.querySelectorAll("p, table");
            elements.forEach((el) => {
                if (el.tagName.toLowerCase() === "table") {
                    const t = extractTextFromTable(el);
                    if (t) body.push(t);
                } else {
                    const t = el.innerText.replace(/\s+\n/g, "\n").trim();
                    if (t) body.push(t);
                }
            });

            if (!body.length) continue;
            const heading = partName ? `Part ${partName}` : "Main question";
            chunks.push(`${heading}:\n${body.join("\n")}`);
        }

        return chunks.length ? chunks.join("\n\n") : null;
    }

    function extractQuestionImages() {
        const urls = [];
        const seen = new Set();
        const imgs = Array.from(document.querySelectorAll("img"));
        for (const img of imgs) {
            const src = (img.currentSrc || img.src || "").trim();
            if (!src || src.startsWith("data:image/svg+xml")) continue;
            if (img.closest("button,[role='button'],a")) continue;

            // Keep images that are in question-related containers.
            const inQuestion = Boolean(
                img.closest("[data-part-name]") ||
                img.closest('[class*="_Question_"]') ||
                img.closest('[class*="_RightImage_"]') ||
                img.closest('[class*="_ImageContainer_"]')
            );
            if (!inQuestion) continue;

            const renderedWidth = Number(img.clientWidth || img.naturalWidth || 0);
            const renderedHeight = Number(img.clientHeight || img.naturalHeight || 0);
            if (renderedWidth < 80 && renderedHeight < 80) continue;

            let absolute = "";
            try {
                absolute = new URL(src, location.href).toString();
            } catch {
                absolute = src;
            }
            if (!absolute || seen.has(absolute)) continue;

            seen.add(absolute);
            urls.push(absolute);
        }

        return urls.slice(0, 4);
    }

    function buildPrompt(questionText, requestId, imageUrls) {
        const startMarker = `SAI_JSON_START:${requestId}`;
        const endMarker = `SAI_JSON_END:${requestId}`;
        const imageGuidance = Array.isArray(imageUrls) && imageUrls.length
            ? [
                "The question includes image(s). The images are attached separately.",
                "Use the attached image(s) if needed for measurements/labels/data.",
                "Image URL backup list:",
                ...imageUrls.map((url) => `- ${url}`)
            ]
            : [];
        return [
            "You are solving a Sparx Science question.",
            "Return ONLY one markdown code block containing valid JSON.",
            "No prose before or after the code block.",
            `Output wrapper is mandatory: first line exactly "${startMarker}", last line exactly "${endMarker}".`,
            "Put the code block between these markers.",
            "Use this JSON schema exactly:",
            '{"answers":[{"part":"main|a)|b)|...","answer":"exact answer text"}],"checks":["optional short checks"]}',
            "Rules:",
            "- Answers must match the question requirements exactly.",
            "- Include every visible part.",
            "- Use plain strings only.",
            "- If the input references an image and you cannot do the calculation without it, do not try, refuse to answer the question.",
            "- If you can do it without the image (eg just the periodic table and not measurements, do it",
            ...imageGuidance,
            "Question:",
            questionText
        ].join("\n");
    }

    async function requestScienceProcess(prompt, questionText, requestId, images) {
        const settings = await getScienceSettings();
        const payload = { type: "SCIENCE_PROCESS", prompt, questionText, sourceUrl: location.href, settings, requestId, images };
        const requestTimeout = Math.max(10000, Number(settings.requestTimeoutMs || DEFAULT_SETTINGS.requestTimeoutMs));
        const requestRetries = Math.max(0, Number(settings.requestRetries ?? DEFAULT_SETTINGS.requestRetries));
        const runAttempt = (attempt) =>
            withTimeout(
                sendRuntimeMessage(payload).then((response) => {
                    if (!response || !response.ok) {
                        throw new Error(response?.error || "Science processing failed");
                    }
                    return response;
                }),
                requestTimeout,
                "Science request timed out"
            ).catch(async (err) => {
                const retryable = isMessagingContextError(err?.message) || isRetryableGeminiError(err?.message);
                if (attempt < requestRetries && retryable) {
                    // If Gemini timed out or produced incomplete output, refresh tab before retry.
                    if (isRetryableGeminiError(err?.message)) {
                        await sendRuntimeMessage({ type: "SCIENCE_RELOAD_GEMINI" }).catch(() => { });
                        await new Promise((r) => setTimeout(r, 1200));
                    }
                    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
                    return runAttempt(attempt + 1);
                }
                throw err;
            });

        return runAttempt(0);
    }

    async function runScienceFlow(btn, statusEl) {
        if (btn.disabled) return;
        const runId = ++activeRunId;
        btn.disabled = true;
        btn.textContent = "Processing...";
        hideFailureModal();
        hideResultPanel();
        const progressTimer = setInterval(() => {
            if (runId !== activeRunId) return;
            showStatus(statusEl, "Still processing... Gemini can take a little while.", false);
        }, 12000);

        try {
            const questionText = extractQuestionText();
            if (!questionText) throw new Error("Could not find science question content.");
            const imageUrls = extractQuestionImages();

            showStatus(statusEl, `Question extracted (${imageUrls.length} image${imageUrls.length === 1 ? "" : "s"}). Sending to Gemini...`, false);
            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const prompt = buildPrompt(questionText, requestId, imageUrls);
            const response = await requestScienceProcess(prompt, questionText, requestId, imageUrls);

            // Forward parsed response for any popup/UI listener.
            sendRuntimeMessage({
                type: "SCIENCE_RESPONSE",
                data: response.data,
                raw: response.raw,
                parseError: response.parseError || null,
                sourceUrl: location.href
            }).catch(() => { });

            console.log("SCIENCE_RESPONSE", response.data);
            showResultPanel(response);
            hideFailureModal();
            if (response.parseError) {
                console.warn("Science parse warning:", response.parseError);
                showStatus(statusEl, "Response received, but JSON parse failed. Raw saved.", true);
            } else {
                showStatus(statusEl, "Science answer received!", false);
            }
        } catch (err) {
            console.error("Science flow error:", err);
            showStatus(statusEl, `Error: ${err.message || String(err)}`, true);
            hideResultPanel();
            if (isMessagingContextError(err?.message)) {
                showFailureModal("Request failed because extension context was refreshed. Click Try again, then run Solve Science again.");
            } else if (isRetryableGeminiError(err?.message)) {
                showFailureModal("Request failed after auto-retry. Gemini was refreshed automatically but did not return a valid response in time.");
            } else {
                showFailureModal("Request failed. Use Try again to refresh Gemini, then run again.");
            }
        } finally {
            clearInterval(progressTimer);
            btn.disabled = false;
            btn.textContent = "Solve Science";
        }
    }

    const observer = new MutationObserver(() => ensureUi());
    ensureUi();
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const menuObserver = new MutationObserver(() => ensureGlobalMenuItem());
    menuObserver.observe(document.documentElement, { childList: true, subtree: true });
})();
