<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStatus } from '../popup/composables/useStatus';
import { useSessionActions, type RestoreTarget } from '../popup/composables/useSessionActions';
import HomeStatusBar from '../popup/components/HomeStatusBar.vue';
import HostAccessBanner from '../popup/components/HostAccessBanner.vue';

const { state } = useStatus();
const { importFile } = useSessionActions();

/** Cookie store of the tab the popup was opened from (container / private window). */
const requestedStore = new URLSearchParams(location.search).get('store') || '';

const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);

const destination = computed(() => {
  if (requestedStore === 'firefox-private') return 'in this private window';
  if (requestedStore.startsWith('firefox-container-')) return 'in the same container as your tab';
  return 'in a new tab';
});

async function resolveTarget(): Promise<RestoreTarget> {
  const current = await browser.tabs.getCurrent();
  return {
    windowId: current?.windowId,
    cookieStoreId: requestedStore || current?.cookieStoreId
  };
}

async function runImport(file: File) {
  await importFile(file, await resolveTarget());
}

function pickFile() {
  fileInput.value?.click();
}

function onFileChange() {
  const f = fileInput.value?.files?.[0];
  if (fileInput.value) fileInput.value.value = '';
  if (f) void runImport(f);
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f && !state.buttonsDisabled) void runImport(f);
}
</script>

<template>
  <div class="view" data-view="import">
    <HostAccessBanner />

    <p class="panel-title">Import session file</p>
    <p class="panel-lead">
      Choose an encrypted <em>.session</em> file. The site opens {{ destination }} with the session
      applied.
    </p>

    <div
      class="drop-zone"
      :class="{ 'is-dragging': dragging }"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <svg class="drop-zone-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 21V9M16 13l-4-4-4 4"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
        />
      </svg>
      <p class="drop-zone-text">Drop a .session file here</p>
      <button
        type="button"
        class="btn btn-primary"
        data-action="import"
        :disabled="state.buttonsDisabled"
        @click="pickFile"
      >
        Choose file…
      </button>
    </div>
    <input
      ref="fileInput"
      type="file"
      id="fileInput"
      accept=".session,application/octet-stream,*/*"
      hidden
      @change="onFileChange"
    />

    <HomeStatusBar />

    <p class="home-hint">Encrypted on your device. Treat shared sessions like passwords.</p>
  </div>
</template>
