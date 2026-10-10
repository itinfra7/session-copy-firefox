<script setup lang="ts">
import { useHostAccess } from '../composables/useHostAccess';

const { granted, requestAccess } = useHostAccess();
</script>

<template>
  <div v-if="!granted" class="access-banner" role="alert">
    <p class="access-banner-text">
      <strong>Website access is off</strong>
      Firefox has not granted Session Copy access to websites, so copy, paste and clear cannot run.
    </p>
    <button type="button" class="btn btn-primary access-banner-btn" @click="requestAccess">
      Allow access to websites
    </button>
  </div>
</template>
