/**
 * Network Status Composable
 *
 * Reactive network status tracking using Navigator.onLine API.
 * Zero dependencies, works everywhere Vue does.
 */

import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'

export function useNetworkStatus(): { isOnline: Ref<boolean> } {
  const isOnline = ref<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )

  function update() {
    isOnline.value = navigator.onLine
  }

  onMounted(() => {
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  })

  return { isOnline }
}
