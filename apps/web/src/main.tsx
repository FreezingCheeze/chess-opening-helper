import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { DataProvider } from './lib/data'
import './styles.css'

registerSW({ immediate: true })

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <DataProvider>
        <App />
      </DataProvider>
    </StrictMode>,
  )
}
