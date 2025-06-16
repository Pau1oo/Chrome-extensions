function extractDescription() {
    const noteHeader = [...document.querySelectorAll('h3')].find(h3 =>
        h3.textContent.trim() === 'Описание'
    );

    if (!noteHeader) return '';

    const descriptionContainer = noteHeader.nextElementSibling;
    if (!descriptionContainer) return '';

    const clone = descriptionContainer.cloneNode(true);

    const buttons = clone.querySelectorAll('button');
    buttons.forEach(button => button.remove());

    return clone.textContent.trim();
}

function extractPropertyData() {
    if (!isPropertyPage()) {
        alert('Это не страница объявления на realt.by');
        return null;
    }

    return {
        url: window.location.href,
        title: getTextContent('h1'),
        price: getTextContent('h2'),
        area: [...document.querySelectorAll('p')].find(el => el.textContent.trim() === 'Общая')?.previousElementSibling.textContent,
        description: extractDescription(),
        coordinates: getTextContent('p.inline-flex')
    };
}

function isPropertyPage() {
    return window.location.href.includes('realt.by') &&
        (window.location.pathname.includes('/object/'));
}

function getTextContent(selector) {
    const element = document.querySelector(selector);
    return element ? element.textContent.trim() : '';
}

async function sendToSheets(data) {
    const result = await chrome.storage.local.get(['spreadsheetId']);
    const spreadsheetId = result.spreadsheetId;

    if (!spreadsheetId) {
        alert('ID таблицы не установлен. Пожалуйста, укажите его в настройках расширения.');
        return;
    }

    const response = await chrome.runtime.sendMessage({
        action: 'sendToSheets',
        spreadsheetId,
        data: [
            data.url,
            data.title,
            data.price,
            data.area,
            data.description,
            data.coordinates
        ]
    });

    if (response.success) {
        alert('Данные успешно сохранены в Google Sheets!');
    } else {
        alert(`Ошибка: ${response.error}`);
    }
}

const propertyData = extractPropertyData();
if (propertyData) sendToSheets(propertyData);