import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'
import { CustomerCartProvider } from './context/CustomerCartContext'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CustomerCartProvider>
          <App />
        </CustomerCartProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
