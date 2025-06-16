const LOG_LEVEL = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};
let CURRENT_LOG_LEVEL = LOG_LEVEL.DEBUG;

function log(level, message, data = null) {
    if (level >= CURRENT_LOG_LEVEL) {
        const timestamp = new Date().toISOString();
        const levelName = Object.keys(LOG_LEVEL).find(k => LOG_LEVEL[k] === level);
        console.log(`[${timestamp}] [${levelName}] ${message}`, data || '');
    }
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "parseRealtBy",
        title: "Сохранить объявление в Google Sheets",
        contexts: ["page"],
        documentUrlPatterns: ["*://realt.by/*"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    log(LOG_LEVEL.INFO, 'Parse btn clicked')
    if (info.menuItemId === "parseRealtBy") {
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'sendToSheets') {
        handleSendToSheets(request, sendResponse);
        return true;
    }
});

async function handleSendToSheets(request, sendResponse) {
    log(LOG_LEVEL.INFO, 'Sending data to Google Sheets API', { spreadsheetId: request.spreadsheetId });

    try {
        const token = await getAuthToken();
        const response = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${request.spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED`,
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

        log(LOG_LEVEL.DEBUG, 'API response status', response.status);

        if (!response.ok) throw new Error(await response.text());
        sendResponse({ success: true });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

function getAuthToken() {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            log(LOG_LEVEL.DEBUG, 'Received auth token', { token: token ? '***REDACTED***' : null });
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(token);
        });
    });
}