/**
 * LuminaMed - AI Clinical Voice Assistant & Natural Language Copilot
 * Enables hands-free scheduling for medication reminders, doctor appointments,
 * schedule queries, and hands-free patient navigation using Web Speech API.
 */

(function(window) {
  'use strict';

  const STOP_WORDS = new Set([
    'tomorrow', 'today', 'yesterday', 'next', 'this', 'on', 'at', 'for', 'in',
    'appointment', 'appointemnet', 'visit', 'checkup', 'consultation',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'am', 'pm', 'morning', 'evening', 'night', 'afternoon', 'with', 'dr', 'doctor',
    'please', 'schedule', 'book', 'add', 'set', 'specific', 'time'
  ]);

  class LuminaVoiceAssistant {
    constructor() {
      this.isOpen = false;
      this.isListening = false;
      this.recognition = null;
      this.supported = false;
      this.lastParsedResult = null;
      this.autoConfirmTimer = null;
      this.autoConfirmCountdown = 0;
      this.speechEnabled = true;

      this.initSpeechRecognition();
    }

    initSpeechRecognition() {
      const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognitionClass) {
        try {
          this.recognition = new SpeechRecognitionClass();
          this.recognition.continuous = false;
          this.recognition.interimResults = true;
          this.recognition.lang = 'en-US';

          this.recognition.onstart = () => {
            this.isListening = true;
            this.updateListeningUI(true);
            this.setStatusText('Listening... Speak your reminder or appointment');
          };

          this.recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
              } else {
                interimTranscript += event.results[i][0].transcript;
              }
            }

            const transcriptEl = document.getElementById('assistantTranscriptText');
            if (transcriptEl) {
              if (finalTranscript) {
                transcriptEl.innerHTML = `&ldquo;<strong>${this.escapeHtml(finalTranscript)}</strong>&rdquo;`;
              } else if (interimTranscript) {
                transcriptEl.innerHTML = `&ldquo;<span class="transcript-interim">${this.escapeHtml(interimTranscript)}</span>&rdquo;`;
              }
            }

            if (finalTranscript) {
              this.processCommand(finalTranscript.trim());
            }
          };

          this.recognition.onerror = (event) => {
            console.warn('Voice Assistant Speech Recognition error:', event.error);
            this.isListening = false;
            this.updateListeningUI(false);

            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
              this.setStatusText('Microphone access blocked. Enable permissions or type your command below.');
            } else if (event.error === 'no-speech') {
              this.setStatusText('No speech detected. Tap the mic and try again.');
            } else {
              this.setStatusText(`Voice error: ${event.error}. You can also type commands below.`);
            }
          };

          this.recognition.onend = () => {
            this.isListening = false;
            this.updateListeningUI(false);
          };

          this.supported = true;
        } catch (e) {
          console.warn('Speech recognition setup failed:', e);
          this.supported = false;
        }
      } else {
        this.supported = false;
      }
    }

    // ------------------------------------------------------------------------
    // UI Modal Management
    // ------------------------------------------------------------------------
    openModal(autoStart = false) {
      this.isOpen = true;
      const modal = document.getElementById('voiceAssistantModal');
      if (modal) {
        modal.style.display = 'flex';
      }

      // Check user voice setting
      if (window.luminaApp && window.luminaApp.settings) {
        this.speechEnabled = window.luminaApp.settings.voiceSpeechEnabled !== false;
      }
      const toggle = document.getElementById('assistantVoiceSpeechToggle');
      if (toggle) toggle.checked = this.speechEnabled;

      this.clearAutoConfirm();
      this.hidePreview();
      
      const transcriptEl = document.getElementById('assistantTranscriptText');
      if (transcriptEl) {
        transcriptEl.innerHTML = `&ldquo;Say: 'Add Paracetamol 500mg reminder at 8:00 PM' or 'Doctor appointment tomorrow at 4:30 PM'...&rdquo;`;
      }

      if (autoStart && this.supported) {
        setTimeout(() => this.startListening(), 300);
      } else if (!this.supported) {
        this.setStatusText('Voice input is not supported in this browser. Use the text input below!');
      } else {
        this.setStatusText('Tap the microphone to speak');
      }

      if (window.lucide) {
        window.lucide.createIcons();
      }
    }

    closeModal() {
      this.isOpen = false;
      this.stopListening();
      this.clearAutoConfirm();
      const modal = document.getElementById('voiceAssistantModal');
      if (modal) {
        modal.style.display = 'none';
      }
    }

    toggleModal() {
      if (this.isOpen) {
        this.closeModal();
      } else {
        this.openModal(true);
      }
    }

    startListening() {
      if (!this.supported || !this.recognition) {
        this.setStatusText('Microphone recognition not available. Type your command below.');
        const input = document.getElementById('assistantManualInput');
        if (input) input.focus();
        return;
      }

      this.clearAutoConfirm();
      this.hidePreview();

      try {
        if (window.luminaApp && window.luminaApp.alarmAudio) {
          window.luminaApp.alarmAudio.playSound('crystalBell');
        }
        this.recognition.start();
      } catch (e) {
        // Recognition might already be running
        console.warn('Speech recognition start note:', e);
      }
    }

    stopListening() {
      if (this.recognition && this.isListening) {
        try {
          this.recognition.stop();
        } catch (e) {}
      }
      this.isListening = false;
      this.updateListeningUI(false);
    }

    toggleListening() {
      if (this.isListening) {
        this.stopListening();
        this.setStatusText('Listening paused. Tap mic to resume.');
      } else {
        this.startListening();
      }
    }

    updateListeningUI(listening) {
      const stage = document.getElementById('assistantStage');
      const micBtn = document.getElementById('assistantMicOrb');
      const soundwaves = document.getElementById('voiceSoundwaves');
      const fab = document.getElementById('floatingVoiceFab');

      if (stage) stage.classList.toggle('is-listening', listening);
      if (micBtn) micBtn.classList.toggle('active', listening);
      if (soundwaves) soundwaves.classList.toggle('active', listening);
      if (fab) fab.classList.toggle('is-listening', listening);

      if (window.lucide) window.lucide.createIcons();
    }

    setStatusText(text) {
      const el = document.getElementById('assistantStatusText');
      if (el) el.textContent = text;
    }

    toggleVoiceResponse(enabled) {
      this.speechEnabled = Boolean(enabled);
      if (window.luminaApp && window.luminaApp.settings) {
        window.luminaApp.settings.voiceSpeechEnabled = this.speechEnabled;
        window.luminaApp.saveSettings();
      }
    }

    speak(text) {
      if (!this.speechEnabled || !text) return;
      if (window.luminaApp && window.luminaApp.alarmAudio) {
        window.luminaApp.alarmAudio.speak(text);
      } else if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(text);
          utter.rate = 0.95;
          window.speechSynthesis.speak(utter);
        } catch (e) {}
      }
    }

    // ------------------------------------------------------------------------
    // Command Parser & Execution
    // ------------------------------------------------------------------------
    processCommand(text) {
      if (!text || !text.trim()) return;

      this.setStatusText('Processing your request...');
      const parsed = this.parseCommand(text);

      if (!parsed) {
        this.setStatusText('Could not understand command. Please try again.');
        this.speak("Sorry, I could not understand that. You can say: Add medicine reminder, or: Doctor appointment.");
        return;
      }

      this.lastParsedResult = parsed;

      // Check intent
      if (parsed.intent === 'QUERY_SCHEDULE') {
        this.handleScheduleQuery();
      } else if (parsed.intent === 'NAVIGATE') {
        this.handleNavigation(parsed.tab);
      } else {
        this.showPreview(parsed);
      }
    }

    handleFormSubmit(e) {
      if (e) e.preventDefault();
      const input = document.getElementById('assistantManualInput');
      if (!input || !input.value.trim()) return;

      const cmd = input.value.trim();
      input.value = '';

      const transcriptEl = document.getElementById('assistantTranscriptText');
      if (transcriptEl) {
        transcriptEl.innerHTML = `&ldquo;<strong>${this.escapeHtml(cmd)}</strong>&rdquo;`;
      }

      this.processCommand(cmd);
    }

    simulateCommand(text) {
      const transcriptEl = document.getElementById('assistantTranscriptText');
      if (transcriptEl) {
        transcriptEl.innerHTML = `&ldquo;<strong>${this.escapeHtml(text)}</strong>&rdquo;`;
      }
      this.processCommand(text);
    }

    parseCommand(rawText) {
      if (!rawText) return null;
      const text = rawText.trim();
      const lower = text.toLowerCase();

      // 1. Check Query Schedule intent
      if (/\b(what are my|what is my|show my|check my|today'?s? schedule|today'?s? medicines?|today'?s? reminders?|my pills today)\b/i.test(lower)) {
        return { intent: 'QUERY_SCHEDULE', raw: text };
      }

      // 2. Check Navigation intent
      if (/\b(go to|open|switch to|view)\s+(dashboard|today|schedule|medications|medicines|vitals|health|appointments|calendar)\b/i.test(lower)) {
        let tab = 'tab-dashboard';
        if (/today|schedule/i.test(lower)) tab = 'tab-today';
        else if (/med/i.test(lower)) tab = 'tab-medications';
        else if (/vital|health/i.test(lower)) tab = 'tab-vitals';
        else if (/appoint|calendar/i.test(lower)) tab = 'tab-appointments';
        return { intent: 'NAVIGATE', tab, raw: text };
      }

      // 3. Check Appointment intent
      const isAppointment = /\b(appointment|appointemnet|doctor|dr\b|dr\.|clinic|consultation|checkup|dentist|cardiologist|physician|hospital visit|follow-up|telehealth)\b/i.test(lower);

      if (isAppointment) {
        return this.parseAppointment(text);
      } else {
        return this.parseMedicine(text);
      }
    }

    parseTime(str) {
      // 12-hour match: 8:00 PM, 8pm, 8:30 am, 10 am, 4:30 p.m.
      const match12 = str.match(/\b(0?[1-9]|1[0-2])(?::([0-5][0-9]))?\s*(am|pm|a\.m\.|p\.m\.)\b/i);
      if (match12) {
        let hour = parseInt(match12[1], 10);
        const min = match12[2] ? match12[2] : '00';
        const meridiem = match12[3].toLowerCase().replace(/\./g, '');
        if (meridiem === 'pm' && hour < 12) hour += 12;
        if (meridiem === 'am' && hour === 12) hour = 0;
        return String(hour).padStart(2, '0') + ':' + min;
      }

      // 24-hour match: 14:30, 08:00, 20:00
      const match24 = str.match(/\b([01]?[0-9]|2[0-3]):([0-5][0-9])\b/);
      if (match24) {
        return String(match24[1]).padStart(2, '0') + ':' + match24[2];
      }

      // "at 8" or "at 11" optionally with "o'clock"
      const matchAt = str.match(/\bat\s+([1-9]|1[0-2])(?:\s+o'?clock)?\b/i);
      if (matchAt) {
        let hour = parseInt(matchAt[1], 10);
        if (/night|evening|dinner|pm/i.test(str) && hour < 12) hour += 12;
        return String(hour).padStart(2, '0') + ':00';
      }

      // Descriptive times
      if (/\b(?:morning|breakfast)\b/i.test(str)) return '08:00';
      if (/\b(?:noon|lunch)\b/i.test(str)) return '12:30';
      if (/\b(?:afternoon)\b/i.test(str)) return '14:00';
      if (/\b(?:evening)\b/i.test(str)) return '18:00';
      if (/\b(?:night|bedtime|dinner)\b/i.test(str)) return '20:30';

      return '09:00';
    }

    parseAllTimes(str) {
      const times = [];
      const regex12 = /\b(0?[1-9]|1[0-2])(?::([0-5][0-9]))?\s*(am|pm|a\.m\.|p\.m\.)\b/gi;
      let match;
      while ((match = regex12.exec(str)) !== null) {
        let hour = parseInt(match[1], 10);
        const min = match[2] ? match[2] : '00';
        const meridiem = match[3].toLowerCase().replace(/\./g, '');
        if (meridiem === 'pm' && hour < 12) hour += 12;
        if (meridiem === 'am' && hour === 12) hour = 0;
        const formatted = String(hour).padStart(2, '0') + ':' + min;
        if (!times.includes(formatted)) times.push(formatted);
      }

      if (times.length === 0) {
        times.push(this.parseTime(str));
      }
      return times;
    }

    parseDate(str) {
      const now = new Date();
      const lower = str.toLowerCase();

      if (lower.includes('today')) {
        return now.toISOString().split('T')[0];
      }
      if (lower.includes('day after tomorrow')) {
        const d = new Date();
        d.setDate(d.getDate() + 2);
        return d.toISOString().split('T')[0];
      }
      if (lower.includes('tomorrow')) {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d.toISOString().split('T')[0];
      }

      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      for (let i = 0; i < days.length; i++) {
        if (lower.includes(days[i])) {
          const todayDay = now.getDay();
          let diff = i - todayDay;
          if (diff <= 0) diff += 7; // next occurrence
          const d = new Date();
          d.setDate(d.getDate() + diff);
          return d.toISOString().split('T')[0];
        }
      }

      const isoMatch = str.match(/\b\d{4}-\d{2}-\d{2}\b/);
      if (isoMatch) return isoMatch[0];

      // Default date: tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
    }

    extractDoctorName(raw) {
      const patientDoc = window.luminaApp?.patientProfile?.doctorName || 'Dr. Specialist';

      // 1. Look for explicit "with Dr. Name" or "with Doctor Name"
      const withMatch = raw.match(/\bwith\s+(?:dr\.?|doctor\s+)?([a-zA-Z]+(?:\s+[a-zA-Z]+)*)/i);
      if (withMatch) {
        const rawWords = withMatch[1].trim().split(/\s+/);
        const validWords = [];
        for (const w of rawWords) {
          if (STOP_WORDS.has(w.toLowerCase())) break;
          validWords.push(w);
        }
        if (validWords.length > 0) {
          return 'Dr. ' + validWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        }
      }

      // 2. Look for "Dr. [Name]" anywhere in text
      const drMatch = raw.match(/\bdr\.?\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*)/i);
      if (drMatch) {
        const rawWords = drMatch[1].trim().split(/\s+/);
        const validWords = [];
        for (const w of rawWords) {
          if (STOP_WORDS.has(w.toLowerCase())) break;
          validWords.push(w);
        }
        if (validWords.length > 0) {
          return 'Dr. ' + validWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        }
      }

      return patientDoc;
    }

    parseAppointment(raw) {
      const time = this.parseTime(raw);
      const date = this.parseDate(raw);
      const doctorName = this.extractDoctorName(raw);

      // Specialty
      let specialty = 'General Medicine';
      if (/cardio/i.test(raw)) specialty = 'Cardiology';
      else if (/dent/i.test(raw)) specialty = 'Dentistry';
      else if (/derma/i.test(raw)) specialty = 'Dermatology';
      else if (/neuro/i.test(raw)) specialty = 'Neurology';
      else if (/ortho/i.test(raw)) specialty = 'Orthopedics';
      else if (/pediat/i.test(raw)) specialty = 'Pediatrics';
      else if (/eye|ophthalm/i.test(raw)) specialty = 'Ophthalmology';

      // Format
      let format = 'In-Person Visit';
      if (/telehealth|video|online|virtual/i.test(raw)) {
        format = 'Telehealth Video';
      } else if (/blood test|lab|fasting/i.test(raw)) {
        format = 'Lab Blood Test';
      }

      // Clinic
      let clinic = window.luminaApp?.patientProfile?.doctorHospital || 'City Healthcare Clinic';
      const clinicMatch = raw.match(/\bat\s+([A-Za-z\s]+(?:Hospital|Clinic|Center|Care))\b/i);
      if (clinicMatch) {
        clinic = clinicMatch[1].trim();
      }

      let notes = 'Scheduled via Voice Assistant';
      if (/blood test/i.test(raw)) notes = 'Fasting blood test & diagnostic panel';
      else if (/checkup|review/i.test(raw)) notes = 'Routine consultation & vitals check';

      return {
        intent: 'APPOINTMENT',
        doctorName,
        specialty,
        clinic,
        format,
        date,
        time,
        notes,
        raw
      };
    }

    parseMedicine(raw) {
      let cleaned = raw;

      // Extract dosage
      let dosage = '1 tablet';
      const dosageMatch = cleaned.match(/\b(\d+(?:\.\d+)?\s*(?:mg|g|mcg|ml|tablets?|pills?|capsules?|drops?|puffs?|units?))\b/i);
      if (dosageMatch) {
        dosage = dosageMatch[1].toLowerCase();
        cleaned = cleaned.replace(dosageMatch[0], ' ');
      }

      // Extract times
      const times = this.parseAllTimes(raw);

      // Food instruction
      let foodInstruction = 'After food';
      if (/\bbefore (?:food|meals?|eating|breakfast|lunch|dinner)|empty stomach\b/i.test(raw)) {
        foodInstruction = 'Before food';
      } else if (/\bwith (?:food|meals?|breakfast|lunch|dinner)\b/i.test(raw)) {
        foodInstruction = 'With food';
      } else if (/\bany time|doesn'?t matter\b/i.test(raw)) {
        foodInstruction = 'Any time';
      }

      // Type
      let type = 'tablet';
      if (/capsule/i.test(raw) || /capsules/i.test(dosage)) type = 'capsule';
      else if (/syrup|liquid/i.test(raw) || /ml/i.test(dosage)) type = 'syrup';
      else if (/injection|shot/i.test(raw)) type = 'injection';
      else if (/drops?/i.test(raw) || /drops?/i.test(dosage)) type = 'drops';
      else if (/inhaler|puff/i.test(raw) || /puffs?/i.test(dosage)) type = 'inhaler';

      // Clean string to isolate medicine name
      cleaned = cleaned
        .replace(/\b(add this medicine reminder|add a medicine reminder|add medicine reminder|add this reminder|add reminder for|add reminder|remind me to take|set a reminder for|set reminder for|please remind me to take|add medicine|add med|take)\b/gi, '')
        .replace(/\b(at this specific time|at specific time|at time|at|every day|daily|in the morning|in the evening|at night|today|tomorrow|with water|after food|before food|with food|after meals?|before meals?|with meals?)\b/gi, '')
        .replace(/\b(0?[1-9]|1[0-2])(?::([0-5][0-9]))?\s*(am|pm|a\.m\.|p\.m\.)\b/gi, '')
        .replace(/\b([01]?[0-9]|2[0-3]):([0-5][0-9])\b/g, '')
        .replace(/[^a-zA-Z0-9\s-]/g, ' ')
        .trim();

      const words = cleaned.split(/\s+/).filter(w => w.length > 1 && !/^(for|to|of|the|a|an|and|is|this|my|reminder|reminders)$/i.test(w));
      let name = words.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

      if (!name) {
        name = 'Daily Medication';
      }

      return {
        intent: 'MEDICINE',
        name,
        dosage,
        type,
        color: 'teal',
        times,
        foodInstruction,
        dietaryWarnings: [],
        currentStock: 30,
        lowStockThreshold: 5,
        notes: 'Added via Voice Assistant',
        raw
      };
    }

    // ------------------------------------------------------------------------
    // Action Confirmation & Schedule Handlers
    // ------------------------------------------------------------------------
    showPreview(parsed) {
      const card = document.getElementById('assistantPreviewCard');
      const badgeText = document.getElementById('previewBadgeText');
      const badgeIcon = document.getElementById('previewBadgeIcon');
      const grid = document.getElementById('previewDetailsGrid');

      if (!card || !grid) return;

      if (parsed.intent === 'MEDICINE') {
        if (badgeText) badgeText.textContent = 'Medication Reminder Detected';
        if (badgeIcon) badgeIcon.setAttribute('data-lucide', 'pill');

        const formattedTimes = parsed.times.map(t => this.formatDisplayTime(t)).join(', ');
        grid.innerHTML = `
          <div class="preview-item">
            <span class="preview-lbl">Medicine Name</span>
            <span class="preview-val preview-highlight">${this.escapeHtml(parsed.name)}</span>
          </div>
          <div class="preview-item">
            <span class="preview-lbl">Dosage & Type</span>
            <span class="preview-val">${this.escapeHtml(parsed.dosage)} &bull; ${parsed.type.toUpperCase()}</span>
          </div>
          <div class="preview-item">
            <span class="preview-lbl">Alarm Trigger Time(s)</span>
            <span class="preview-val preview-time">${formattedTimes}</span>
          </div>
          <div class="preview-item">
            <span class="preview-lbl">Food Direction</span>
            <span class="preview-val">${parsed.foodInstruction}</span>
          </div>
        `;

        this.setStatusText(`Ready to schedule reminder for ${parsed.name} at ${formattedTimes}.`);
        this.speak(`I understood: Add reminder for ${parsed.name}, dosage ${parsed.dosage}, at ${formattedTimes}. Confirming now.`);
      } else if (parsed.intent === 'APPOINTMENT') {
        if (badgeText) badgeText.textContent = 'Doctor Appointment Detected';
        if (badgeIcon) badgeIcon.setAttribute('data-lucide', 'calendar');

        const displayTime = this.formatDisplayTime(parsed.time);
        grid.innerHTML = `
          <div class="preview-item">
            <span class="preview-lbl">Physician / Doctor</span>
            <span class="preview-val preview-highlight">${this.escapeHtml(parsed.doctorName)}</span>
          </div>
          <div class="preview-item">
            <span class="preview-lbl">Specialty & Format</span>
            <span class="preview-val">${parsed.specialty} &bull; ${parsed.format}</span>
          </div>
          <div class="preview-item">
            <span class="preview-lbl">Date & Time</span>
            <span class="preview-val preview-time">${parsed.date} at ${displayTime}</span>
          </div>
          <div class="preview-item">
            <span class="preview-lbl">Hospital / Clinic</span>
            <span class="preview-val">${this.escapeHtml(parsed.clinic)}</span>
          </div>
        `;

        this.setStatusText(`Ready to schedule appointment with ${parsed.doctorName} on ${parsed.date} at ${displayTime}.`);
        this.speak(`I understood: Appointment with ${parsed.doctorName} on ${parsed.date} at ${displayTime}. Confirming now.`);
      }

      card.style.display = 'block';
      if (window.lucide) window.lucide.createIcons();

      // Start 5-second auto-confirmation countdown for hands-free convenience
      this.startAutoConfirm();
    }

    startAutoConfirm() {
      this.clearAutoConfirm();
      this.autoConfirmCountdown = 5;
      const btn = document.getElementById('previewConfirmBtn');

      const updateBtn = () => {
        if (btn) {
          btn.innerHTML = `<i data-lucide="check-circle"></i> <span>Confirm & Schedule (${this.autoConfirmCountdown}s)</span>`;
          if (window.lucide) window.lucide.createIcons();
        }
      };

      updateBtn();
      this.autoConfirmTimer = setInterval(() => {
        this.autoConfirmCountdown--;
        if (this.autoConfirmCountdown <= 0) {
          this.clearAutoConfirm();
          this.confirmAction();
        } else {
          updateBtn();
        }
      }, 1000);
    }

    clearAutoConfirm() {
      if (this.autoConfirmTimer) {
        clearInterval(this.autoConfirmTimer);
        this.autoConfirmTimer = null;
      }
      const btn = document.getElementById('previewConfirmBtn');
      if (btn) {
        btn.innerHTML = `<i data-lucide="check-circle"></i> <span>Confirm & Schedule</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }

    hidePreview() {
      this.clearAutoConfirm();
      const card = document.getElementById('assistantPreviewCard');
      if (card) card.style.display = 'none';
      this.lastParsedResult = null;
    }

    cancelPreview() {
      this.hidePreview();
      this.setStatusText('Command canceled. Tap mic to try again.');
    }

    confirmAction() {
      this.clearAutoConfirm();
      const parsed = this.lastParsedResult;
      if (!parsed) return;

      if (parsed.intent === 'MEDICINE') {
        this.executeMedicineAdd(parsed);
      } else if (parsed.intent === 'APPOINTMENT') {
        this.executeAppointmentAdd(parsed);
      }

      this.hidePreview();
      setTimeout(() => this.closeModal(), 800);
    }

    executeMedicineAdd(parsed) {
      if (!window.luminaApp) return;

      const app = window.luminaApp;
      const newMed = {
        id: 'med_' + Date.now(),
        name: parsed.name,
        dosage: parsed.dosage,
        type: parsed.type,
        color: parsed.color || 'teal',
        times: parsed.times,
        foodInstruction: parsed.foodInstruction,
        dietaryWarnings: parsed.dietaryWarnings || [],
        currentStock: parsed.currentStock || 30,
        lowStockThreshold: parsed.lowStockThreshold || 5,
        notes: parsed.notes || 'Added via Voice Assistant',
        createdAt: new Date().toISOString()
      };

      app.medications.push(newMed);
      app.saveMedications();
      app.render();

      const timeText = parsed.times.map(t => this.formatDisplayTime(t)).join(', ');
      app.showToast(
        'Medicine Reminder Added! 💊',
        `${parsed.name} (${parsed.dosage}) set for ${timeText}.`,
        'success'
      );

      this.speak(`Successfully scheduled ${parsed.name} reminder for ${timeText}.`);

      // Check drug interactions
      if (window.LuminaInteractions) {
        const conflicts = window.LuminaInteractions.checkNewAgainstCabinet(parsed.name, app.medications, newMed.id);
        if (conflicts.length > 0) {
          setTimeout(() => {
            app.showToast('⚠️ Drug Safety Alert', `Potential interaction with ${conflicts[0].otherMed.name}. Check Drug Safety Hub.`, 'warning');
          }, 1400);
        }
      }

      // Switch to Medications tab so patient immediately sees their new medicine
      app.switchTab('tab-medications');
    }

    executeAppointmentAdd(parsed) {
      if (!window.luminaApp) return;

      const app = window.luminaApp;
      const newAppt = {
        id: 'appt_' + Date.now(),
        doctorName: parsed.doctorName,
        specialty: parsed.specialty,
        clinic: parsed.clinic,
        format: parsed.format,
        date: parsed.date,
        time: parsed.time,
        phone: '',
        notes: parsed.notes,
        status: 'confirmed'
      };

      app.appointments.push(newAppt);
      app.saveAppointments();
      app.render();

      const displayTime = this.formatDisplayTime(parsed.time);
      app.showToast(
        'Appointment Scheduled! 📅',
        `Visit with ${parsed.doctorName} confirmed for ${parsed.date} at ${displayTime}.`,
        'success'
      );

      this.speak(`Successfully scheduled doctor appointment with ${parsed.doctorName} on ${parsed.date} at ${displayTime}.`);

      // Switch to Appointments tab
      app.switchTab('tab-appointments');
    }

    editInForm() {
      this.clearAutoConfirm();
      const parsed = this.lastParsedResult;
      if (!parsed || !window.luminaApp) return;

      this.closeModal();

      if (parsed.intent === 'MEDICINE') {
        window.luminaApp.openMedModal({
          id: '',
          name: parsed.name,
          dosage: parsed.dosage,
          type: parsed.type,
          color: parsed.color,
          times: parsed.times,
          foodInstruction: parsed.foodInstruction,
          currentStock: parsed.currentStock,
          lowStockThreshold: parsed.lowStockThreshold,
          notes: parsed.notes
        });
      } else if (parsed.intent === 'APPOINTMENT') {
        window.luminaApp.openAppointmentModal({
          id: '',
          doctorName: parsed.doctorName,
          specialty: parsed.specialty,
          clinic: parsed.clinic,
          format: parsed.format,
          date: parsed.date,
          time: parsed.time,
          phone: '',
          notes: parsed.notes
        });
      }
    }

    handleScheduleQuery() {
      if (!window.luminaApp) return;
      const app = window.luminaApp;
      app.switchTab('tab-today');

      const medCount = app.medications ? app.medications.length : 0;
      if (medCount === 0) {
        const msg = "You have no active medications in your schedule. You can say: Add medicine reminder to create one.";
        this.setStatusText(msg);
        this.speak(msg);
      } else {
        const medNames = app.medications.map(m => m.name).slice(0, 4).join(', ');
        const msg = `You have ${medCount} medicine reminders active, including ${medNames}. Showing your schedule now.`;
        this.setStatusText(msg);
        this.speak(msg);
      }

      setTimeout(() => this.closeModal(), 1800);
    }

    handleNavigation(tabId) {
      if (!window.luminaApp) return;
      window.luminaApp.switchTab(tabId);
      const tabNames = {
        'tab-dashboard': 'Dashboard',
        'tab-today': "Today's Schedule",
        'tab-medications': 'Medicines & Stock',
        'tab-vitals': 'Health Checker',
        'tab-appointments': 'Appointments & Refills'
      };
      const title = tabNames[tabId] || 'Requested Page';
      const msg = `Navigated to ${title}.`;
      this.setStatusText(msg);
      this.speak(msg);
      setTimeout(() => this.closeModal(), 1200);
    }

    formatDisplayTime(time24) {
      if (!time24) return '12:00 PM';
      const parts = time24.split(':');
      let hour = parseInt(parts[0], 10);
      const minute = parts[1] || '00';
      const ampm = hour >= 12 ? 'PM' : 'AM';
      hour = hour % 12;
      if (hour === 0) hour = 12;
      return `${hour}:${minute} ${ampm}`;
    }

    escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  }

  // Global helper instantiation
  window.LuminaVoiceAssistant = LuminaVoiceAssistant;

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    window.luminaAssistant = new LuminaVoiceAssistant();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      window.luminaAssistant = new LuminaVoiceAssistant();
    });
  }

  // Global keyboard shortcut: Alt + V to toggle Voice Assistant
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      if (window.luminaAssistant) {
        window.luminaAssistant.toggleModal();
      }
    }
  });

})(window);

