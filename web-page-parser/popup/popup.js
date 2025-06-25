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

const spreadsheetInput = document.getElementById('spreadsheetId');
const saveBtn = document.getElementById('saveBtn');
const authBtn = document.getElementById('authBtn');
const statusDiv = document.getElementById('status');

document.addEventListener('DOMContentLoaded', function () {

    log(LOG_LEVEL.INFO, 'Popup initialized');

    function loadSettings() {
        log(LOG_LEVEL.DEBUG, 'Loading settings from storage');
        chrome.storage.local.get(['spreadsheetId'], (data) => {
            log(LOG_LEVEL.DEBUG, 'Settings loaded from storage', data);
            if (data.spreadsheetId) spreadsheetInput.value = data.spreadsheetId;
        });
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

    loadSettings();

    saveBtn.addEventListener('click', function () {
        log(LOG_LEVEL.INFO, 'Save button clicked');

        const spreadsheetId = extractSpreadsheetId(spreadsheetInput.value.trim());

        log(LOG_LEVEL.DEBUG, 'Input values', { spreadsheetId });

        if (!spreadsheetId) {
            const errorMsg = 'Ошибка: Введите URL/ID таблицы';
            log(LOG_LEVEL.ERROR, errorMsg);
            showStatus(errorMsg, false);
            return;
        }

        log(LOG_LEVEL.DEBUG, 'Saving settings to storage');

        chrome.storage.local.set({ spreadsheetId }, function () {
            showStatus('Настройки сохранены', true);
        });
    });

    authBtn.addEventListener('click', function () {
        log(LOG_LEVEL.INFO, 'Auth button clicked');

        chrome.identity.getAuthToken({ interactive: true }, function (token) {
            if (chrome.runtime.lastError) {
                log(LOG_LEVEL.ERROR, chrome.runtime.lastError.message);
                showStatus('Ошибка авторизации: ' + chrome.runtime.lastError.message, false);
            } else {
                showStatus('Авторизация прошла успешно', true);
            }
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
});