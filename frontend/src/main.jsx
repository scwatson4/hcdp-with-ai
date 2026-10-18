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
import { AccessData, ExportData, VisualizeData } from './pages/content/DataPortal'
// HCDP's own pages, mirrored live (CONTRACT.md "Mirrored pages", 14 Oct), and its app shells as native embeds
import { Mirror } from './portal/MirroredPage'
import LibraryPage from './portal/Library'
import { ApiRoute, ClimateSummaryEmbed, ExtremeEventsRoute, GuamEmbed, MesonetRoute, PacificRoute, StormRoute, ToolsRoute } from './portal/routes'
import DownloadPage from './download/DownloadPage'
import NotFound from './pages/NotFound'
import AdminFeedback from './pages/AdminFeedback'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
      <BrowserRouter>
        <AssistantProvider>
          <Routes>
            <Route element={<App />}>
              <Route index element={<Landing />} />
              <Route path="about" element={<Mirror />} />
              <Route path="about/:page" element={<Mirror />} />
              <Route path="data" element={<AccessData />} />                {/* 18 Oct: two tiles, Visualize Data and Export Data */}
              <Route path="data/visualize" element={<VisualizeData />} />   {/* → the default map in the viewer */}
              <Route path="data/export" element={<ExportData />} />
              <Route path="data/api" element={<ApiRoute />} />
              <Route path="data/tutorials" element={<Mirror />} />
              <Route path="data/tutorials/:slug" element={<Mirror />} />
              <Route path="mesonet" element={<MesonetRoute />} />
              <Route path="climate-summary" element={<ClimateSummaryEmbed />} />
              <Route path="pacific" element={<PacificRoute />} />
              <Route path="pacific/guam" element={<GuamEmbed />} />
              <Route path="pacific/:slug" element={<Mirror />} />
              <Route path="extreme-events" element={<ExtremeEventsRoute />} />
              <Route path="extreme-events/:slug" element={<StormRoute />} />
              <Route path="tools" element={<ToolsRoute />} />
              <Route path="tools/:slug" element={<ToolsRoute />} />
              <Route path="cultural-resources" element={<Mirror />} />
              <Route path="cultural-resources/:slug" element={<Mirror />} />
              <Route path="library" element={<LibraryPage />} />
              <Route path="research/highlights" element={<Mirror />} />
              <Route path="research/external-resources" element={<Mirror />} />
              <Route path="research/presentations" element={<Mirror />} />
              <Route path="research/posts/:slug" element={<Mirror />} />
              <Route path="conditions-of-use" element={<Mirror />} />
              <Route path="download" element={<DownloadPage />} />
              <Route path="viewer/*" element={<ViewerPage />} />
              <Route path="admin/feedback" element={<AdminFeedback />} />   {/* P4 A: linked nowhere; type the address */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AssistantProvider>
      </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
