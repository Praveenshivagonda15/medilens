# MediLens  -  What this app actually does 💊

MediLens is a free public utility built for the **India Innovates 2026** initiative. Its sole purpose is to help everyday people verify medicines, figure out what they do, and avoid getting overcharged at the pharmacy counter. (ok so basically i got overcharged for a basic prescription and it just sat in my head. so i built this from scratch in my bedroom).

Here's the rundown of what I built into it:

---

## 📷 Medicine Strip Scanner
You take a photo of any medicine pack (front, back, side panel, torn strips, or blurry shots) and it extracts:
- Brand name
- Active salt composition (e.g. Paracetamol 500mg)
- Manufacturer name
- MRP / retail price
- Batch number & expiry date

If the scan is extremely blurry, the app displays a confidence score so you know when to double-check with a pharmacist.

---

## 📝 Prescription Handwriting Reader
You take a photo of a doctor's handwritten prescription note. It extracts:
- Doctor's name and clinic details
- Patient name and date
- All listed medicines, dosage strength, frequency (like "1-0-1", "OD", "BD"), and food relations.

---

## 🔒 Authenticity Checks
The app scans the packaging for indicators of counterfeit drugs:
- **Good signs:** holograms, barcodes/QR codes, government price stickers, tamper seals, licence numbers.
- **Bad signs:** pixelated text on otherwise clear labels, font mismatches, or missing expiry dates.
- CDSCO registry match checking.

---

## 💸 Jan Aushadhi Generic Finder
MediLens lists government-subsidized Jan Aushadhi generic equivalents with prices taken from the official BPPI database. It calculates the exact amount of money you save by switching from the branded drug.

---

## ⚕️ Prescription vs. OTC Safety
The app automatically flags whether a medicine requires a doctor's prescription (Schedule H/H1/X drugs) with a red warning, or if it is a general Over-The-Counter (OTC) medicine. I wrote custom override rules for 70+ commonly misidentified medicines because the official government databases are full of spelling typos and inconsistencies (e.g. spelling "paracetamol" as "paracetamal").

---

## ☠️ Safety Guards
- **Hazardous substance blocking:** If you scan a household chemical (like bleach, pesticide, or acid), the app blocks the result with a heavy warning and displays the official Poison Control helpline (1800-116-117).
- **Non-medicine rejection:** It ignores stationery, food, or cosmetics, showing a friendly "this isn't a medicine" alert.
- **Dose safety calculator:** If you log a medicine, the app checks if your total daily dose exceeds the safe limits for your age and body weight.

---

## 🧬 Dynamic Bloodstream Simulation
Calculates how the drug level builds up and decays in your body using standard pharmacokinetic equations (the 1-compartment open Bateman model). As you adjust your dosage and frequency, the SVG concentration curve updates immediately in your browser.

---

## 📁 On-Device Security & Profiles
- **Profile Cabinet:** Create separate profiles for family members, log their daily schedules, track their adherence rates, and log active symptoms.
- **On-Device Cryptography:** If you lock your cabinet with a 4-digit PIN, your history is encrypted inside your browser cache using AES-GCM. I don't run servers, so your data never leaves your device. seriously, if you lose your PIN, your data is gone forever because i have no way to reset it.
