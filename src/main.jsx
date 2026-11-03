import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import DraftApp from './draft/DraftApp.jsx'
import './brand/tokens.css'
import './styles.css'

// #/lot514 keeps the original drafter-side site plan review reachable.
function Root() {
  const [hash, setHash] = React.useState(window.location.hash)
  React.useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash === '#/lot514' ? <App /> : <DraftApp />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
