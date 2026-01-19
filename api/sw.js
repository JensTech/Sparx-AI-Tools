const VERSION_CHECK_URL = 'https://cdn.jsdelivr.net/gh/JensTech/Sparx-AI-Tools@main/api/version.json';
const CHECK_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours

// Get the version from manifest
const LOCAL_VERSION = chrome.runtime.getManifest().version;

async function checkForUpdate() {
    try {
        const response = await fetch(VERSION_CHECK_URL, { cache: 'no-store' });
        if (!response.ok) return;

        const data = await response.json();
        const latest = data.latest;

        if (latest !== LOCAL_VERSION) {
            // Check if we already notified
            const storage = await chrome.storage.local.get('notifiedVersion');
            if (storage.notifiedVersion !== latest) {
                // Show notification
                chrome.notifications.create({
                    type: 'basic',
                    title: 'Sparx-AI-Tools',
                    message: `New update installed: version ${latest}`
                });

                // Remember we notified
                await chrome.storage.local.set({ notifiedVersion: latest });
            }
        }
    } catch (err) {
        console.error('Version check failed', err);
    }
}

checkForUpdate();
setInterval(checkForUpdate, CHECK_INTERVAL);