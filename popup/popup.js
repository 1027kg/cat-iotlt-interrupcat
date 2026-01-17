document.getElementById('open-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

document.getElementById('play-preview').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'TRIGGER_PLAY' });
});

const powerSwitch = document.getElementById('power-switch');

// ロード時に状態を復元
chrome.storage.local.get(['isEnabled'], (result) => {
    powerSwitch.checked = result.isEnabled !== false;
});

powerSwitch.addEventListener('change', () => {
    chrome.storage.local.set({ isEnabled: powerSwitch.checked });
});
