﻿const LOG_LEVEL = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};
let CURRENT_LOG_LEVEL = LOG_LEVEL.DEBUG;
const spreadsheetInput = document.getElementById('spreadsheetId');
const saveBtn = document.getElementById('saveBtn');
const authBtn = document.getElementById('authBtn');
const updateBtn = document.getElementById('updateBtn');
const statusDiv = document.getElementById('status');
const versionSpan = document.getElementById('version');
const newVersionSpan = document.getElementById('newVersion');

function log(level, message, data = null) {
    if (level >= CURRENT_LOG_LEVEL) {
        const timestamp = new Date().toLocaleString('ru-RU');
        const levelName = Object.keys(LOG_LEVEL).find(k => LOG_LEVEL[k] === level);
        console.log(`[${timestamp}] [${levelName}] ${message}`, data || '');
    }
}

document.addEventListener('DOMContentLoaded', async function () {
    log(LOG_LEVEL.INFO, 'Popup UI initialized');
    await loadSettings();

    updateBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: appState.downloadUrl });
    });

    saveBtn.addEventListener('click', function () {
        log(LOG_LEVEL.INFO, 'User clicked save button');
        const spreadsheetId = extractSpreadsheetId(spreadsheetInput.value.trim());
        log(LOG_LEVEL.DEBUG, 'Input values', { spreadsheetId });

        if (!spreadsheetId) {
            const errorMsg = 'Ошибка: Введите URL/ID таблицы';
            log(LOG_LEVEL.ERROR, errorMsg);
            showStatus(errorMsg, false);
            return;
        }

        chrome.storage.local.set({ spreadsheetId }, function () {
            log(LOG_LEVEL.INFO, 'Settings saved successfully');
            showStatus('Настройки сохранены', true);
        });
    });

    authBtn.addEventListener('click', function () {
        log(LOG_LEVEL.INFO, 'User initiated authentication');
        chrome.identity.getAuthToken({ interactive: true }, function (token) {
            if (chrome.runtime.lastError) {
                log(LOG_LEVEL.ERROR, 'Authentication failed', chrome.runtime.lastError);
                showStatus('Ошибка авторизации: ' + chrome.runtime.lastError.message, false);
            } else {
                log(LOG_LEVEL.INFO, 'User authenticated successfully');
                showStatus('Авторизация прошла успешно', true);
            }
        });
    });
});

function showStatus(message, isSuccess) {
    log(LOG_LEVEL.INFO, 'Status update', { message, isSuccess });
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + (isSuccess ? 'success' : 'error');
    statusDiv.style.display = 'block';

    if (isSuccess) {
        setTimeout(() => {
            if (statusDiv.textContent === message) {
                statusDiv.style.display = 'none';
            }
        }, 5000);
    }
}

function extractSpreadsheetId(url) {
    // Проверяем, является ли входная строка уже ID (состоит из букв, цифр и некоторых символов)
    if (/^[\w-]{44,}$/.test(url)) {
        return url;
    }

    // Пытаемся извлечь ID из различных форматов URL
    const patterns = [
        // Формат: https://docs.google.com/spreadsheets/d/{ID}/edit...
        /\/spreadsheets\/d\/([\w-]{44,})(?:\/|$)/,
        // Формат: https://docs.google.com/spreadsheets/d/{ID}/edit...
        /\/d\/([\w-]{44,})(?:\/|$)/,
        // Формат: https://docs.google.com/open?id={ID}
        /[?&]id=([\w-]{44,})(?:&|$)/,
        // Формат: https://docs.google.com/a/domain.com/spreadsheets/d/{ID}/edit...
        /\/a\/[^\/]+\/spreadsheets\/d\/([\w-]{44,})(?:\/|$)/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }

    return url;
}

async function loadSettings() {
    log(LOG_LEVEL.DEBUG, 'Loading settings from chrome.storage');
    chrome.storage.local.get(['spreadsheetId'], (data) => {
        log(LOG_LEVEL.DEBUG, 'Settings loaded from storage', data);
        if (data.spreadsheetId) spreadsheetInput.value = data.spreadsheetId;
    });

    const appState = await chrome.runtime.sendMessage({ type: 'get-update-status' });
    log(LOG_LEVEL.DEBUG, 'get response from background, appState:', appState);

    if (appState.updateAvailable) {
        updateBtn.hidden = false;
        updateBtn.textContent = `Обновить до v${appState.latestVersion}`;
    }

    versionSpan.textContent = chrome.runtime.getManifest().version;
}