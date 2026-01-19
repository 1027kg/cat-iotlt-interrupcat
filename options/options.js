let wavesurfer;
let regions;
let activeRegion;

// IndexedDB Constants
const DB_NAME = 'InterrupCatDB';
const STORE_NAME = 'sounds';
const DB_VERSION = 2;
const MAX_CUSTOM_SOUNDS = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * IndexedDB 初期化
 */
async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * 全ての音声を正規の IndexedDB から取得
 */
async function getAllSounds() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 音聲データの保存（古いものを削除）
 */
async function saveSoundToList(name, blob, startTime, endTime, volume, fadeIn, fadeOut) {
  const allSounds = await getAllSounds();
  const customSounds = allSounds.filter(s => s.id !== 'default');

  // ソートして古い順に並める
  customSounds.sort((a, b) => a.updatedAt - b.updatedAt);

  const db = await initDB();
  const transaction = db.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  // 5件を超える場合は古いものを削除
  if (customSounds.length >= MAX_CUSTOM_SOUNDS) {
    const toDelete = customSounds[0];
    store.delete(toDelete.id);
  }

  // 新しいサウンドを保存
  const newId = 'custom_' + Date.now();
  const soundData = {
    id: newId,
    name,
    blob,
    startTime,
    endTime,
    volume,
    fadeIn,
    fadeOut,
    updatedAt: Date.now()
  };
  store.put(soundData);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(newId);
    transaction.onerror = () => reject(transaction.error);
  });
}

// UI Elements
const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('file-input');
const editorContainer = document.getElementById('editor-container');
const playBtn = document.getElementById('play-btn');
const saveBtn = document.getElementById('save-btn');
const startTimeText = document.getElementById('start-time');
const endTimeText = document.getElementById('end-time');
const durationText = document.getElementById('duration');
const soundListContainer = document.getElementById('sound-list');
const volumeSlider = document.getElementById('volume-slider');
const fadeInSlider = document.getElementById('fade-in-slider');
const fadeOutSlider = document.getElementById('fade-out-slider');
const fadeInLabel = document.getElementById('fade-in-label');
const fadeOutLabel = document.getElementById('fade-out-label');

// Trigger UI Elements
const keyTriggerList = document.getElementById('key-trigger-list');
const wordTriggerList = document.getElementById('word-trigger-list');
const newKeyInput = document.getElementById('new-key-input');
const newWordInput = document.getElementById('new-word-input');
const addKeyBtn = document.getElementById('add-key-btn');
const addWordBtn = document.getElementById('add-word-btn');

// Initial Load
document.addEventListener('DOMContentLoaded', async () => {
  renderSoundList();
  renderTriggerList();

  // ボリュームラベルの初期化
  const volumeLabel = document.getElementById('volume-label');
  volumeSlider.oninput = () => {
    volumeLabel.textContent = Math.round(volumeSlider.value * 100) + '%';
  };

  fadeInSlider.oninput = () => {
    fadeInLabel.textContent = fadeInSlider.value;
  };

  fadeOutSlider.oninput = () => {
    fadeOutLabel.textContent = fadeOutSlider.value;
  };

  // 初期値の反映
  volumeSlider.dispatchEvent(new Event('input'));
  fadeInSlider.dispatchEvent(new Event('input'));
  fadeOutSlider.dispatchEvent(new Event('input'));
});

