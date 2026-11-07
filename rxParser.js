/**
 * LuminaMed - Doctor Medical Receipt & Prescription Intelligent Parser
 * Handles image processing, client-side OCR via Tesseract.js, medical NLP parsing,
 * schedule timing resolution, and sample prescription generation.
 */

class LuminaRxParser {
  constructor() {
    this.commonDrugs = [
      'Amoxicillin', 'Azithromycin', 'Augmentin', 'Ciprofloxacin', 'Doxycycline', 'Cephalexin',
      'Paracetamol', 'Acetaminophen', 'Ibuprofen', 'Diclofenac', 'Tramadol', 'Naproxen',
      'Pantoprazole', 'Omeprazole', 'Rabeprazole', 'Esomeprazole', 'Ranitidine', 'Famotidine',
      'Metformin', 'Glimepiride', 'Vildagliptin', 'Sitagliptin', 'Insulin',
      'Atorvastatin', 'Rosuvastatin', 'Amlodipine', 'Telmisartan', 'Losartan', 'Metoprolol',
      'Cetirizine', 'Levocetirizine', 'Montelukast', 'Fexofenadine', 'Loratadine',
      'Vitamin D3', 'Vitamin C', 'Vitamin B12', 'Multivitamin', 'Calcium', 'Zinc', 'Iron',
      'Ascoril', 'Benadryl', 'Cough Syrup', 'Salbutamol', 'Budesonide'
    ];
  }

  /**
   * Run OCR on an image (File or Blob or DataURL)
   * Uses Tesseract.js
   */
  async extractTextFromImage(imageSource, progressCallback = null) {
    if (!window.Tesseract) {
      throw new Error('Tesseract.js OCR library is not loaded');
    }

    try {
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: m => {
          if (progressCallback && m.status === 'recognizing text') {
            progressCallback(Math.round(m.progress * 100));
          }
        }
      });

