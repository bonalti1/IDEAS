import React from 'react'
import { createRoot } from 'react-dom/client'
import DraftApp from './draft/DraftApp.jsx'
import './brand/tokens.css'
import './styles.css'

// #/lot514 is the original drafter-side site plan review; DraftApp shows it to drafters only.
function Root() {
  const [hash, setHash] = React.useState(window.location.hash)
  React.useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  // #/office and #/drafter are the review inbox too: a guest lands on the office sign-in
  return <DraftApp admin={hash === '#/admin'} review={hash === '#/review' || hash === '#/office' || hash === '#/drafter'} billing={hash === '#/billing'} lot514={hash === '#/lot514'} />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
