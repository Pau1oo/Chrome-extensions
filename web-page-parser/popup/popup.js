// Конфигурация логгирования
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
        const logMessage = `[${timestamp}] [${Object.keys(LOG_LEVEL).find(k => LOG_LEVEL[k] === level)}] ${message}`;
        console.log(logMessage, data || '');

        // Также сохраняем логи в storage для последующего анализа
        chrome.storage.local.get(['extensionLogs'], (result) => {
            const logs = result.extensionLogs || [];
            logs.push({ timestamp, level: Object.keys(LOG_LEVEL)[level], message, data });
            chrome.storage.local.set({ extensionLogs: logs.slice(-100) }); // Храним последние 100 записей
        });
    }
}

document.addEventListener('DOMContentLoaded', function () {
    log(LOG_LEVEL.INFO, 'Popup initialized');

    // Элементы интерфейса
    const parseBtn = document.getElementById('parseBtn');
    const statusDiv = document.getElementById('status');
    const spreadsheetInput = document.getElementById('spreadsheetId');
    const sheetRangeInput = document.getElementById('sheetRange');
    const dataTypeSelect = document.getElementById('dataType');
    const debugToggle = document.getElementById('debugToggle');

    // Загружаем сохраненные настройки
    loadSettings();

    // Обработчик клика на кнопку
    parseBtn.addEventListener('click', handleParseButtonClick);

    // Функция загрузки сохраненных настроек
    function loadSettings() {
        log(LOG_LEVEL.DEBUG, 'Loading settings from storage');
        chrome.storage.local.get(['spreadsheetId', 'sheetRange', 'debugMode'], (data) => {
            log(LOG_LEVEL.DEBUG, 'Settings loaded from storage', data);

            if (data.spreadsheetId) spreadsheetInput.value = data.spreadsheetId;
            if (data.sheetRange) sheetRangeInput.value = data.sheetRange;
            if (data.debugMode) {
                debugToggle.checked = true;
                CURRENT_LOG_LEVEL = LOG_LEVEL.DEBUG;
            }
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

        // Если не удалось извлечь ID, возвращаем исходную строку
        return url;
    }

    // Основной обработчик кнопки
    async function handleParseButtonClick() {
        log(LOG_LEVEL.INFO, 'Parse button clicked');

        const spreadsheetId = extractSpreadsheetId(spreadsheetInput.value.trim());
        const sheetRange = sheetRangeInput.value.trim();
        const dataType = dataTypeSelect.value;

        log(LOG_LEVEL.DEBUG, 'Input values', { spreadsheetId, sheetRange, dataType });

        // Валидация
        if (!spreadsheetId) {
            const errorMsg = 'Ошибка: Введите ID таблицы';
            log(LOG_LEVEL.ERROR, errorMsg);
            showStatus(errorMsg, false);
            spreadsheetInput.focus();
            return;
        }

        // Сохраняем настройки
        log(LOG_LEVEL.DEBUG, 'Saving settings to storage');
        chrome.storage.local.set({ spreadsheetId, sheetRange });

        try {
            showStatus('Начинаем парсинг страницы...', true);
            log(LOG_LEVEL.INFO, 'Starting page parsing');

            // Получаем данные со страницы
            const parsedData = await parseCurrentPage(dataType);
            log(LOG_LEVEL.DEBUG, 'Parsed data received', { dataLength: parsedData.length });

            showStatus('Отправляем данные в Google Sheets...', true);
            log(LOG_LEVEL.INFO, 'Sending data to Google Sheets');

            // Отправляем в Google Sheets
            const result = await sendDataToSheets({
                spreadsheetId,
                range: sheetRange,
                data: parsedData
            });

            const successMsg = `Успешно! Добавлено ${result.updates.updatedRows} строк`;
            log(LOG_LEVEL.INFO, successMsg, result);
            showStatus(successMsg, true);
        } catch (error) {
            log(LOG_LEVEL.ERROR, 'Error during processing', {
                error: error.message,
                stack: error.stack
            });
            showStatus(`Ошибка: ${error.message}`, false);
        }
    }

    // Парсинг текущей страницы
    async function parseCurrentPage(dataType) {
        log(LOG_LEVEL.DEBUG, 'Starting parseCurrentPage', { dataType });

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            log(LOG_LEVEL.DEBUG, 'Current tab info', { tabId: tab.id, url: tab.url });

            const injectionResults = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: parsePageContent,
                args: [dataType]
            });
            log(LOG_LEVEL.DEBUG, 'Injection results', injectionResults);

            if (!injectionResults || !injectionResults[0] || !injectionResults[0].result) {
                throw new Error('Не удалось получить данные со страницы');
            }

            return injectionResults[0].result;
        } catch (error) {
            log(LOG_LEVEL.ERROR, 'Error in parseCurrentPage', error);
            throw error;
        }
    }

    // Отправка данных в Google Sheets через background.js
    function sendDataToSheets(params) {
        return new Promise((resolve, reject) => {
            log(LOG_LEVEL.DEBUG, 'Sending message to background', params);

            chrome.runtime.sendMessage(
                {
                    action: 'sendToSheets',
                    ...params
                },
                (response) => {
                    log(LOG_LEVEL.DEBUG, 'Response from background', {
                        response,
                        lastError: chrome.runtime.lastError
                    });

                    if (chrome.runtime.lastError) {
                        const error = new Error(chrome.runtime.lastError.message);
                        log(LOG_LEVEL.ERROR, 'Runtime error in sendDataToSheets', {
                            error: error.message,
                            params
                        });
                        reject(error);
                        return;
                    }

                    if (!response) {
                        const error = new Error('Пустой ответ от сервера');
                        log(LOG_LEVEL.ERROR, 'Empty response error', error);
                        reject(error);
                        return;
                    }

                    if (response.success) {
                        log(LOG_LEVEL.INFO, 'Success response from background', response);
                        resolve(response.result);
                    } else {
                        const error = new Error(response.error || 'Неизвестная ошибка');
                        log(LOG_LEVEL.ERROR, 'Error response from background', {
                            error: error.message,
                            response
                        });
                        reject(error);
                    }
                }
            );
        });
    }

    // Отображение статуса
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

// Функция парсинга, которая выполняется в контексте страницы
function parsePageContent(dataType) {
    console.log('Starting parsePageContent in content context', dataType);

    try {
        const data = [];

        switch (dataType) {
            case 'headers':
                console.log('Parsing headers');
                document.querySelectorAll('h1, h2, h3').forEach(el => {
                    data.push([el.tagName, el.textContent.trim()]);
                });
                break;

            case 'links':
                console.log('Parsing links');
                document.querySelectorAll('a').forEach(el => {
                    if (el.href && el.textContent.trim()) {
                        data.push([el.textContent.trim(), el.href]);
                    }
                });
                break;

            case 'tables':
                console.log('Parsing tables');
                document.querySelectorAll('table').forEach((table, tableIndex) => {
                    const rows = table.querySelectorAll('tr');
                    rows.forEach(row => {
                        const rowData = [];
                        row.querySelectorAll('td, th').forEach(cell => {
                            rowData.push(cell.textContent.trim());
                        });
                        if (rowData.length > 0) {
                            data.push([`Table ${tableIndex + 1}`, ...rowData]);
                        }
                    });
                });
                break;

            default:
                console.error('Unknown data type:', dataType);
                throw new Error('Неизвестный тип данных для парсинга');
        }

        console.log('Parsing completed, data length:', data.length);
        return data;
    } catch (error) {
        console.error('Error in parsePageContent:', error);
        throw error;
    }
}

//// Добавляем функцию для просмотра логов
//function viewLogs() {
//    chrome.storage.local.get(['extensionLogs'], (result) => {
//        const logs = result.extensionLogs || [];
//        console.log('Extension logs:', logs);
//        alert(`Последние логи:\n${logs.slice(-5).map(l => `${l.timestamp} [${l.level}] ${l.message}`).join('\n')}`);
//    });
//}

//// Добавляем кнопку для просмотра логов в интерфейс
//document.addEventListener('DOMContentLoaded', function () {
//    const logButton = document.createElement('button');
//    logButton.textContent = 'Показать логи';
//    logButton.onclick = viewLogs;
//    logButton.style.marginTop = '10px';
//    document.querySelector('.container').appendChild(logButton);
//});

document.addEventListener('DOMContentLoaded', function () {
    // Работа кастомного выпадающего списка
    const customSelect = document.querySelector('.custom-select');
    const selectHeader = customSelect.querySelector('.select-header');
    const options = customSelect.querySelectorAll('.option');
    const hiddenInput = document.getElementById('dataType');
    const selectedValue = customSelect.querySelector('.selected-value');

    // Открытие/закрытие списка
    selectHeader.addEventListener('click', function () {
        customSelect.classList.toggle('open');
    });

    // Выбор опции
    options.forEach(option => {
        option.addEventListener('click', function () {
            const value = this.getAttribute('data-value');
            const text = this.querySelector('span').textContent;

            // Обновляем выбранное значение
            hiddenInput.value = value;
            selectedValue.textContent = text;

            // Убираем выделение со всех опций и добавляем к выбранной
            options.forEach(opt => opt.classList.remove('selected'));
            this.classList.add('selected');

            // Закрываем список
            customSelect.classList.remove('open');
        });
    });

    // Закрытие при клике вне списка
    document.addEventListener('click', function (e) {
        if (!customSelect.contains(e.target)) {
            customSelect.classList.remove('open');
        }
    });

    // Инициализация выбранного значения
    options[0].classList.add('selected');
});