const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let audioBufferCache = null;
let soundConfig = { startTime: 0, endTime: 0, volume: 1.0 };

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.type === 'PLAY_AUDIO') {
        playAudio();
    } else if (message.type === 'UPDATE_CACHE') {
        updateCache(message.activeSoundId);
    }
});

async function updateCache(activeSoundId) {
    const targetId = activeSoundId || 'default';

    let arrayBuffer;
    let config = { startTime: 0, endTime: 0, volume: 1.0 };

    if (targetId === 'default') {
        const defaultSoundUrl = chrome.runtime.getURL('sounds/sample.mp3');
        const response = await fetch(defaultSoundUrl);
        arrayBuffer = await response.arrayBuffer();
        config = { startTime: 0, endTime: 0, volume: 1.0 };
    } else {
        const db = await initDB();
        const sound = await getSoundFromDB(db, targetId);
        if (sound) {
            arrayBuffer = await sound.blob.arrayBuffer();
            config = { startTime: sound.startTime, endTime: sound.endTime, volume: sound.volume || 1.0 };
        } else {
            const defaultSoundUrl = chrome.runtime.getURL('sounds/sample.mp3');
            const response = await fetch(defaultSoundUrl);
            arrayBuffer = await response.arrayBuffer();
            config = { startTime: 0, endTime: 0, volume: 1.0 };
        }
    }

    try {
        audioBufferCache = await audioCtx.decodeAudioData(arrayBuffer);
        soundConfig = config;
        if (soundConfig.endTime === 0 && audioBufferCache) {
            soundConfig.endTime = audioBufferCache.duration;
        }
    } catch (e) {
        console.error('Decode error:', e);
    }
}

let activeSource = null;

function playAudio() {
    if (!audioBufferCache) return;

    // すでに再生中の音があれば停止する
    if (activeSource) {
        try {
            activeSource.stop();
        } catch (e) {
            // すでに停止している場合は無視
        }
        activeSource = null;
    }

    const source = audioCtx.createBufferSource();
    const gainNode = audioCtx.createGain(); // ボリューム管理用のノード

    source.buffer = audioBufferCache;
    gainNode.gain.value = soundConfig.volume;

    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    const offset = soundConfig.startTime;
    const duration = soundConfig.endTime - soundConfig.startTime;

    source.start(0, offset, duration > 0 ? duration : undefined);
    activeSource = source; // 現在再生中のソースを保持

    // 再生終了後に null に戻す（連続再生時のメモリリーク防止ではないが、管理上）
    source.onended = () => {
        if (activeSource === source) {
            activeSource = null;
        }
    };
}

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('InterrupCatDB', 2);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('sounds')) {
                db.createObjectStore('sounds', { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function getSoundFromDB(db, id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['sounds'], 'readonly');
        const store = transaction.objectStore('sounds');
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// 初期ロード時は background.js からの UPDATE_CACHE メッセージを待つ
