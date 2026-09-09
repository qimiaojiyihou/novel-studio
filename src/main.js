import { createApp } from 'vue'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import App from './App.vue'
import './styles.css'
import './design-system.css'

globalThis.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    return label === 'json' ? new JsonWorker() : new EditorWorker()
  },
}

createApp(App).mount('#app')
