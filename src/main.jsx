import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import SatisfactoryPlanner from './SatisfactoryPlanner'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SatisfactoryPlanner />
  </StrictMode>
)
