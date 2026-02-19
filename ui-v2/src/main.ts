import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './style.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// Global error boundary
app.config.errorHandler = (err, _instance, info) => {
  console.error('Vue error:', err, info)
  // Could integrate with toast notification here
}

app.mount('#app')