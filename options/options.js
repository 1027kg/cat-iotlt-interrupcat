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
async function saveSoundToList(name, blob, startTime, endTime, volume) {
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
});

// Sound List Rendering
async function renderSoundList() {
  const allSounds = await getAllSounds();
  const { activeSoundId } = await chrome.storage.local.get(['activeSoundId']);

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

  const currentId = activeSoundId || 'default';

  soundsToShow.forEach(sound => {
    const item = document.createElement('div');
    item.className = `sound-item ${sound.id === currentId ? 'selected' : ''}`;

    item.innerHTML = `
      <input type="radio" name="sound-active" value="${sound.id}" ${sound.id === currentId ? 'checked' : ''}>
      <div class="sound-name">${sound.name}</div>
      <button class="sound-play-small" data-id="${sound.id}">🔊</button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') {
        setActiveSound(sound.id);
      }
    });

    item.querySelector('.sound-play-small').addEventListener('click', (e) => {
      e.stopPropagation();
      previewSound(sound);
    });

    soundListContainer.appendChild(item);
  });
}

async function setActiveSound(id) {
  await chrome.storage.local.set({ activeSoundId: id });
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
  audio.volume = Math.min(1.0, sound.volume || 1.0);
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
    cursorColor: '#0f1419',
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
    const currentTime = wavesurfer.getCurrentTime();
    wavesurfer.setVolume(parseFloat(volumeSlider.value));
    wavesurfer.play(currentTime);
  }
});

volumeSlider.addEventListener('input', () => {
  if (wavesurfer) {
    wavesurfer.setVolume(parseFloat(volumeSlider.value));
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
    const newId = await saveSoundToList(wavesurfer.currentFileName, blob, activeRegion.start, activeRegion.end, volume);
    await setActiveSound(newId);
    wavesurfer.stop();
    alert('リストに追加しました！');
    editorContainer.style.display = 'none';
  } catch (err) {
    console.error(err);
    alert('保存に失敗しました。');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'リストに追加して設定';
  }
});
