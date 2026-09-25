import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './styles/globals.css'
import { ThemeProvider } from './components/ThemeProvider'
import { TooltipProvider } from './components/ui/tooltip'
import { AssistantProvider } from './assistant/AssistantProvider'
import App from './App'
import Landing from './pages/Landing'
import ViewerPage from './viewer/ViewerPage'
import { AboutTeam, AboutHistory, AboutAcknowledgements, HowToCite } from './pages/content/About'
import { AccessData, ApiAccess, Tutorials } from './pages/content/DataPortal'
import Mesonet from './pages/content/Mesonet'
import ClimateSummary from './pages/content/ClimateSummary'
import Pacific from './pages/content/Pacific'
import ExtremeEvents from './pages/content/ExtremeEvents'
import ClimateTools from './pages/content/ClimateTools'
import NotFound from './pages/NotFound'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="light">
      <TooltipProvider delayDuration={300}>
      <BrowserRouter>
        <AssistantProvider>
          <Routes>
            <Route element={<App />}>
              <Route index element={<Landing />} />
              <Route path="about" element={<AboutHistory />} />
              <Route path="about/team" element={<AboutTeam />} />
              <Route path="about/history" element={<AboutHistory />} />
              <Route path="about/acknowledgements" element={<AboutAcknowledgements />} />
              <Route path="about/how-to-cite" element={<HowToCite />} />
              <Route path="data" element={<AccessData />} />
              <Route path="data/api" element={<ApiAccess />} />
              <Route path="data/tutorials" element={<Tutorials />} />
              <Route path="mesonet" element={<Mesonet />} />
              <Route path="climate-summary" element={<ClimateSummary />} />
              <Route path="pacific" element={<Pacific />} />
              <Route path="extreme-events" element={<ExtremeEvents />} />
              <Route path="tools" element={<ClimateTools />} />
              <Route path="viewer/*" element={<ViewerPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AssistantProvider>
      </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
