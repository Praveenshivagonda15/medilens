import React from 'react'
import { useT } from '../i18n/translations.js'
import { useLang } from '../App.jsx'

export default function Terms({ onBack }) {
  const { lang } = useLang()
  const t = useT(lang)
  return (
    <div style={{ flex: 1, padding: '24px 18px 48px 56px', animation: 'fadeIn 0.3s ease', maxWidth: 540 }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--green)', fontSize: 14, fontWeight: 600, marginBottom: 24 }}>
        ← {t.back || 'Back'}
      </button>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--navy)', marginBottom: 6 }}>{t.termsTitle || 'Terms of Service'}</h1>
      <p style={{ fontSize: 12, color: 'var(--textlt)', marginBottom: 28 }}>{t.termsLastUpdated || 'Last updated: March 2026'}</p>

      {[
        {
          heading: t.termsS1h || 'Acceptance',
          body: t.termsS1b || 'By using MediLens, you agree to these terms. If you do not agree, please do not use the service.'
        },
        {
          heading: t.termsS2h || 'Purpose of MediLens',
          body: t.termsS2b || 'MediLens is a free, public medicine verification and price comparison service built for informational purposes only. It is not a substitute for professional medical advice, diagnosis, or treatment.'
        },
        {
          heading: t.termsS3h || 'Medical disclaimer',
          body: t.termsS3b || 'MediLens does not provide medical advice. All information provided - including drug composition, authenticity scores, and generic alternatives - is for educational and informational purposes only. Always consult a qualified doctor or licensed pharmacist before making any health or medication decisions.'
        },
        {
          heading: t.termsS4h || 'Accuracy limitations',
          body: t.termsS4b || 'AI-based OCR and drug identification can be inaccurate. Authenticity assessments are heuristic - not a definitive determination of whether a medicine is genuine or counterfeit. CDSCO verification reflects our database at time of last update, not real-time government data.'
        },
        {
          heading: t.termsS5h || 'No commercial use',
          body: t.termsS5b || 'MediLens is provided as a non-commercial public service. You may not use it for automated bulk queries, data scraping, or commercial redistribution of results.'
        },
        {
          heading: t.termsS6h || 'Intellectual property',
          body: t.termsS6b || 'Drug registry data is sourced from publicly available government databases (CDSCO, Jan Aushadhi, NPPA) and is in the public domain. MediLens\'s interface, code, and curation are the property of its authors.'
        },
        {
          heading: t.termsS7h || 'Limitation of liability',
          body: t.termsS7b || 'MediLens is provided "as is" without warranty of any kind. The authors shall not be liable for any damages arising from use of or reliance on information provided by this service.'
        },
        {
          heading: t.termsS8h || 'Changes to terms',
          body: t.termsS8b || 'We may update these terms at any time. Continued use of MediLens after changes constitutes acceptance of the updated terms.'
        },
        {
          heading: t.termsS9h || 'Governing law',
          body: t.termsS9b || 'These terms are governed by the laws of India. Disputes shall be subject to the jurisdiction of courts in Tamil Nadu, India.'
        },
      ].map(({ heading, body }) => (
        <div key={heading} style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>{heading}</h2>
          <p style={{ fontSize: 14, color: 'var(--textmd)', lineHeight: 1.7 }}>{body}</p>
        </div>
      ))}

      <div style={{ background: 'var(--bgsoft)', borderRadius: 12, padding: '14px 16px', fontSize: 13, color: 'var(--textmd)', lineHeight: 1.6 }}>
        {t.termsFooter || 'MediLens is a public medicine information service.'}
      </div>
    </div>
  )
}
