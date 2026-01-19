const VERSION_CHECK_URL = 'https://cdn.jsdelivr.net/gh/JensTech/Sparx-AI-Tools@main/api/version.json';
const CHECK_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours

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
                // Show notification with click listener
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
        }
    } catch (err) {
        console.error('Version check failed', err);
    }
}

checkForUpdate();
setInterval(checkForUpdate, CHECK_INTERVAL);
