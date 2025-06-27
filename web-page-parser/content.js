const LOG_LEVEL = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};
let CURRENT_LOG_LEVEL = LOG_LEVEL.DEBUG;

function log(level, message, data = null) {
    if (level >= CURRENT_LOG_LEVEL) {
        const timestamp = new Date().toLocaleString('ru-RU');
        const levelName = Object.keys(LOG_LEVEL).find(k => LOG_LEVEL[k] === level);
        console.log(`[${timestamp}] [${levelName}] ${message}`, data || '');
    }
}

function extractDescription() {
    const noteHeader = [...document.querySelectorAll('h3')].find(h3 =>
        h3.textContent.trim() === 'Описание' || h3.textContent.trim() === 'Примечание'
    );
    if (!noteHeader) return '-';
    const descriptionContainer = noteHeader.nextElementSibling;
    if (!descriptionContainer) return '-';
    const clone = descriptionContainer.cloneNode(true);
    clone.querySelectorAll('button').forEach(btn => btn.remove());
    return clone.textContent.trim() || '-';
}

function extractPrice(typeOfPrice) {
    try {
        let noteHeader = document.querySelector('div:has(h2) + span')?.textContent.trim();
        let type;
        if (noteHeader.includes('$/м²') || noteHeader.includes('$/мес.')) type = 'rent';
        else if (noteHeader.includes('$')) type = 'purchase';
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

function extractAddress() {
    try {
        const addressElements = [...document.querySelectorAll('ul.text-basic > li:first-child a')]
            .map(a => a.textContent
                .replace(/&nbsp;|[\s,]+/g, ' ').trim()
            );

        if (addressElements.length === 0) return '-';

        let fullAddress = addressElements.join(', ');
        return fullAddress;
    } catch (e) {
        console.error('Error extracting full address:', e);
        return '-';
    }
}

function getTextContent(selector) {
    const el = document.querySelector(selector);
    return el ? el.textContent.trim() : '';
}

function getMapLink(coords) {
    const [lat, lng] = coords.split(',').map(x => x.trim());
    return `https://yandex.ru/maps/?ll=${lng},${lat}&z=15&pt=${lng},${lat}`;
}

async function addHeaders() {
    const headers = [
        'Время добавления', 'Ссылка', 'Тип', 'Стоим. покупки, USD', 'Стоим. ремонта, USD', 'Итог. стоимость, USD',
        'Площадь, м²', 'Цена за м², USD', 'Арендная ставка, USD', 'Стоимость аренды, USD', 'Окупаемость, лет', 'Описание', 'Адрес', 'Примечание'
    ];
    await chrome.runtime.sendMessage({
        action: 'sendToSheets',
        data: headers
    });
}

async function sendToSheets(data) {
    let addressUrl = getMapLink(data.coordinates);

    const response = await chrome.runtime.sendMessage({
        action: 'sendToSheets',
        data: [
            data.timestamp,
            data.url,
            data.type,
            data.purchasePrice,
            '0',
            '=ЕСЛИОШИБКА(ДВССЫЛ("D"&СТРОКА()) + ДВССЫЛ("E"&СТРОКА()); "-")',
            data.area,
            '=ЕСЛИОШИБКА(ОКРУГЛ(ДВССЫЛ("D"&СТРОКА()) / ДВССЫЛ("G"&СТРОКА()); 2); "-")',
            '???',
            '=ЕСЛИОШИБКА(ОКРУГЛ(ДВССЫЛ("G"&СТРОКА()) * ДВССЫЛ("I"&СТРОКА()) * 0,87; 2); "-")',
            '=ЕСЛИОШИБКА(ОКРУГЛ(ДВССЫЛ("F"&СТРОКА()) / ДВССЫЛ("J"&СТРОКА()) / 12); "-")',
            data.description,
            `=ГИПЕРССЫЛКА("${addressUrl}"; "${data.address}")`,
            ' '
        ]
    });

    if (response.success) { return true; }
    else {
        console.error('Ошибка:', response.error);
        alert(`Ошибка: ${response.error}`);
        return false;
    }
}

function extractPropertyData() {
    if (!isPropertyPage()) {
        log(LOG_LEVEL.WARN, 'Page is not a realt.by property page');
        alert('Это не страница объявления Realt.by');
        return null;
    }

    log(LOG_LEVEL.DEBUG, 'Starting property data extraction');
    const data = {
        timestamp: new Date().toLocaleString('ru-RU'),
        url: window.location.href,
        type: [...document.querySelectorAll('p')].find(el => el.textContent.trim() === 'Тип')?.previousElementSibling.textContent || '-',
        purchasePrice: extractPrice('purchase'),
        area: extractArea(),
        description: extractDescription(),
        coordinates: getTextContent('p.inline-flex'),
        address: extractAddress()
    };

    log(LOG_LEVEL.DEBUG, 'Property data extracted', {
        type: data.type,
        price: data.purchasePrice,
        hasAddress: data.address !== '-'
    });

    return data;
}

async function main() {
    log(LOG_LEVEL.INFO, 'Content script started execution');

    const check = await chrome.runtime.sendMessage({ action: 'checkSheet' });
    log(LOG_LEVEL.DEBUG, 'Sheet check result', { isValid: check.success });

    if (!check.success) {
        log(LOG_LEVEL.INFO, 'Adding headers to new sheet');
        await addHeaders();
    }

    const propertyData = extractPropertyData();
    if (propertyData) {
        log(LOG_LEVEL.DEBUG, 'Extracted property data', {
            type: propertyData.type,
            price: propertyData.purchasePrice,
            area: propertyData.area
        });

        try {
            await sendToSheets(propertyData);
            log(LOG_LEVEL.INFO, 'Data successfully sent to Sheets');
        } catch (err) {
            log(LOG_LEVEL.ERROR, 'Failed to send data to Sheets', err);
            alert('Error sending to Google Sheets');
        }
        chrome.runtime.sendMessage({ action: 'complete' });
    } else {
        log(LOG_LEVEL.WARN, 'Not a property page or extraction failed');
    }
}

main();
