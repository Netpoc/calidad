import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { captureInstallPrompt } from './composables/useInstall'
import './styles/main.css'

// Before mount: the install event fires once, early.
captureInstallPrompt()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
