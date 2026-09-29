import React, { useState } from 'react'
import { LANGUAGES } from '../i18n/translations.js'
import { useSetPage } from '../App.jsx'

export default function HamMenu({ open, onClose, lang, setLang, t, onScan, onHealthCard, onCabinet, onReminders, onSymptoms }) {
  const [showLang, setShowLang] = useState(false)
  const setPage = useSetPage()

  const go = (page) => { setPage(page); onClose() }

  return (
    <div style={{
      background: '#fff',
      borderBottom: '1px solid var(--border)',
      overflow: 'hidden',
      maxHeight: open ? 650 : 0,
      visibility: open ? 'visible' : 'hidden',
      transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1), visibility 0.35s',
      boxShadow: open ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',
      overflowY: 'auto'
    }}>
      <div style={{ padding: '8px 0 4px' }}>

        <MenuItem icon="" label={t.menuScan || 'Scan Medicine'} sub={t.menuScanSub || 'Verify and compare any strip'} onClick={() => { onScan(); onClose() }} pill={t.active || 'Active'} />

        <MenuItem icon="" label={t.menuCabinet || 'Cabinet & Stock'} sub={t.menuCabinetSub || 'Manage inventory and pill counts'} onClick={() => { if (onCabinet) onCabinet(); onClose() }} />

        <MenuItem icon="" label={t.menuReminders || 'Alarms & Adherence'} sub={t.menuRemindersSub || 'Set reminders and log pill intake'} onClick={() => { if (onReminders) onReminders(); onClose() }} />

        <MenuItem icon="" label={t.menuHealthCard || 'Emergency Health Card'} sub={t.menuHealthCardSub || 'Offline scannable medical profile & QR'} onClick={() => { if (onHealthCard) onHealthCard(); onClose() }} />

        <MenuItem icon="️" label={t.menuSymptoms || 'Symptoms & Side Effects'} sub={t.menuSymptomsSub || 'Log side effects and check drug overlaps'} onClick={() => { if (onSymptoms) onSymptoms(); onClose() }} />

        <MenuItem icon="🌐" label={t.language || 'Language'} sub={LANGUAGES.find(l => l.code === lang)?.native || 'English'} onClick={() => setShowLang(s => !s)} />
        {showLang && (
          <div style={{ padding: '4px 18px 12px', display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {LANGUAGES.map(l => (
              <button key={l.code} onClick={() => { setLang(l.code); setShowLang(false) }}
                style={{ padding: '6px 13px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  background: lang === l.code ? 'var(--green)' : 'var(--bgsoft)',
                  border: `1.5px solid ${lang === l.code ? 'var(--green)' : 'var(--border)'}`,
                  color: lang === l.code ? '#fff' : 'var(--textlt)', transition: 'all 0.2s' }}>
                {l.native}
              </button>
            ))}
          </div>
        )}

        <MenuItem icon="🏛" label={t.menuGov || 'Government sources'} sub="CDSCO · NPPA · Jan Aushadhi"
          onClick={() => window.open('https://cdsco.gov.in', '_blank')} />

        <MenuItem icon="👤" label="Developer" sub="Praveen Shivagonda"
          onClick={() => window.open('https://github.com/Praveenshivagonda15', '_blank', 'noopener,noreferrer')} />

        <MenuItem icon="⌘" label="GitHub" sub="MediLens source code"
          onClick={() => window.open('https://github.com/Praveenshivagonda15/medilens', '_blank', 'noopener,noreferrer')} />

        <div style={{ margin: '6px 18px 0', paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 12, paddingBottom: 12, flexWrap: 'wrap' }}>
          <button id="menu-privacy-link" onClick={() => go('privacy')} style={{ fontSize: 11.5, color: 'var(--green)', fontWeight: 500 }}>
            {t.privacyTitle || 'Privacy Policy'}
          </button>
          <button id="menu-terms-link" onClick={() => go('terms')} style={{ fontSize: 11.5, color: 'var(--green)', fontWeight: 500 }}>
            {t.termsTitle || 'Terms of Service'}
          </button>
          <button id="menu-docs-link" onClick={() => go('docs')} style={{ fontSize: 11.5, color: 'var(--green)', fontWeight: 500 }}>
            API Documentation
          </button>
        </div>

        
      </div>
    </div>
  )
}

function MenuItem({ icon, label, sub, onClick, pill }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '12px 18px', cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--bgsoft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)', display: 'block', marginBottom: 1 }}>{label}</span>
        <span style={{ fontSize: 11.5, color: 'var(--textlt)' }}>{sub}</span>
      </div>
      {pill
        ? <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'var(--greenlt)', color: 'var(--green)', letterSpacing: '0.05em' }}>{pill}</span>
        : <span style={{ color: 'var(--textlt)', fontSize: 14 }}>›</span>
      }
    </div>
  )
}