      const ret = await worker.recognize(imageSource);
      await worker.terminate();
      return ret.data.text;
    } catch (err) {
      console.error('OCR Error:', err);
      throw err;
    }
  }

  /**
   * Parse extracted raw text into structured medication objects
   */
  parsePrescriptionText(rawText) {
    const lines = rawText.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2);

    const detected = [];
    const usedNames = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const combinedContext = line + ' ' + (lines[i + 1] || '');

      // Check if line indicates a medicine
      const medItem = this.extractMedicationFromLine(line, combinedContext);
      if (medItem && !usedNames.has(medItem.name.toLowerCase())) {
        usedNames.add(medItem.name.toLowerCase());
        detected.push(medItem);
      }
    }

    // Fallback: If no standard lines parsed, search for known drugs anywhere in text
    if (detected.length === 0) {
      this.commonDrugs.forEach(drug => {
        const regex = new RegExp(`\\b${drug}\\b`, 'i');
        if (regex.test(rawText) && !usedNames.has(drug.toLowerCase())) {
          usedNames.add(drug.toLowerCase());
          detected.push({
            id: `rx_med_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: drug,
            dosage: this.extractDosage(rawText) || '500 mg',
            type: this.inferType(drug, rawText),
            times: this.extractTimes(rawText),
            foodInstruction: this.extractFoodInstruction(rawText),
            currentStock: 15,
            notes: 'Extracted from doctor medical receipt',
            color: this.getRandomColor()
          });
        }
      });
    }

    return detected;
  }

  /**
   * Extract individual medication details from a line/context
   */
  extractMedicationFromLine(line, context) {
    // Ignore clinic header / non-med lines
    const ignoreKeywords = ['dr.', 'clinic', 'hospital', 'patient', 'name:', 'age:', 'date:', 'phone', 'address', 'signature', 'reg no', 'rx', 'diagnosis'];
    const lineLower = line.toLowerCase();
    
    // If the line only contains metadata, skip
    if (ignoreKeywords.some(kw => lineLower.startsWith(kw) && !lineLower.includes('mg') && !lineLower.includes('tab'))) {
      return null;
    }

    // Typical Rx Line Patterns:
    // "1. Tab. Azithromycin 500mg - 1 OD x 5 days (After food)"
    // "Cap. Amoxicillin 500 mg 1-0-1 after food"
    // "Pantoprazole 40mg before breakfast"
    // "Paracetamol 650mg TDS"
    
    // 1. Check for form prefix (Tab, Cap, Syp, Inj, etc.)
    const formPrefixMatch = line.match(/\b(Tab(?:let)?|Cap(?:sule)?|Syp(?:rup)?|Inj(?:ection)?|Drops?|Inhaler)\.?\s+([A-Za-z0-9\s\-]+)/i);
    
    // 2. Check for dosage pattern (e.g. 500mg, 40 mg, 650 mg, 10ml, 1000 IU)
    const dosageMatch = line.match(/\b(\d+(?:\.\d+)?\s*(?:mg|ml|mcg|iu|g))\b/i);

    let name = '';
    let form = 'tablet';
    let dosage = dosageMatch ? dosageMatch[1].trim() : '';

    if (formPrefixMatch) {
      const prefix = formPrefixMatch[1].toLowerCase();
      if (prefix.startsWith('cap')) form = 'capsule';
      else if (prefix.startsWith('syp')) form = 'syrup';
      else if (prefix.startsWith('inj')) form = 'injection';
      else if (prefix.startsWith('drop')) form = 'drops';
      else if (prefix.startsWith('inh')) form = 'inhaler';
      else form = 'tablet';

      // Clean name: take words after prefix until numbers/dosage
      let rawName = formPrefixMatch[2];
      if (dosageMatch) {
        rawName = rawName.split(dosageMatch[1])[0];
      }
      name = rawName.replace(/[-–—:()]/g, '').trim();
    } else {
      // Look for known drugs in line
      const matchedDrug = this.commonDrugs.find(d => new RegExp(`\\b${d}\\b`, 'i').test(line));
      if (matchedDrug) {
        name = matchedDrug;
        form = this.inferType(matchedDrug, line);
      } else if (dosageMatch) {
        // Line has a dosage: try extracting the preceding word as medicine name
        const parts = line.split(dosageMatch[1]);
        const before = parts[0].replace(/^[\d\.\-\)\s]+/, '').trim();
        const words = before.split(/\s+/).filter(w => w.length > 2);
        if (words.length > 0) {
          name = words.slice(-2).join(' ').replace(/[^a-zA-Z0-9\s]/g, '');
        }
      }
    }

    if (!name || name.length < 3) return null;

    // Clean name from trailing numbers or hyphens
    name = name.replace(/^[\d\.\s]+/, '').trim();
    name = name.charAt(0).toUpperCase() + name.slice(1);

    // Schedule Times (OD, BD, TDS, 1-0-1, etc.)
    const times = this.extractTimes(context);

    // Food instruction
    const foodInstruction = this.extractFoodInstruction(context);

    // Duration & stock
    const stock = this.extractQuantity(context, times.length);

    return {
      id: `rx_med_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name,
      dosage: dosage || '500 mg',
      type: form,
      times: times.length > 0 ? times : ['08:00', '20:00'],
      foodInstruction,
      currentStock: stock,
      notes: `Prescribed on medical receipt. ${context.slice(0, 80)}`,
      color: this.getRandomColor()
    };
  }

  extractTimes(text) {
    const t = text.toLowerCase();

    // 1-1-1 or TDS / TID (Morning, Afternoon, Night)
    if (/1-1-1|tds|tid|thrice|3 times/i.test(t)) {
      return ['08:00', '13:00', '20:00'];
    }

    // 1-0-1 or BD / BID (Morning, Night)
    if (/1-0-1|bd|bid|twice|2 times/i.test(t)) {
      return ['08:00', '20:00'];
    }

    // 1-0-0 or OD / Once Daily (Morning)
    if (/1-0-0|\bod\b|once daily|morning/i.test(t)) {
      return ['08:00'];
    }

    // 0-0-1 or HS / Bedtime (Night)
    if (/0-0-1|\bhs\b|bedtime|at night/i.test(t)) {
      return ['21:00'];
    }

    // 0-1-0 (Afternoon)
    if (/0-1-0|afternoon|lunch/i.test(t)) {
      return ['13:00'];
    }

    // 4 times daily
    if (/qid|4 times/i.test(t)) {
      return ['08:00', '12:00', '17:00', '21:00'];
    }

    return ['08:00', '20:00']; // default twice daily
  }

  extractFoodInstruction(text) {
    const t = text.toLowerCase();
    if (/before (food|meal|breakfast)|empty stomach|\bac\b/i.test(t)) {
      return 'Before food';
    }
    if (/after (food|meal|dinner|lunch)|\bpc\b/i.test(t)) {
      return 'After food';
    }
    if (/with (food|meal)/i.test(t)) {
      return 'With food';
    }
    if (/bedtime|at night/i.test(t)) {
      return 'At bedtime';
    }
    return 'After food';
  }

  extractQuantity(text, timesPerDay = 2) {
    // Check for "x 5 days", "for 7 days", "10 tabs"
    const daysMatch = text.match(/(?:x|for)\s*(\d+)\s*days?/i);
    if (daysMatch) {
      const days = parseInt(daysMatch[1], 10);
      return Math.max(5, days * timesPerDay);
    }

    const qtyMatch = text.match(/\b(?:qty|count|tab|cap)?[:\s]*(\d+)\s*(?:tabs?|caps?|tablets?|pills?)\b/i);
    if (qtyMatch) {
      return parseInt(qtyMatch[1], 10);
    }

    return 20; // default initial stock
  }

  extractDosage(text) {
    const m = text.match(/\b(\d+(?:\.\d+)?\s*(?:mg|ml|mcg|iu|g))\b/i);
    return m ? m[1] : null;
  }

  inferType(drugName, context) {
    const c = (drugName + ' ' + context).toLowerCase();
    if (c.includes('syrup') || c.includes('syp') || c.includes('suspension')) return 'syrup';
    if (c.includes('cap') || c.includes('amoxicillin')) return 'capsule';
    if (c.includes('inj') || c.includes('insulin')) return 'injection';
    if (c.includes('drop')) return 'drops';
    if (c.includes('inhaler') || c.includes('budesonide')) return 'inhaler';
    return 'tablet';
  }

  getRandomColor() {
    const colors = ['cyan', 'emerald', 'indigo', 'rose', 'amber'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /**
   * Generates a realistic doctor prescription image on an HTML5 canvas
   * and returns its Data URL. Useful for instant demo testing!
   */
  generateSampleReceiptImage() {
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 960;
    const ctx = canvas.getContext('2d');

    // Medical slip background (crisp off-white / light parchment)
    ctx.fillStyle = '#fafbfe';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle clinic border
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 4;
    ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);

    // Inner header colored bar
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(18, 18, canvas.width - 36, 10);

    // Clinic Header
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('ST. JUDE MEDICAL HEALTHCARE CLINIC', 40, 65);

    ctx.fillStyle = '#2563eb';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('Dr. Robert A. Miller, MD (Internal Medicine)', 40, 96);

    ctx.fillStyle = '#64748b';
    ctx.font = '13px sans-serif';
    ctx.fillText('Reg. No: MED-884291 • Contact: (555) 234-5678 • Suite 402, Metro Blvd', 40, 118);

    // Divider Line
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(40, 134);
    ctx.lineTo(canvas.width - 40, 134);
    ctx.stroke();

    // Patient Info Grid
    const todayStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    ctx.fillStyle = '#334155';
    ctx.font = '14px sans-serif';
    ctx.fillText('Patient Name: Alex Johnson', 40, 162);
    ctx.fillText('Age: 38 Yrs / Male', 360, 162);
    ctx.fillText(`Date: ${todayStr}`, 540, 162);

    ctx.fillText('Diagnosis: Upper Respiratory Tract Infection & Acid Reflux', 40, 188);

    ctx.beginPath();
    ctx.moveTo(40, 204);
    ctx.lineTo(canvas.width - 40, 204);
    ctx.stroke();

    // Rx Symbol
    ctx.fillStyle = '#1e40af';
    ctx.font = 'bold 44px serif';
    ctx.fillText('℞', 40, 260);

    // Medications List
    const prescriptions = [
      {
        num: '1.',
        type: 'Tab.',
        name: 'Azithromycin',
        dosage: '500 mg',
        freq: '1 - 0 - 0  (Once Daily)',
        duration: 'x 5 Days',
        inst: 'Take after meal with warm water'
      },
      {
        num: '2.',
        type: 'Tab.',
        name: 'Pantoprazole',
        dosage: '40 mg',
        freq: '1 - 0 - 0  (Empty Stomach)',
        duration: 'x 14 Days',
        inst: 'Take 30 minutes before breakfast'
      },
      {
        num: '3.',
        type: 'Tab.',
        name: 'Paracetamol',
        dosage: '650 mg',
        freq: '1 - 0 - 1  (Twice Daily)',
        duration: 'x 3 Days',
        inst: 'Take after food for fever and body ache'
      },
      {
        num: '4.',
        type: 'Syp.',
        name: 'Ascoril Cough Syrup',
        dosage: '10 ml',
        freq: '1 - 1 - 1  (Thrice Daily)',
        duration: 'x 5 Days',
        inst: 'Take after meals'
      }
    ];

    let startY = 310;
    prescriptions.forEach((rx) => {
      // Medicine Name and Type
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(`${rx.num} ${rx.type} ${rx.name} ${rx.dosage}`, 50, startY);

      // Timing / Schedule / Duration
      ctx.fillStyle = '#0284c7';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(`Dosage: ${rx.freq}   [${rx.duration}]`, 70, startY + 24);

      // Food / Advice
      ctx.fillStyle = '#475569';
      ctx.font = 'italic 13px sans-serif';
      ctx.fillText(`Instructions: ${rx.inst}`, 70, startY + 44);

      // Divider dot line
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(50, startY + 60);
      ctx.lineTo(canvas.width - 50, startY + 60);
      ctx.stroke();

      startY += 82;
    });

    // Special Advice
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('General Advice:', 50, startY + 20);

    ctx.fillStyle = '#64748b';
    ctx.font = '13px sans-serif';
    ctx.fillText('• Complete the antibiotic course without missing doses.', 50, startY + 44);
    ctx.fillText('• Stay well hydrated and maintain 8 hours of sleep.', 50, startY + 66);
    ctx.fillText('• Review in clinic after 5 days if fever persists.', 50, startY + 88);

    // Doctor Signature Box
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 16px cursive';
    ctx.fillText('Dr. Robert Miller', canvas.width - 240, canvas.height - 90);

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(canvas.width - 250, canvas.height - 75);
    ctx.lineTo(canvas.width - 50, canvas.height - 75);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '12px sans-serif';
    ctx.fillText("Doctor's Authorized Signature", canvas.width - 230, canvas.height - 55);

    // Clinic Stamp Simulation
    ctx.save();
    ctx.translate(140, canvas.height - 85);
    ctx.rotate(-0.15);
    ctx.strokeStyle = 'rgba(2, 132, 199, 0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(-80, -25, 160, 50);
    ctx.fillStyle = 'rgba(2, 132, 199, 0.55)';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ST. JUDE CLINIC', 0, -5);
    ctx.font = '10px sans-serif';
    ctx.fillText('VERIFIED PRESCRIPTION', 0, 12);
    ctx.restore();

    return canvas.toDataURL('image/png');
  }
}

// Global Singleton Instance
window.luminaRxParser = new LuminaRxParser();
