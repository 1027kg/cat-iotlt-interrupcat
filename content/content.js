// 動的なトリガー設定
let targetKeys = ['c', 'a', 't', 'C', 'A', 'T'];
let targetWords = ['かわいい', 'kawaii', 'カワイイ'];

// ストレージから設定を読み込む
function loadTriggers() {
    chrome.storage.local.get(['targetKeys', 'targetWords'], (result) => {
        if (result.targetKeys) targetKeys = result.targetKeys;
        if (result.targetWords) targetWords = result.targetWords;
    });
}

// 初期化と変更監視
loadTriggers();
chrome.storage.onChanged.addListener((changes) => {
    if (changes.targetKeys || changes.targetWords) {
        loadTriggers();
    }
});

document.addEventListener('keydown', (e) => {
    const activeElement = document.activeElement;
    const isInput = activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable;

    if (isInput && targetKeys.includes(e.key)) {
        if (!e.isComposing) {
            playSound();
        }
    }
});

document.addEventListener('compositionend', (e) => {
    const resultText = e.data;
    if (targetWords.some(word => resultText.includes(word))) {
        playSound();
    }
});

function playSound() {
    chrome.runtime.sendMessage({ type: 'TRIGGER_PLAY' });
}
