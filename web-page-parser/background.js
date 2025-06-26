const LOG_LEVEL = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};
let CURRENT_LOG_LEVEL = LOG_LEVEL.DEBUG;
let cachedToken = null;
let tokenRefreshInProgress = false;
let cachedSettings = null;

function log(level, message, data = null) {
    if (level >= CURRENT_LOG_LEVEL) {
        const timestamp = new Date().toLocaleString('ru-RU');
        const levelName = Object.keys(LOG_LEVEL).find(k => LOG_LEVEL[k] === level);
        console.log(`[${timestamp}] [${levelName}] ${message}`, data || '');
    }
}

async function getSettings() {
    if (!cachedSettings) {
        cachedSettings = await chrome.storage.local.get([
            'spreadsheetId'
        ]);
    }
    return cachedSettings;
}

chrome.runtime.onInstalled.addListener(() => {
    log(LOG_LEVEL.INFO, 'Extension installed, creating context menu');
    chrome.contextMenus.create({
        id: "parseRealtBy",
        title: "Сохранить объявление в Google Sheets",
        contexts: ["link"],
        documentUrlPatterns: ["*://realt.by/*"]
    });
});

chrome.storage.onChanged.addListener((changes) => {
    if (changes.spreadsheetId) {
        cachedSettings = null;
    }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    log(LOG_LEVEL.INFO, 'Context menu action triggered', { url: info.linkUrl });
    if (info.menuItemId === "parseRealtBy" && info.linkUrl) {
        let newTab;
        try {
            log(LOG_LEVEL.DEBUG, 'Getting auth token');
            cachedToken = await getAuthToken();

            log(LOG_LEVEL.DEBUG, 'Creating new tab for parsing');
            newTab = await chrome.tabs.create({ url: info.linkUrl, active: false });

            await chrome.scripting.executeScript({
                target: { tabId: newTab.id },
                files: ['content.js']
            });
            log(LOG_LEVEL.DEBUG, 'Content script injected');

            await new Promise(resolve => {
                chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
                    if (tabId === newTab.id && changeInfo.status === 'complete') {
                        log(LOG_LEVEL.DEBUG, 'Target page loaded completely');
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }
                });
            });

            chrome.tabs.remove(newTab.id);
            log(LOG_LEVEL.DEBUG, 'Temporary tab closed');
        } catch (error) {
            log(LOG_LEVEL.ERROR, 'Context menu processing failed', error);
        }
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'checkSheet') {
        (async () => {
            try {
                const result = await checkSheetData(request, cachedToken);
                log(LOG_LEVEL.DEBUG, 'checkSheet resolved', result);
                sendResponse({ success: result });
            } catch (error) {
                log(LOG_LEVEL.ERROR, 'checkSheet error', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; 
    }

    if (request.action === 'sendToSheets') {
        (async () => {
            try {
                const result = await handleSendToSheets(request, cachedToken);
                log(LOG_LEVEL.DEBUG, 'sendToSheets resolved', result);
                sendResponse({ success: result });

                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: chrome.runtime.getURL('images/parser-128.png'),
                    title: 'Realt.by Parser',
                    message: 'Объявление успешно сохранено!',
                });

            } catch (error) {
                log(LOG_LEVEL.ERROR, 'sendToSheets error', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    return true;
});


async function checkSheetData(request, token) {
    const { spreadsheetId } = await getSettings();
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await response.json();
    log(LOG_LEVEL.DEBUG, 'checkSheetData response', data);
    return !!data.values;
}

async function handleSendToSheets(request, token) {
    const { spreadsheetId } = await getSettings();
    log(LOG_LEVEL.INFO, 'Sending data to Google Sheets', {
        spreadsheetId: spreadsheetId,
        dataLength: request.data.length
    });

    const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                values: [request.data]
            })
        }
    );

    log(LOG_LEVEL.DEBUG, 'Google Sheets API response', {
        status: response.status,
        ok: response.ok
    });

    if (!response.ok) {
        const error = await response.json();
        log(LOG_LEVEL.ERROR, 'API request failed', error);
        throw new Error(error.error?.message || 'API error');
    }

    return true;
}

function getAuthToken() {
    return new Promise((resolve, reject) => {
        if (cachedToken && !tokenRefreshInProgress) {
            verifyToken(cachedToken)
                .then(isValid => {
                    if (isValid) {
                        log(LOG_LEVEL.DEBUG, 'Cached token is used');
                        resolve(cachedToken);
                    } else {
                        log(LOG_LEVEL.DEBUG, 'Token expired, requesting a new one');
                        fetchNewToken(resolve, reject);
                    }
                })
                .catch(error => {
                    log(LOG_LEVEL.ERROR, 'Token verification error', error);
                    fetchNewToken(resolve, reject);
                });
        } else if (tokenRefreshInProgress) {
            const interval = setInterval(() => {
                if (!tokenRefreshInProgress && cachedToken) {
                    clearInterval(interval);
                    resolve(cachedToken);
                }
            }, 100);
        } else {
            fetchNewToken(resolve, reject);
        }
    });
}

function fetchNewToken(resolve, reject) {
    tokenRefreshInProgress = true;

    chrome.identity.getAuthToken({ interactive: true }, (token) => {
        tokenRefreshInProgress = false;

        if (chrome.runtime.lastError) {
            log(LOG_LEVEL.ERROR, 'Error getting token', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
        } else {
            cachedToken = token;
            log(LOG_LEVEL.DEBUG, 'New token received');
            resolve(token);
        }
    });
}

function verifyToken(token) {
    return fetch('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + token)
        .then(response => {
            if (!response.ok) {
                throw new Error('Invalid response status');
            }
            return response.json();
        })
        .then(data => {
            return !data.error && data.expires_in > 0;
        })
        .catch(error => {
            log(LOG_LEVEL.ERROR, 'Token verification error', error);
            return false;
        });
}
