<script setup lang="ts">
import { provideStatus } from '../popup/composables/useStatus';
import { providePreferences } from '../popup/composables/usePreferences';
import { provideTheme } from '../popup/composables/useTheme';
import ImportPanel from './ImportPanel.vue';

provideStatus();
providePreferences();
provideTheme();

const logoUrl = browser.runtime.getURL('assets/images/logo512.png');
</script>

<template>
  <div class="app">
    <header class="header">
      <img
        class="logo"
        :src="logoUrl"
        width="40"
        height="40"
        alt="Session Copy"
      />
      <div>
        <h1 class="brand-title">Session Copy</h1>
        <p class="brand-tagline">Secure session transfer for any website</p>
      </div>
    </header>

    <main class="card card-body">
      <ImportPanel />
    </main>
  </div>
</template>
