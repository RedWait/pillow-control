<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { X } from "@lucide/vue";

const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
let returnFocus: HTMLElement | null = null;
let previousOverflow = "";
const backdropDown = ref(false);
let locked = false;

function viewport() {
  const vv = window.visualViewport;
  // Follow the visible area when the software keyboard opens. Do not constrain pinch zoom.
  const height = vv && vv.scale === 1 ? vv.height : window.innerHeight;
  const bottom = vv && vv.scale === 1 ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  dialog.value?.style.setProperty("--sheet-height", `${Math.max(120, height - 12)}px`);
  dialog.value?.style.setProperty("--sheet-bottom", `${bottom}px`);
}
function unlock() {
  window.visualViewport?.removeEventListener("resize", viewport);
  window.visualViewport?.removeEventListener("scroll", viewport);
  window.removeEventListener("resize", viewport);
  if (locked) document.body.style.overflow = previousOverflow;
  locked = false;
}
watch(() => props.open, (open) => {
  if (open) {
    returnFocus = document.activeElement as HTMLElement;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    locked = true;
    viewport();
    dialog.value?.showModal();
    // A clearly focusable field remains available if iOS declines keyboard activation.
    dialog.value?.querySelector<HTMLElement>("[data-initial-focus]")?.focus({ preventScroll: true });
    window.visualViewport?.addEventListener("resize", viewport);
    window.visualViewport?.addEventListener("scroll", viewport);
    window.addEventListener("resize", viewport);
  } else {
    dialog.value?.close();
    unlock();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
}, { flush: "post" });
onBeforeUnmount(unlock);
</script>

<template>
  <dialog ref="dialog" class="bottom-sheet" aria-labelledby="sheet-title"
    @cancel.prevent="emit('close')"
    @pointerdown="backdropDown = $event.target === dialog"
    @click="backdropDown && $event.target === dialog && emit('close')">
    <div class="sheet-surface">
      <header class="sheet-header">
        <h2 id="sheet-title">{{ title }}</h2>
        <button class="close-button" aria-label="关闭" @click="emit('close')"><X aria-hidden="true" /></button>
      </header>
      <div class="sheet-content"><slot /></div>
    </div>
  </dialog>
</template>
