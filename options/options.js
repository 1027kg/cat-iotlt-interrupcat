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
 * 音聲データの保存
 */
async function saveSoundToList(name, blob, icon, startTime, endTime, volume, fadeIn, fadeOut) {
  const allSounds = await getAllSounds();
  const customSounds = allSounds.filter(s => s.id !== 'default');
  customSounds.sort((a, b) => a.updatedAt - b.updatedAt);

  const db = await initDB();
  const transaction = db.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  if (customSounds.length >= MAX_CUSTOM_SOUNDS) {
    const toDelete = customSounds[0];
    store.delete(toDelete.id);
  }

  const newId = 'custom_' + Date.now();
  const soundData = {
    id: newId,
    name,
    icon,
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

const keyTriggerList = document.getElementById('key-trigger-list');
const wordTriggerList = document.getElementById('word-trigger-list');
const newKeyInput = document.getElementById('new-key-input');
const newWordInput = document.getElementById('new-word-input');
const addKeyBtn = document.getElementById('add-key-btn');
const addWordBtn = document.getElementById('add-word-btn');

document.addEventListener('DOMContentLoaded', async () => {
  renderSoundList();
  renderTriggerList();

  const volumeLabel = document.getElementById('volume-label');
  volumeSlider.oninput = () => {
    volumeLabel.textContent = Math.round(volumeSlider.value * 100) + '%';
  };
  fadeInSlider.oninput = () => fadeInLabel.textContent = fadeInSlider.value;
  fadeOutSlider.oninput = () => fadeOutLabel.textContent = fadeOutSlider.value;

  // Modal Elements
  const iconUploadInput = document.getElementById('icon-upload-input');
  const cropContainerDiv = document.querySelector('.crop-container');
  const soundNameInput = document.getElementById('sound-name-input');
  const cropModal = document.getElementById('crop-modal');
  const cropCanvas = document.getElementById('crop-canvas');
  const cropCtx = cropCanvas.getContext('2d');
  const cropOkBtn = document.getElementById('crop-ok-btn');
  const cropCancelBtn = document.getElementById('crop-cancel-btn');

  let currentCropImage = null;
  let croppedIconData = null;
  let cropState = { x: 0, y: 0, scale: 1, isDragging: false, startX: 0, startY: 0 };

  // --- Modal Interaction Functions ---
  saveBtn.onclick = () => {
    if (!activeRegion || !wavesurfer) return;
    soundNameInput.value = wavesurfer.currentFileName.split('.')[0];
    cropModal.style.setProperty('display', 'flex', 'important');
    initPlaceholderCanvas();
  };

  function initPlaceholderCanvas() {
    cropCanvas.width = 200;
    cropCanvas.height = 200;
    cropCtx.clearRect(0, 0, 200, 200);
    cropCtx.fillStyle = "#f7f9f9";
    cropCtx.fillRect(0, 0, 200, 200);
    cropCtx.fillStyle = "#536471";
    cropCtx.font = "14px sans-serif";
    cropCtx.textAlign = "center";
    cropCtx.fillText("クリックして画像を選択", 100, 100);
    currentCropImage = null;
  }

  // キャンバスをクリックした時だけダイアログを開く（画像がない時のみ）
  // 画像がある時はドラッグに専念させる
  cropCanvas.onclick = () => {
    if (!currentCropImage) iconUploadInput.click();
  };

  iconUploadInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (re) => {
      const img = new Image();
      img.onload = () => {
        currentCropImage = img;
        const scale = Math.max(200 / img.width, 200 / img.height);
        cropState = {
          x: (200 - img.width * scale) / 2,
          y: (200 - img.height * scale) / 2,
          scale,
          isDragging: false
        };
        drawCrop();
      };
      img.src = re.target.result;
    };
    reader.readAsDataURL(file);
  };

  function drawCrop() {
    if (!currentCropImage) return;
    cropCtx.clearRect(0, 0, 200, 200);
    cropCtx.drawImage(currentCropImage, cropState.x, cropState.y, currentCropImage.width * cropState.scale, currentCropImage.height * cropState.scale);
  }

  cropCanvas.onmousedown = (e) => {
    if (!currentCropImage) return;
    cropState.isDragging = true;
    cropState.startX = e.clientX - cropState.x;
    cropState.startY = e.clientY - cropState.y;
  };
  window.addEventListener('mousemove', (e) => {
    if (!cropState.isDragging) return;
    cropState.x = e.clientX - cropState.startX;
    cropState.y = e.clientY - cropState.startY;
    drawCrop();
  });
  window.addEventListener('mouseup', () => cropState.isDragging = false);
  cropCanvas.onwheel = (e) => {
    if (!currentCropImage) return;
    e.preventDefault();
    const zoomSpeed = 0.001;
    const delta = -e.deltaY;
    const oldScale = cropState.scale;
    cropState.scale *= (1 + delta * zoomSpeed);
    cropState.x -= (100 - cropState.x) * (cropState.scale / oldScale - 1);
    cropState.y -= (100 - cropState.y) * (cropState.scale / oldScale - 1);
    drawCrop();
  };

  cropCancelBtn.onclick = () => {
    cropModal.style.setProperty('display', 'none', 'important');
    iconUploadInput.value = '';
    currentCropImage = null;
    croppedIconData = null;
  };

  cropOkBtn.onclick = async () => {
    if (currentCropImage) {
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = 100;
      finalCanvas.height = 100;
      const fctx = finalCanvas.getContext('2d');
      fctx.drawImage(cropCanvas, 0, 0, 200, 200, 0, 0, 100, 100);
      croppedIconData = finalCanvas.toDataURL('image/png');
    } else {
      croppedIconData = null;
    }
    await finalizeSaveSound();
    cropModal.style.setProperty('display', 'none', 'important');
  };

  async function finalizeSaveSound() {
    cropOkBtn.disabled = true;
    const originalText = cropOkBtn.textContent;
    cropOkBtn.textContent = '保存中...';
    try {
      const response = await fetch(wavesurfer.getSrc());
      const blob = await response.blob();
      const volume = parseFloat(volumeSlider.value);
      const fadeIn = parseFloat(fadeInSlider.value);
      const fadeOut = parseFloat(fadeOutSlider.value);
      const customName = soundNameInput.value.trim() || wavesurfer.currentFileName.split('.')[0];
      const newId = await saveSoundToList(customName, blob, croppedIconData, activeRegion.start, activeRegion.end, volume, fadeIn, fadeOut);

      const { activeSoundIds } = await chrome.storage.local.get({ activeSoundIds: ['default'] });
      let newIds = Array.isArray(activeSoundIds) ? [...activeSoundIds] : [activeSoundIds || 'default'];
      if (!newIds.includes(newId)) newIds.push(newId);
      await chrome.storage.local.set({ activeSoundIds: newIds });
      chrome.runtime.sendMessage({ type: 'SOUND_UPDATED' });

      soundNameInput.value = '';
      currentCropImage = null;
      croppedIconData = null;
      iconUploadInput.value = '';
      wavesurfer.stop();
      await renderSoundList();
      editorContainer.style.display = 'none';
    } catch (err) {
      console.error(err);
      alert('保存に失敗しました。');
    } finally {
      cropOkBtn.disabled = false;
      cropOkBtn.textContent = originalText;
    }
  }

  // --- Sound List Rendering ---
  async function renderSoundList() {
    const allSounds = await getAllSounds();
    const { activeSoundIds } = await chrome.storage.local.get({ activeSoundIds: ['default'] });
    soundListContainer.innerHTML = '';
    const soundsToShow = [...allSounds];
    if (!allSounds.find(s => s.id === 'default')) {
      soundsToShow.unshift({ id: 'default', name: '初期設定音 (sample.mp3)', startTime: 0, endTime: 0, volume: 1.0 });
    }
    soundsToShow.sort((a, b) => a.id === 'default' ? -1 : (b.id === 'default' ? 1 : b.updatedAt - a.updatedAt));
    const currentIds = Array.isArray(activeSoundIds) ? activeSoundIds : [activeSoundIds || 'default'];

    soundsToShow.forEach(sound => {
      const isSelected = currentIds.includes(sound.id);
      const item = document.createElement('div');
      item.className = `sound-item ${isSelected ? 'selected' : ''}`;
      item.innerHTML = `
        <input type="checkbox" class="sound-checkbox w-5 h-5 accent-[#1d9bf0] cursor-pointer" value="${sound.id}" ${isSelected ? 'checked' : ''}>
        <div class="sound-icon-small">
          ${sound.icon ? `<img src="${sound.icon}" class="w-full h-full object-cover">` : `<div class="w-full h-full sound-icon-placeholder"></div>`}
        </div>
        <div class="sound-name flex-1 text-[14px] font-bold truncate">${sound.name}</div>
        <div class="sound-item-actions flex gap-1">
          <button class="sound-play-small p-2 rounded-full hover:bg-[rgba(29,155,240,0.1)] hover:text-[#1d9bf0] transition-colors text-[#536471] flex items-center justify-center" data-id="${sound.id}">
            <span class="material-symbols-outlined text-[18px]">brand_awareness</span>
          </button>
          ${sound.id !== 'default' ? `<button class="sound-delete-small p-2 rounded-full hover:bg-[rgba(244,33,46,0.1)] hover:text-[#f4212e] transition-colors text-[#536471] flex items-center justify-center"><span class="material-symbols-outlined text-[18px]">delete</span></button>` : ''}
        </div>
      `;
      item.onclick = (e) => {
        if (e.target.closest('.icon-btn-small') || e.target.type === 'checkbox') return;
        toggleActiveSound(sound.id);
      };
      item.querySelector('.sound-checkbox').onchange = () => toggleActiveSound(sound.id);
      item.querySelector('.sound-play-small').onclick = (e) => { e.stopPropagation(); previewSound(sound); };
      if (sound.id !== 'default') {
        item.querySelector('.sound-delete-small').onclick = async (e) => {
          e.stopPropagation();
          if (confirm('この音声を削除しますか？')) {
            const db = await initDB();
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            transaction.objectStore(STORE_NAME).delete(sound.id);
            transaction.oncomplete = async () => {
              const { activeSoundIds } = await chrome.storage.local.get({ activeSoundIds: ['default'] });
              let newIds = activeSoundIds.filter(i => i !== sound.id);
              if (newIds.length === 0) newIds = ['default'];
              await chrome.storage.local.set({ activeSoundIds: newIds });
              chrome.runtime.sendMessage({ type: 'SOUND_UPDATED' });
              await renderSoundList();
            };
          }
        };
      }
      soundListContainer.appendChild(item);
    });
  }

  // リセット機能の追加
  document.getElementById('reset-list-btn').onclick = async () => {
    if (confirm('初期設定音以外のすべての音声を削除しますか？\nこの操作は取り消せません。')) {
      const db = await initDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      // IndexedDB内のすべてのカスタム音声をクリア
      store.clear();

      transaction.oncomplete = async () => {
        // storageの選択状態もリセット
        await chrome.storage.local.set({ activeSoundIds: ['default'] });
        chrome.runtime.sendMessage({ type: 'SOUND_UPDATED' });
        await renderSoundList();
      };
    }
  };

  async function toggleActiveSound(id) {
    const { activeSoundIds } = await chrome.storage.local.get({ activeSoundIds: ['default'] });
    let newIds = Array.isArray(activeSoundIds) ? [...activeSoundIds] : ['default'];
    if (newIds.includes(id)) {
      if (newIds.length > 1) newIds = newIds.filter(i => i !== id);
    } else {
      newIds.push(id);
    }
    await chrome.storage.local.set({ activeSoundIds: newIds });
    chrome.runtime.sendMessage({ type: 'SOUND_UPDATED' });
    renderSoundList();
  }

  let currentPreviewAudio = null;
  async function previewSound(sound) {
    if (currentPreviewAudio) currentPreviewAudio.pause();
    const url = sound.id === 'default' ? chrome.runtime.getURL('sounds/sample.mp3') : URL.createObjectURL(sound.blob);
    const audio = new Audio(url);
    audio.currentTime = sound.startTime;
    audio.volume = Math.min(1.0, Math.max(0.0, sound.volume || 1.0));
    audio.play();
    currentPreviewAudio = audio;
    if (sound.endTime > sound.startTime) {
      setTimeout(() => { if (currentPreviewAudio === audio) audio.pause(); }, (sound.endTime - sound.startTime) * 1000);
    }
  }

  // --- Trigger Management ---
  async function renderTriggerList() {
    const { targetKeys, targetWords } = await chrome.storage.local.get({ targetKeys: ['c', 'a', 't', 'C', 'A', 'T'], targetWords: ['かわいい', 'kawaii', 'カワイイ'] });
    keyTriggerList.innerHTML = '';
    targetKeys.forEach(key => keyTriggerList.appendChild(createTag(key, 'key')));
    wordTriggerList.innerHTML = '';
    targetWords.forEach(word => wordTriggerList.appendChild(createTag(word, 'word')));
  }

  function createTag(text, type) {
    const tag = document.createElement('span');
    tag.className = 'trigger-tag';
    tag.innerHTML = `${text}<button class="remove-trigger">&times;</button>`;
    tag.querySelector('button').onclick = async () => {
      const key = type === 'key' ? 'targetKeys' : 'targetWords';
      const data = await chrome.storage.local.get([key]);
      await chrome.storage.local.set({ [key]: data[key].filter(t => t !== text) });
      renderTriggerList();
    };
    return tag;
  }

  async function addTrigger(input, type) {
    const val = input.value.trim();
    if (!val || (type === 'key' && val.length > 1)) return;
    const key = type === 'key' ? 'targetKeys' : 'targetWords';
    const data = await chrome.storage.local.get({ targetKeys: [], targetWords: [] });
    if (!data[key].includes(val)) {
      data[key].push(val);
      await chrome.storage.local.set({ [key]: data[key] });
      renderTriggerList();
      input.value = '';
    }
  }
  addKeyBtn.onclick = () => addTrigger(newKeyInput, 'key');
  addWordBtn.onclick = () => addTrigger(newWordInput, 'word');

  // --- Playground ---
  const playgroundInput = document.getElementById('playground-input');
  playgroundInput.onkeydown = async (e) => {
    if (e.isComposing) return;
    const { targetKeys } = await chrome.storage.local.get({ targetKeys: [] });
    if (targetKeys.includes(e.key)) chrome.runtime.sendMessage({ type: 'TRIGGER_PLAY' });
  };
  playgroundInput.addEventListener('compositionend', async (e) => {
    const { targetWords } = await chrome.storage.local.get({ targetWords: [] });
    if (targetWords.includes(e.data)) chrome.runtime.sendMessage({ type: 'TRIGGER_PLAY' });
  });

  // --- Waveform Rendering ---
  uploadArea.onclick = () => fileInput.click();
  uploadArea.ondragover = (e) => { e.preventDefault(); uploadArea.style.borderColor = 'var(--x-blue)'; };
  uploadArea.ondragleave = () => uploadArea.style.borderColor = 'var(--x-border)';
  uploadArea.ondrop = (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); };
  fileInput.onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); };

  function loadFile(file) {
    if (file.size > MAX_FILE_SIZE) return alert('10MB以下にしてください。');
    if (wavesurfer) wavesurfer.destroy();
    editorContainer.style.display = 'block';
    wavesurfer = WaveSurfer.create({ container: '#waveform', waveColor: '#1d9bf0', progressColor: '#1a8cd8', cursorColor: '#e1e8ed', cursorWidth: 4, barWidth: 2, height: 100 });
    regions = wavesurfer.registerPlugin(WaveSurfer.Regions.create());
    wavesurfer.on('decode', () => {
      const d = wavesurfer.getDuration();
      activeRegion = regions.addRegion({ start: d * 0.3, end: d * 0.7, color: 'rgba(29, 155, 240, 0.15)', drag: true, resize: true });
      updateTimeText(activeRegion.start, activeRegion.end);
    });
    regions.on('region-updated', r => { activeRegion = r; updateTimeText(r.start, r.end); });
    wavesurfer.load(URL.createObjectURL(file));
    wavesurfer.currentFileName = file.name;
  }

  function updateTimeText(s, e) {
    startTimeText.textContent = s.toFixed(2);
    endTimeText.textContent = e.toFixed(2);
    durationText.textContent = (e - s).toFixed(2);
  }

  playBtn.onclick = () => {
    if (!wavesurfer) return;
    if (wavesurfer.isPlaying()) return wavesurfer.pause();
    const start = activeRegion ? activeRegion.start : 0;
    if (wavesurfer.getCurrentTime() >= (activeRegion ? activeRegion.end : wavesurfer.getDuration()) - 0.01) wavesurfer.setTime(start);
    wavesurfer.setVolume(Math.min(1.0, parseFloat(volumeSlider.value)));
    wavesurfer.play();
  };
  volumeSlider.oninput = () => {
    volumeLabel.textContent = Math.round(volumeSlider.value * 100) + '%';
    if (wavesurfer) wavesurfer.setVolume(Math.min(1.0, parseFloat(volumeSlider.value)));
  };
});
