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

function extractDescription() {
    const noteHeader = [...document.querySelectorAll('h3')].find(h3 =>
        h3.textContent.trim() === 'Описание' || h3.textContent.trim() === 'Примечание'
    );
    if (!noteHeader) return '';
    const descriptionContainer = noteHeader.nextElementSibling;
    if (!descriptionContainer) return '';
    const clone = descriptionContainer.cloneNode(true);
    clone.querySelectorAll('button').forEach(btn => btn.remove());
    return clone.textContent.trim();
}

function extractPrice(typeOfPrice) {
    try {
        let noteHeader = document.querySelector('h2').textContent;
        let type;
        if (noteHeader.includes('р./м²') || noteHeader.includes('р./мес.')) type = 'rent';
        else if (noteHeader.includes('р.')) type = 'purchase';
        noteHeader = noteHeader.replace(/[^\d-]/g, '');
        return typeOfPrice === type ? noteHeader : '-';
    } catch {
        return;
    }
}

function extractArea() {
    let noteHeader = [...document.querySelectorAll('p')].find(el =>
        el.textContent.trim() === 'Общая' || el.textContent.trim() === 'Площадь'
    )?.previousElementSibling.textContent;
    noteHeader = noteHeader.replace(/[^\d.-]/g, '').replace(/\./g, ',');
    return noteHeader;
}

function isPropertyPage() {
    return window.location.href.includes('realt.by') && window.location.pathname.includes('/object/');
}

function getTextContent(selector) {
    const el = document.querySelector(selector);
    return el ? el.textContent.trim() : '';
}

function getMapLink(coords) {
    const [lat, lng] = coords.split(',').map(x => x.trim());
    return `https://yandex.ru/maps/?ll=${lng},${lat}&z=15&pt=${lng},${lat}`;
}

async function addHeaders(spreadsheetId) {
    const headers = [
        'Время добавления', 'Ссылка', 'Тип', 'Стоим. покупки', 'Стоим. ремонта', 'Итог. стоимость',
        'Площадь', 'Цена за м²', 'Стоим. аренды', 'Окупаемость (лет)', 'Примечание', 'Местоположение'
    ];
    await chrome.runtime.sendMessage({
        action: 'sendToSheets',
        spreadsheetId,
        data: headers
    });
}

async function sendToSheets(data) {
    const result = await chrome.storage.local.get(['spreadsheetId']);
    const spreadsheetId = result.spreadsheetId;

    if (!spreadsheetId) {
        alert('ID таблицы не задан. Укажите его в настройках.');
        return;
    }

    const response = await chrome.runtime.sendMessage({
        action: 'sendToSheets',
        spreadsheetId,
        data: [
            data.timestamp,
            data.url,
            data.type,
            data.purchasePrice,
            '???',
            '=ЕСЛИОШИБКА(ДВССЫЛ("D"&СТРОКА()) + ДВССЫЛ("E"&СТРОКА()); "Не рассчитано")',
            data.area,
            '=ЕСЛИОШИБКА(ОКРУГЛ(ДВССЫЛ("D"&СТРОКА()) / ДВССЫЛ("G"&СТРОКА()); 2); "-")',
            data.rentPrice,
            'Окупаемость (лет)',
            data.description,
            getMapLink(data.coordinates)
        ]
    });

    if (response.success) {
        alert('Данные успешно добавлены!');
        return true;
    } else {
        console.error('Ошибка:', response.error);
        alert(`Ошибка: ${response.error}`);
        return false;
    }
}

function extractPropertyData() {
    if (!isPropertyPage()) {
        alert('Это не страница объявления на realt.by');
        return null;
    }

    return {
        timestamp: new Date().toLocaleString('ru-RU'),
        url: window.location.href,
        type: [...document.querySelectorAll('p')].find(el => el.textContent.trim() === 'Тип')?.previousElementSibling.textContent,
        purchasePrice: extractPrice('purchase'),
        area: extractArea(),
        rentPrice: extractPrice('rent'),
        description: extractDescription(),
        coordinates: getTextContent('p.inline-flex')
    };
}

async function main() {
    const result = await chrome.storage.local.get(['spreadsheetId']);
    const spreadsheetId = result.spreadsheetId;

    if (!spreadsheetId) {
        alert('ID таблицы не задан. Укажите его в настройках.');
        return;
    }

    const check = await chrome.runtime.sendMessage({ action: 'checkSheet', spreadsheetId });
    if (!check.success) {
        await addHeaders(spreadsheetId);
    }

    const propertyData = extractPropertyData();
    if (propertyData) {
        sendToSheets(propertyData).catch(err => {
            console.error('Ошибка при отправке данных:', err);
            alert('Ошибка при отправке в Google Sheets');
        });
        chrome.runtime.sendMessage({ action: 'complete' });
    }
}

main();
