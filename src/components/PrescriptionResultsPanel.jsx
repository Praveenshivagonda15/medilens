import React, { useState } from 'react'
import ResultsPanel from './ResultsPanel.jsx'
import { lookupMedicineNameOnly } from '../services/geminiService.js'

export default function PrescriptionResultsPanel({ results, preview, onReset, t, lang, bookmarks, onToggleBookmark }) {
  if (!results) return null;
  const data = results?.data || results;
  const [loadingLookup, setLoadingLookup] = useState(false)
  const [lookupMed, setLookupMed] = useState(null)
  const [lookupResults, setLookupResults] = useState(null)

  if (!data) return null

  const handleLookup = async (medName) => {
    setLookupMed(medName)
    setLoadingLookup(true)
    try {
      const res = await lookupMedicineNameOnly(medName)
      setLookupResults(res)
    } catch (e) {
      console.error(e)
      alert("Failed to find alternatives: " + e.message)
    } finally {
      setLoadingLookup(false)
    }
  }

  if (lookupResults) {
    return (
      <ResultsPanel
        results={lookupResults}
        preview={results?.preview || preview}
        onReset={() => {
          setLookupResults(null)
          setLookupMed(null)
        }}
        t={t}
        lang={lang}
        isBookmarked={bookmarks?.some(b => b.brandName === lookupResults.brandName && b.saltComposition === lookupResults.saltComposition)}
        onToggleBookmark={() => onToggleBookmark?.(lookupResults)}
      />
    )
  }

  const medicines = data.medicines || []

  const LayoutWrapper = ({ children }) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', background: '#fff', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10, boxShadow: 'var(--shadow)' }}>
        <button onClick={onReset} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600, color: 'var(--textlt)', padding: '6px 0', border: 'none', background: 'transparent', cursor: 'pointer' }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>‹</span> Back
        </button>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--navy)', position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>Prescription Details</h2>
        <div style={{ width: 60 }} />
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
      </div>

      <div style={{ padding: '14px 16px', background: '#fff', borderTop: '1px solid var(--border)', position: 'sticky', bottom: 0, zIndex: 10, boxShadow: '0 -1px 3px rgba(0,0,0,0.04)' }}>
        <button onClick={onReset} style={{ width: '100%', height: 48, background: 'var(--navy)', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background 0.2s', border: 'none', cursor: 'pointer' }}>
           Scan Another Document
        </button>
      </div>
    </div>
  )

  if (data.cannotRead) {
    return (
      <LayoutWrapper>
        <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 14, padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', boxShadow: 'var(--shadow)' }}>
          <span style={{ fontSize: 48 }}></span>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--navy)' }}>Could not read clearly</div>
          <div style={{ fontSize: 13.5, color: 'var(--textlt)', lineHeight: 1.6, maxWidth: 280 }}>
            {data.cannotReadReason || 'Ensure the prescription is well-lit and the text is legible.'}
          </div>
        </div>
      </LayoutWrapper>
    )
  }

  return (
    <LayoutWrapper>
      
      <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 14, padding: '16px', boxShadow: 'var(--shadow)', animation: 'fadeUp 0.4s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          {preview ? (
            <img src={preview} alt="" style={{ width: 50, height: 50, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--border)' }} />
          ) : (
            <div style={{ width: 50, height: 50, borderRadius: 10, background: 'var(--greenlt)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}></div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--navy)', marginBottom: 2 }}>{data.doctorName || 'Doctor details unavailable'}</div>
            <div style={{ fontSize: 13, color: 'var(--textlt)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span> {data.date || 'Unknown Date'}</span>
            </div>
          </div>
        </div>
        
        <div style={{ background: 'var(--bgsoft)', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>👤</span>
          <div>
            <div style={{ fontSize: 11, color: 'var(--textlt)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>Patient Name</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy)' }}>{data.patientName || 'Not specified'}</div>
          </div>
        </div>
      </div>

      <div style={{ animation: 'fadeUp 0.4s ease 0.1s both' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy)', margin: '0 0 12px 4px', display: 'flex', alignItems: 'center', gap: 6 }}> Prescribed Medicines ({medicines.length})</h3>
        
        {medicines.length === 0 ? (
          <div style={{ padding: '16px', background: '#fff', borderRadius: 12, border: '1px dashed var(--bordermd)', textAlign: 'center', color: 'var(--textlt)', fontSize: 13 }}>
            No medicines were detected in the prescription.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {medicines.map((med, index) => (
              <div key={index} style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 12, padding: '14px', boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--green)', marginBottom: 6 }}>{med.name}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  <span style={{ background: 'var(--bgsoft)', color: 'var(--navy)', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6 }}>⚖️ {med.dosage || '?'}</span>
                  <span style={{ background: '#FEF3C7', color: '#92400E', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6 }}>⏱ {med.frequency || '?'}</span>
                  <span style={{ background: '#E0F2FE', color: '#0369A1', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6 }}>⏳ {med.duration || '?'}</span>
                </div>
                {med.instructions && (
                  <div style={{ background: '#F0FDF4', color: '#166534', fontSize: 12, padding: '8px 12px', borderRadius: 8, borderLeft: '3px solid #16A34A', lineHeight: 1.4, marginBottom: 10 }}>
                    <strong>Note:</strong> {med.instructions}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <button
                    onClick={() => handleLookup(med.name)}
                    disabled={loadingLookup}
                    style={{
                      background: 'var(--green)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'opacity 0.2s',
                    }}
                  >
                    {loadingLookup && lookupMed === med.name ? (
                      <>
                        <span className="spinner" style={{
                          display: 'inline-block',
                          width: 12,
                          height: 12,
                          border: '2px solid rgba(255,255,255,0.3)',
                          borderTopColor: '#fff',
                          borderRadius: '50%',
                          animation: 'spin 0.8s linear infinite'
                        }} />
                        Searching...
                      </>
                    ) : (
                      <> Find Alternatives</>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, fontSize: 11.5, color: '#991B1B', lineHeight: 1.6, animation: 'fadeUp 0.4s ease 0.2s both' }}>
        <strong>Note: Disclaimer</strong>: This is an AI transcription of the prescription. Handwriting interpretation can contain errors. <strong>Always verify with the original prescription or consult your pharmacist before consuming any medication.</strong>
      </div>
    </LayoutWrapper>
  )
}

