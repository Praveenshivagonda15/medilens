import React, { useState, createContext, useContext } from 'react'
import Scanner from './pages/Scanner.jsx'
import PrivacyPolicy from './pages/PrivacyPolicy.jsx'
import Terms from './pages/Terms.jsx'
import Documentation from './pages/Documentation.jsx'

export const LangContext = createContext({ lang: 'en', setLang: () => {} })
export const useLang = () => useContext(LangContext)
export const PageContext = createContext({ setPage: () => {} })
export const useSetPage = () => useContext(PageContext).setPage

export default function App() {
  const [lang, setLang] = useState('en')
  const [page, setPage] = useState('home')

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <PageContext.Provider value={{ setPage }}>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" />
        <div className="app-container" style={{ position: 'relative' }}>
          {page === 'home'    && <Scanner />}
          {page === 'privacy' && <PrivacyPolicy onBack={() => setPage('home')} />}
          {page === 'terms'   && <Terms onBack={() => setPage('home')} />}
          {page === 'docs'    && <Documentation onBack={() => setPage('home')} />}
        </div>
      </PageContext.Provider>
    </LangContext.Provider>
  )
}
