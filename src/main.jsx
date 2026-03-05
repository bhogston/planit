import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SpeedInsights } from '@vercel/speed-insights/react'
import './index.css'
import SatisfactoryPlanner from './SatisfactoryPlanner'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SatisfactoryPlanner />
    <SpeedInsights />
  </StrictMode>
)
