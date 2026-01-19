const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const audioCache = new Map(); // id -> AudioBuffer
const configCache = new Map(); // id -> { startTime, endTime, volume }
const loadingCache = new Map(); // id -> Promise<AudioBuffer>

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.type === 'PLAY_AUDIO') {
        playAudio(message.activeSoundId);
    } else if (message.type === 'UPDATE_CACHE') {
        updateCache(message.activeSoundIds);
    }
});

/**
 * キャッシュを更新し、指定されたIDのロード完了を待てるようにする
 */
async function updateCache(activeSoundIds) {
    const ids = Array.isArray(activeSoundIds) ? activeSoundIds : [activeSoundIds || 'default'];

    // 不要なキャッシュをクリア
    for (const cachedId of audioCache.keys()) {
        if (!ids.includes(cachedId) && !loadingCache.has(cachedId)) {
            audioCache.delete(cachedId);
            configCache.delete(cachedId);
        }
    }

    const db = await initDB();
    const loadPromises = ids.map(async (id) => {
        if (audioCache.has(id)) return;
        if (loadingCache.has(id)) return loadingCache.get(id);

        const promise = (async () => {
            let arrayBuffer;
            let config = { startTime: 0, endTime: 0, volume: 1.0 };

            if (id === 'default') {
                const defaultSoundUrl = chrome.runtime.getURL('sounds/sample.mp3');
                const response = await fetch(defaultSoundUrl);
                arrayBuffer = await response.arrayBuffer();
                config = { startTime: 0, endTime: 0, volume: 1.0, fadeIn: 0.05, fadeOut: 0.1 };
            } else {
                const sound = await getSoundFromDB(db, id);
                if (sound) {
                    arrayBuffer = await sound.blob.arrayBuffer();
                    config = {
                        startTime: sound.startTime,
                        endTime: sound.endTime,
                        volume: sound.volume || 1.0,
                        fadeIn: sound.fadeIn !== undefined ? sound.fadeIn : 0.05,
                        fadeOut: sound.fadeOut !== undefined ? sound.fadeOut : 0.1
                    };
                }
            }

            if (arrayBuffer) {
                try {
                    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                    if (config.endTime === 0) config.endTime = audioBuffer.duration;

                    audioCache.set(id, audioBuffer);
                    configCache.set(id, config);
                } catch (e) {
                    console.error(`Decode error for ${id}:`, e);
                }
            }
            loadingCache.delete(id);
        })();

        loadingCache.set(id, promise);
        return promise;
    });

    await Promise.all(loadPromises);
}

let activeSource = null;

async function playAudio(id) {
    const targetId = id || 'default';

    // キャッシュにない場合は、ロードを待つ
    if (!audioCache.has(targetId)) {
        console.log(`Sound ${targetId} not in cache, loading on demand...`);
        await updateCache([targetId]);
    }

    const buffer = audioCache.get(targetId);
    const config = configCache.get(targetId);

    if (!buffer || !config) {
        console.warn(`Sound ${targetId} still not available after on-demand load.`);
        return;
    }

    // すでに再生中の音があれば停止する
    if (activeSource) {
        try {
            activeSource.stop();
        } catch (e) { }
        activeSource = null;
    }

    const source = audioCtx.createBufferSource();
    const gainNode = audioCtx.createGain();

    source.buffer = buffer;

    // --- フェード処理の設定 ---
    const now = audioCtx.currentTime;
    const fadeInDuration = config.fadeIn; // ユーザー設定値を使用
    const fadeOutDuration = config.fadeOut; // ユーザー設定値を使用
    const targetVolume = Math.max(0.001, config.volume); // exponentialRamp は 0 を指定できないため極小値
    const offset = config.startTime;
    const duration = config.endTime - config.startTime;

    // 初期音量は 0
    gainNode.gain.setValueAtTime(0.001, now);

    // フェードイン
    if (fadeInDuration > 0) {
        gainNode.gain.exponentialRampToValueAtTime(targetVolume, now + fadeInDuration);
    } else {
        gainNode.gain.setValueAtTime(targetVolume, now);
    }

    // フェードアウト開始時間を計算
    const fadeOutStartTime = now + Math.max(fadeInDuration, duration - fadeOutDuration);

    // 音の終わりに向けてフェードアウト
    if (fadeOutDuration > 0 && duration > fadeOutDuration) {
        gainNode.gain.setTargetAtTime(targetVolume, fadeOutStartTime, 0.01); // 安定化のためのベース
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
    }

    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    source.start(0, offset, duration > 0 ? duration : undefined);
    activeSource = source;

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
