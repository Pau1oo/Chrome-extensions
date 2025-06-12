// Уровни логирования
const LOG_LEVEL = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};
let CURRENT_LOG_LEVEL = LOG_LEVEL.DEBUG;

// Функция логирования
function log(level, message, data = null) {
    if (level >= CURRENT_LOG_LEVEL) {
        const timestamp = new Date().toISOString();
        const levelName = Object.keys(LOG_LEVEL).find(k => LOG_LEVEL[k] === level);
        console.log(`[${timestamp}] [${levelName}] ${message}`, data || '');
    }
}

// Инициализация
log(LOG_LEVEL.INFO, 'Background script started');

// Обработчик авторизации
async function handleAuth(token) {
    log(LOG_LEVEL.DEBUG, 'Handling auth token');
    if (chrome.runtime.lastError) {
        log(LOG_LEVEL.ERROR, 'Auth error', chrome.runtime.lastError);
        return null;
    }
    return token;
}

// Получение токена
async function getToken() {
    log(LOG_LEVEL.INFO, 'Requesting auth token');
    return new Promise((resolve) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            log(LOG_LEVEL.DEBUG, 'Received auth token', { token: token ? '***REDACTED***' : null });
            resolve(handleAuth(token));
        });
    });
}

// Обновление токена
async function refreshToken(oldToken) {
    log(LOG_LEVEL.INFO, 'Refreshing auth token');
    return new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token: oldToken }, () => {
            chrome.identity.getAuthToken({ interactive: true }, (newToken) => {
                log(LOG_LEVEL.DEBUG, 'Received refreshed token', { token: newToken ? '***REDACTED***' : null });
                resolve(handleAuth(newToken));
            });
        });
    });
}

// Отправка данных в Google Sheets API
async function sendToSheetsAPI(token, request) {
    log(LOG_LEVEL.INFO, 'Sending data to Google Sheets API', {
        spreadsheetId: request.spreadsheetId,
        range: request.range,
        dataLength: request.data.length
    });

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${request.spreadsheetId}/values/${request.range}:append?valueInputOption=USER_ENTERED`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                values: request.data
            })
        });

        log(LOG_LEVEL.DEBUG, 'API response status', response.status);

        if (!response.ok) {
            const errorData = await response.json();
            log(LOG_LEVEL.ERROR, 'API error response', errorData);
            throw new Error(errorData.error?.message || `HTTP ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        log(LOG_LEVEL.ERROR, 'API request failed', error);
        throw error;
    }
}

// Основной обработчик сообщений
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log(LOG_LEVEL.DEBUG, 'Message received', {
        action: request.action,
        sender: sender.url
    });

    if (request.action === 'sendToSheets') {
        (async () => {
            try {
                // 1. Получаем токен
                let token = await getToken();
                if (!token) {
                    throw new Error('Authentication failed: No token received');
                }

                // 2. Отправляем данные в API
                const result = await sendToSheetsAPI(token, request);
                log(LOG_LEVEL.INFO, 'Data sent successfully', {
                    updatedRows: result.updates?.updatedRows
                });

                // 3. Отправляем успешный ответ
                sendResponse({
                    success: true,
                    result: {
                        updates: result.updates,
                        spreadsheetId: request.spreadsheetId
                    }
                });
            } catch (error) {
                // Обработка ошибки 401 (недействительный токен)
                if (error.message.includes('401')) {
                    log(LOG_LEVEL.WARN, 'Token expired, attempting refresh');
                    try {
                        token = await refreshToken(token);
                        if (!token) throw new Error('Token refresh failed');

                        // Повторяем запрос с новым токеном
                        const result = await sendToSheetsAPI(token, request);
                        sendResponse({
                            success: true,
                            result: {
                                updates: result.updates,
                                spreadsheetId: request.spreadsheetId
                            }
                        });
                        return;
                    } catch (refreshError) {
                        log(LOG_LEVEL.ERROR, 'Token refresh failed', refreshError);
                        error = refreshError;
                    }
                }

                // Отправляем ошибку
                log(LOG_LEVEL.ERROR, 'Processing failed', error);
                sendResponse({
                    success: false,
                    error: error.message,
                    details: error.stack
                });
            }
        })();

        // Возвращаем true для асинхронного ответа
        return true;
    }

    // Для неизвестных действий
    log(LOG_LEVEL.WARN, 'Unknown action received', request.action);
    sendResponse({
        success: false,
        error: `Unknown action: ${request.action}`
    });
});

// Обработчик обновления токена
chrome.identity.onSignInChanged.addListener((account, signedIn) => {
    log(LOG_LEVEL.INFO, 'Auth state changed', {
        account,
        signedIn
    });
});

// Периодическая проверка состояния
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 минут
setInterval(async () => {
    log(LOG_LEVEL.DEBUG, 'Running health check');
    try {
        const token = await getToken();
        log(LOG_LEVEL.INFO, 'Health check status', {
            tokenValid: !!token
        });
    } catch (error) {
        log(LOG_LEVEL.ERROR, 'Health check failed', error);
    }
}, HEALTH_CHECK_INTERVAL);