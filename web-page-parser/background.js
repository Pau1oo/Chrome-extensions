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
        contexts: ["link"],
        documentUrlPatterns: ["*://realt.by/*"]
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    log(LOG_LEVEL.INFO, 'Context menu clicked');
    if (info.menuItemId === "parseRealtBy" && info.linkUrl) {
        let newTab;
        try {
            newTab = await chrome.tabs.create({ url: info.linkUrl, active: false });

            await chrome.scripting.executeScript({
                target: { tabId: newTab.id },
                files: ['content.js']
            });

            await new Promise(resolve => {
                chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
                    if (tabId === newTab.id && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }
                });
            });

            chrome.tabs.remove(newTab.id);
        } catch (error) {
            console.error('Ошибка в обработке contextMenu:', error);
        }
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'checkSheet') {
        (async () => {
            try {
                const result = await checkSheetData(request);
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
                const result = await handleSendToSheets(request);
                log(LOG_LEVEL.DEBUG, 'sendToSheets resolved', result);
                sendResponse({ success: result });
            } catch (error) {
                log(LOG_LEVEL.ERROR, 'sendToSheets error', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    return;
});


async function checkSheetData(request) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${request.spreadsheetId}/values/A1`;

    const token = await getAuthToken();
    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await response.json();
    log(LOG_LEVEL.DEBUG, 'checkSheetData response', data);
    return !!data.values;
}

async function handleSendToSheets(request) {
    log(LOG_LEVEL.INFO, 'Отправка данных в Google Sheets', { spreadsheetId: request.spreadsheetId });

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

    log(LOG_LEVEL.DEBUG, 'Ответ от Google Sheets API', response.status);

    if (!response.ok) {
        throw new Error(result.error?.message || 'Ошибка API');
    }

    return true;
}

function getAuthToken() {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError) {
                log(LOG_LEVEL.ERROR, 'Ошибка получения токена', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                log(LOG_LEVEL.DEBUG, 'Токен получен');
                resolve(token);
            }
        });
    });
}