// Sound List Rendering
async function renderSoundList() {
  const allSounds = await getAllSounds();
  const { activeSoundIds } = await chrome.storage.local.get({ activeSoundIds: ['default'] });

  soundListContainer.innerHTML = '';

  const soundsToShow = [...allSounds];
  if (!allSounds.find(s => s.id === 'default')) {
    soundsToShow.unshift({ id: 'default', name: '初期設定音 (sample.mp3)', startTime: 0, endTime: 0, volume: 1.0 });
  }

  soundsToShow.sort((a, b) => {
    if (a.id === 'default') return -1;
    if (b.id === 'default') return 1;
    return b.updatedAt - a.updatedAt;
  });

  const currentIds = Array.isArray(activeSoundIds) ? activeSoundIds : [activeSoundIds || 'default'];

  soundsToShow.forEach(sound => {
    const isSelected = currentIds.includes(sound.id);
    const item = document.createElement('div');
    item.className = `sound-item ${isSelected ? 'selected' : ''}`;

    item.innerHTML = `
      <input type="checkbox" class="sound-checkbox" value="${sound.id}" ${isSelected ? 'checked' : ''}>
      <div class="sound-name">${sound.name}</div>
      <div class="sound-item-actions">
        <button class="sound-play-small icon-btn-small" data-id="${sound.id}">
          <span class="material-symbols-outlined" style="font-size: 18px;">brand_awareness</span>
        </button>
        ${sound.id !== 'default' ? `
          <button class="sound-delete-small icon-btn-small" data-id="${sound.id}">
            <span class="material-symbols-outlined" style="font-size: 18px;">delete</span>
          </button>
        ` : ''}
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.icon-btn-small') || e.target.type === 'checkbox') return;
      toggleActiveSound(sound.id);
    });

    item.querySelector('.sound-checkbox').addEventListener('change', (e) => {
      toggleActiveSound(sound.id);
    });

    item.querySelector('.sound-play-small').addEventListener('click', (e) => {
      e.stopPropagation();
      previewSound(sound);
    });

    if (sound.id !== 'default') {
      item.querySelector('.sound-delete-small').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('この音声を削除しますか？')) {
          await deleteSound(sound.id);
        }
      });
    }

    soundListContainer.appendChild(item);
  });
}

async function deleteSound(id) {
  const db = await initDB();
  const transaction = db.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  store.delete(id);

  return new Promise((resolve) => {
    transaction.oncomplete = async () => {
      // アクティブリストからも削除
      const { activeSoundIds } = await chrome.storage.local.get({ activeSoundIds: ['default'] });
      let newIds = Array.isArray(activeSoundIds) ? activeSoundIds.filter(i => i !== id) : ['default'];
      if (newIds.length === 0) newIds = ['default'];

      await chrome.storage.local.set({ activeSoundIds: newIds });
      chrome.runtime.sendMessage({ type: 'SOUND_UPDATED' });
      await renderSoundList();
      resolve();
    };
  });
}

async function toggleActiveSound(id) {
  const { activeSoundIds } = await chrome.storage.local.get({ activeSoundIds: ['default'] });
  let newIds = Array.isArray(activeSoundIds) ? [...activeSoundIds] : [activeSoundIds || 'default'];

  if (newIds.includes(id)) {
    // 1つは残すように制御（任意）
    if (newIds.length > 1) {
      newIds = newIds.filter(i => i !== id);
    }
  } else {
    newIds.push(id);
  }

  await chrome.storage.local.set({ activeSoundIds: newIds });
  chrome.runtime.sendMessage({ type: 'SOUND_UPDATED' });
  renderSoundList();
}

let currentPreviewAudio = null;
async function previewSound(sound) {
  if (currentPreviewAudio) {
    currentPreviewAudio.pause();
    currentPreviewAudio = null;
  }

  let url;
  if (sound.id === 'default') {
    url = chrome.runtime.getURL('sounds/sample.mp3');
  } else {
    url = URL.createObjectURL(sound.blob);
  }

  const audio = new Audio(url);
  audio.currentTime = sound.startTime;
  // HTMLMediaElement.volume は 0.0 ~ 1.0 の範囲である必要があるためクランプ
  audio.volume = Math.min(1.0, Math.max(0.0, sound.volume || 1.0));
  audio.play();
  currentPreviewAudio = audio;

  if (sound.endTime > sound.startTime) {
    setTimeout(() => {
      if (currentPreviewAudio === audio) {
        audio.pause();
        currentPreviewAudio = null;
      }
    }, (sound.endTime - sound.startTime) * 1000);
  }
}

// Trigger Management
async function renderTriggerList() {
  const { targetKeys, targetWords } = await chrome.storage.local.get({
    targetKeys: ['c', 'a', 't', 'C', 'A', 'T'],
    targetWords: ['かわいい', 'kawaii', 'カワイイ']
  });

  keyTriggerList.innerHTML = '';
  targetKeys.forEach(key => {
    keyTriggerList.appendChild(createTag(key, 'key'));
  });

  wordTriggerList.innerHTML = '';
  targetWords.forEach(word => {
    wordTriggerList.appendChild(createTag(word, 'word'));
  });
}

function createTag(text, type) {
  const tag = document.createElement('span');
  tag.className = 'trigger-tag';
  tag.innerHTML = `
    ${text}
    <button class="remove-trigger">&times;</button>
  `;
  tag.querySelector('button').onclick = () => removeTrigger(text, type);
  return tag;
}

async function addTrigger(input, type) {
  const value = input.value.trim();
  if (!value) return;

  // 1文字制限はキー入力用の場合のみ
  if (type === 'key' && value.length > 1) {
    alert('キー入力は1文字で入力してください。');
    return;
  }

  const storageKey = type === 'key' ? 'targetKeys' : 'targetWords';
  const data = await chrome.storage.local.get({
    targetKeys: ['c', 'a', 't', 'C', 'A', 'T'],
    targetWords: ['かわいい', 'kawaii', 'カワイイ']
  });

  const list = data[storageKey];
  if (!list.includes(value)) {
    list.push(value);
    await chrome.storage.local.set({ [storageKey]: list });
    renderTriggerList();
    input.value = '';
  }
}

async function removeTrigger(text, type) {
  const storageKey = type === 'key' ? 'targetKeys' : 'targetWords';
  const data = await chrome.storage.local.get([storageKey]);
  const list = data[storageKey].filter(t => t !== text);
  await chrome.storage.local.set({ [storageKey]: list });
  renderTriggerList();
}

addKeyBtn.onclick = () => addTrigger(newKeyInput, 'key');
addWordBtn.onclick = () => addTrigger(newWordInput, 'word');

// Playground Implementation
const playgroundInput = document.getElementById('playground-input');
if (playgroundInput) {
  // キー入力検知
  playgroundInput.addEventListener('keydown', async (e) => {
    if (e.isComposing || e.keyCode === 229) return;

    const { targetKeys } = await chrome.storage.local.get({ targetKeys: ['c', 'a', 't', 'C', 'A', 'T'] });
    if (targetKeys.includes(e.key)) {
      chrome.runtime.sendMessage({ type: 'TRIGGER_PLAY' });
    }
  });

  // IME変換確定検知
  playgroundInput.addEventListener('compositionend', async (e) => {
    const { targetWords } = await chrome.storage.local.get({ targetWords: ['かわいい', 'kawaii', 'カワイイ'] });
    if (targetWords.includes(e.data)) {
      chrome.runtime.sendMessage({ type: 'TRIGGER_PLAY' });
    }
  });
}

// Upload Handling
uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.style.borderColor = 'var(--x-blue)';
});
uploadArea.addEventListener('dragleave', () => {
  uploadArea.style.borderColor = 'var(--x-border)';
});
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.style.borderColor = 'var(--x-border)';
  if (e.dataTransfer.files.length > 0) loadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) loadFile(e.target.files[0]);
});

function loadFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    alert('ファイルサイズが大きすぎます（10MB以下にしてください）。');
    return;
  }

  if (wavesurfer) wavesurfer.destroy();
  editorContainer.style.display = 'block';

  wavesurfer = WaveSurfer.create({
    container: '#waveform',
    waveColor: '#1d9bf0',
    progressColor: '#1a8cd8',
    cursorColor: '#e1e8ed', // うっすいグレー（Xのライトグレー）
    cursorWidth: 4,
    barWidth: 2,
    barRadius: 3,
    responsive: true,
    height: 100,
  });

  regions = wavesurfer.registerPlugin(WaveSurfer.Regions.create());
  wavesurfer.on('decode', () => {
    const duration = wavesurfer.getDuration();
    const regionWidth = duration * 0.4;
    const start = (duration - regionWidth) / 2;
    const end = start + regionWidth;

    activeRegion = regions.addRegion({
      start: start,
      end: end,
      color: 'rgba(29, 155, 240, 0.15)',
      drag: true,
      resize: true,
      handleStyle: {
        width: '6px',
        backgroundColor: '#1d9bf0',
        borderRadius: '3px'
      }
    });

    wavesurfer.setTime(start);
    updateTimeText(start, end);
  });
  regions.on('region-updated', (region) => {
    activeRegion = region;
    updateTimeText(region.start, region.end);
  });

  wavesurfer.load(URL.createObjectURL(file));
  wavesurfer.currentFileName = file.name;
}

function updateTimeText(start, end) {
  startTimeText.textContent = start.toFixed(2);
  endTimeText.textContent = end.toFixed(2);
  durationText.textContent = (end - start).toFixed(2);
}

playBtn.addEventListener('click', () => {
  if (!wavesurfer) return;

  if (wavesurfer.isPlaying()) {
    wavesurfer.pause();
  } else {
    let currentTime = wavesurfer.getCurrentTime();
    const duration = wavesurfer.getDuration();

    // もし再生位置が最後まで到達していたら、最初（またはリージョンの開始位置）に戻す
    const endPos = activeRegion ? activeRegion.end : duration;
    const startPos = activeRegion ? activeRegion.start : 0;

    if (currentTime >= endPos - 0.01) {
      wavesurfer.setTime(startPos);
      currentTime = startPos;
    }

    // HTMLMediaElement の制限によりプレビュー時は 1.0 に制限
    wavesurfer.setVolume(Math.min(1.0, parseFloat(volumeSlider.value)));
    wavesurfer.play();
  }
});

volumeSlider.addEventListener('input', () => {
  if (wavesurfer) {
    // プレビュー時は 1.0 に制限
    wavesurfer.setVolume(Math.min(1.0, parseFloat(volumeSlider.value)));
  }
});

saveBtn.addEventListener('click', async () => {
  if (!activeRegion || !wavesurfer) return;
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';

  try {
    const response = await fetch(wavesurfer.getSrc());
    const blob = await response.blob();
    const volume = parseFloat(volumeSlider.value);
    const fadeIn = parseFloat(fadeInSlider.value);
    const fadeOut = parseFloat(fadeOutSlider.value);
    const newId = await saveSoundToList(wavesurfer.currentFileName, blob, activeRegion.start, activeRegion.end, volume, fadeIn, fadeOut);

    // 新しく追加した音声をアクティブリストに追加
    const { activeSoundIds } = await chrome.storage.local.get({ activeSoundIds: ['default'] });
    let newIds = Array.isArray(activeSoundIds) ? [...activeSoundIds] : [activeSoundIds || 'default'];
    if (!newIds.includes(newId)) newIds.push(newId);

    await chrome.storage.local.set({ activeSoundIds: newIds });
    chrome.runtime.sendMessage({ type: 'SOUND_UPDATED' });

    wavesurfer.stop();
    await renderSoundList(); // リストを再描画して新しく追加された音声を表示
    alert('リストに追加しました！');
    editorContainer.style.display = 'none';
  } catch (err) {
    console.error(err);
    alert('保存に失敗しました。');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '選択した音を追加';
  }
});
