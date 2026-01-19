const OFFSCREEN_PATH = 'offscreen/offscreen.html';
let isOffscreenCreating = null; // 重複作成防止

/**
 * Offscreen Document の作成
 */
async function createOffscreen() {
    if (await chrome.offscreen.hasDocument()) return;

    // すでに作成中ならその完了を待つ
    if (isOffscreenCreating) {
        await isOffscreenCreating;
        return;
    }

    isOffscreenCreating = chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Typing sound feedback'
    });

    try {
        await isOffscreenCreating;
    } finally {
        isOffscreenCreating = null;
    }
}

/**
 * オフスクリーンへ確実にメッセージを届ける
 */
async function sendMessageToOffscreen(message) {
    await createOffscreen();

    // オフスクリーン側のスクリプトがロードされるまでわずかに待機
    // (Connection error の主な原因は、ドキュメント作成直後で受信準備ができていないため)
    let retries = 5;
    while (retries > 0) {
        try {
            await chrome.runtime.sendMessage(message);
            return; // 成功
        } catch (e) {
            retries--;
            if (retries === 0) throw e;
            await new Promise(r => setTimeout(r, 100)); // 100ms 待機してリトライ
        }
    }
}

// 拡張機能インストール/更新時
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'open-options',
        title: 'InterrupCat 設定',
        contexts: ['action']
    });
});

// コンテキストメニュークリック
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'open-options') {
        chrome.runtime.openOptionsPage();
    }
});

// メッセージハンドリング
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 非同期処理を行うため、リスナー自体は同期的に保ち内部で即時実行関数を使用
    if (message.type === 'TRIGGER_PLAY') {
        (async () => {
            const { isEnabled } = await chrome.storage.local.get(['isEnabled']);
            if (isEnabled === false) return;

            const { activeSoundIds } = await chrome.storage.local.get({ activeSoundIds: ['default'] });
            const ids = Array.isArray(activeSoundIds) ? activeSoundIds : [activeSoundIds || 'default'];

            // ランダムに1つ選択
            const randomId = ids[Math.floor(Math.random() * ids.length)];
            await sendMessageToOffscreen({ type: 'PLAY_AUDIO', activeSoundId: randomId });
        })();
    } else if (message.type === 'SOUND_UPDATED') {
        (async () => {
            const { activeSoundIds } = await chrome.storage.local.get({ activeSoundIds: ['default'] });
            await sendMessageToOffscreen({ type: 'UPDATE_CACHE', activeSoundIds });
        })();
    }
});

// 初期化時にオフスクリーンを作成しキャッシュを更新
(async () => {
    try {
        const { activeSoundIds } = await chrome.storage.local.get({ activeSoundIds: ['default'] });
        // リトライ機能付きの関数を使用することで、起動直後の接続エラーを回避
        await sendMessageToOffscreen({ type: 'UPDATE_CACHE', activeSoundIds });
        console.log('InterrupCat: Initialized offscreen cache.');
    } catch (e) {
        console.warn('InterrupCat: Initial offscreen setup failed, will retry on next trigger:', e);
    }
})();
