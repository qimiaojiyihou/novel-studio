import { ref, watch } from 'vue'

const storageKey = 'show-creative-model-overrides'
export const showModelOverrides = ref(globalThis.window?.localStorage?.getItem(storageKey) === 'true')
watch(showModelOverrides, value => globalThis.window?.localStorage?.setItem(storageKey, String(value)))
