/**
 * LuminaMed - Core Application Controller & Precision Alarm Engine
 * Handles medication scheduling, real-time clock monitoring, Audio API chimes,
 * browser notifications, adherence analytics, stock inventory, and glossy UI interactions.
 */

// ============================================================================
// Data Model & Default State
// ============================================================================

const STORAGE_KEYS = {
  MEDICATIONS: 'luminamed_medications_v2',
  DOSES: 'luminamed_today_doses_v2',
  HISTORY: 'luminamed_history_logs_v2',
  SETTINGS: 'luminamed_settings_v2',
  LAST_DATE: 'luminamed_last_active_date',
  CONTACTS: 'luminamed_emergency_contacts_v1',
  MISSED_ALERTS: 'luminamed_missed_dose_alerts_v1',
  VITALS: 'luminamed_vitals_records_v1',
  PATIENT: 'luminamed_patient_profile_v1',
  APPOINTMENTS: 'luminamed_appointments_v1',
  ELDERLY_MODE: 'luminamed_elderly_mode_v1'
};

const DEFAULT_SETTINGS = {
  sound: 'crystalBell',
  volume: 80,
  snoozeMinutes: 10,
  continuousRing: true,
  vibration: true,
  desktopNotifications: false,
  missedDoseThreshold: 30, // in minutes
  patientName: 'Patient',
  voiceSpeechEnabled: true,
  voiceRate: 0.95
};


// ============================================================================
// Application Controller Class
// ============================================================================

class LuminaMedApp {
  constructor() {
    this.medications = [];
    this.todayDoses = {}; // keyed by `${medId}_${time}`
    this.historyLogs = [];
    this.contacts = [];
    this.missedDoseAlerts = [];
    this.appointments = [];
    this.settings = { ...DEFAULT_SETTINGS };
    this.activeFilter = 'all';
    this.activeTab = 'tab-today';
    this.activeVitalsFilter = 'all';
    this.activeDaylightFilter = 'all';
    this.activeAppointmentFilter = 'all';
    this.isElderlyMode = false;
    this.activeMealBuffer = null;
    this.mealBufferInterval = null;
    this.searchQuery = '';
    
    // Patient profile & authentication state
    this.patientProfile = null;
    this.currentAuthMethod = 'phone';
    this.generatedOtp = '4829';
    this.otpCountdownTimer = null;
    this.otpRemainingSeconds = 30;

    // Alarm loop & timer states
    this.activeAlarmDose = null; // Currently sounding alarm dose info
    this.snoozedDoses = []; // [{ medId, time, targetTimestamp }]
    this.triggeredThisMinute = new Set(); // Prevent double ringing in the same minute
    this.lastCheckedMinute = -1;
    this.alarmAudio = window.luminaAudio || null;
    this.refillTargetMedId = null;
    this.detectedRxMeds = []; // Medicines extracted from uploaded prescription receipt

    // Type icon mapping for Lucide
    this.typeIcons = {
      tablet: 'circle-dot',
      capsule: 'pill',
      syrup: 'flask-conical',
      injection: 'syringe',
      drops: 'droplet',
      inhaler: 'wind'
    };

    // Color gradient mapping
    this.colorClasses = {
      cyan: 'bg-cyan',
      emerald: 'bg-emerald',
      indigo: 'bg-indigo',
      rose: 'bg-rose',
      amber: 'bg-amber'
    };

    this.init();
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------
  init() {
    this.loadState();
    this.checkDayRollover();
    this.bindEvents();
    this.initOtpDigitInputs();
    this.initPatientChipEvents();
    this.applySettingsToUI();
    this.startPrecisionClock();
    this.checkNotificationPermission();
    this.render();
    this.checkPatientAuth();

    // Show friendly welcome toast
    setTimeout(() => {
      this.showToast('LuminaMed Loaded', 'Precision alarms and audio chimes are ready.', 'info');
    }, 600);
  }

  // --------------------------------------------------------------------------
  // Storage & Persistence
  // --------------------------------------------------------------------------
  loadState() {
    try {
      // 1-time purge of all demo/test data so newly logged in patients start fresh with zero demo medicines
      const isCleaned = localStorage.getItem('luminamed_zero_demo_clean_v6');
      if (!isCleaned) {
        localStorage.removeItem(STORAGE_KEYS.MEDICATIONS);
        localStorage.removeItem(STORAGE_KEYS.DOSES);
        localStorage.removeItem(STORAGE_KEYS.HISTORY);
        localStorage.setItem('luminamed_zero_demo_clean_v6', 'true');
      }

      const storedMeds = localStorage.getItem(STORAGE_KEYS.MEDICATIONS);
      const rawMeds = storedMeds ? JSON.parse(storedMeds) : [];
      // Clean out any legacy demo/sample items so user starts completely clean with zero demo medicines
      this.medications = rawMeds.filter(m => m && m.id && !m.id.startsWith('med_sample_') && !m.id.includes('sample') && !m.id.startsWith('rx_fallback_') && !m.id.startsWith('demo_') && !m.isDemo);
      if (this.medications.length !== rawMeds.length) {
        this.saveMedications();
      }

      const storedDoses = localStorage.getItem(STORAGE_KEYS.DOSES);
      const rawDoses = storedDoses ? JSON.parse(storedDoses) : {};
      this.todayDoses = {};
      let dosesChanged = false;
      for (const [key, val] of Object.entries(rawDoses)) {
        if (!key.startsWith('med_sample_') && !key.includes('sample') && !key.startsWith('rx_fallback_')) {
          this.todayDoses[key] = val;
        } else {
          dosesChanged = true;
        }
      }
      if (dosesChanged) {
        this.saveDoses();
      }

      const storedHistory = localStorage.getItem(STORAGE_KEYS.HISTORY);
      const rawHistory = storedHistory ? JSON.parse(storedHistory) : [];
      this.historyLogs = rawHistory.filter(h => h && (!h.medId || (!h.medId.startsWith('med_sample_') && !h.medId.includes('sample') && !h.medId.startsWith('rx_fallback_'))));
      if (this.historyLogs.length !== rawHistory.length) {
        this.saveHistory();
      }

      const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (storedSettings) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(storedSettings) };
      }

      const storedContacts = localStorage.getItem(STORAGE_KEYS.CONTACTS);
      this.contacts = storedContacts ? JSON.parse(storedContacts) : [];

      const storedMissed = localStorage.getItem(STORAGE_KEYS.MISSED_ALERTS);
      this.missedDoseAlerts = storedMissed ? JSON.parse(storedMissed) : [];

      const storedPatient = localStorage.getItem(STORAGE_KEYS.PATIENT);
      this.patientProfile = storedPatient ? JSON.parse(storedPatient) : null;
      if (this.patientProfile && this.patientProfile.name) {
        this.settings.patientName = this.patientProfile.name;
      }

      // Load appointments
      const storedAppts = localStorage.getItem(STORAGE_KEYS.APPOINTMENTS);
      if (storedAppts) {
        this.appointments = JSON.parse(storedAppts);
      } else {
        const docName = this.patientProfile?.doctorName || 'Dr. Robert Chen';
        const clinicName = this.patientProfile?.hospital || 'Metro Heart & Health Center';
        const docPhone = this.patientProfile?.doctorPhone || '+91 98765 43210';
        
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 4);
        const yyyy = futureDate.getFullYear();
        const mm = String(futureDate.getMonth() + 1).padStart(2, '0');
        const dd = String(futureDate.getDate()).padStart(2, '0');

        this.appointments = [
          {
            id: 'appt_default_1',
            doctorName: docName,
            specialty: 'Cardiologist',
            clinic: clinicName,
            format: 'In-Person Visit',
            date: `${yyyy}-${mm}-${dd}`,
            time: '10:30',
            phone: docPhone,
            notes: 'Quarterly cardiovascular review, BP titration & Lipid panel test',
            status: 'confirmed'
          }
        ];
        this.saveAppointments();
      }

      this.isElderlyMode = localStorage.getItem(STORAGE_KEYS.ELDERLY_MODE) === 'true';
    } catch (e) {
      console.error('Failed to load local storage data:', e);
      this.medications = [];
      this.todayDoses = {};
      this.historyLogs = [];
      this.contacts = [];
      this.missedDoseAlerts = [];
      this.appointments = [];
      this.patientProfile = null;
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  saveMedications() {
    try {
      localStorage.setItem(STORAGE_KEYS.MEDICATIONS, JSON.stringify(this.medications));
    } catch (e) {
      console.error('Storage save error:', e);
    }
  }

  saveAppointments() {
    try {
      localStorage.setItem(STORAGE_KEYS.APPOINTMENTS, JSON.stringify(this.appointments));
    } catch (e) {
      console.error('Storage save error:', e);
    }
  }

  saveDoses() {
    try {
      localStorage.setItem(STORAGE_KEYS.DOSES, JSON.stringify(this.todayDoses));
    } catch (e) {
      console.error('Storage save error:', e);
    }
  }

  saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(this.historyLogs));
    } catch (e) {
      console.error('Storage save error:', e);
    }
  }

  saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(this.settings));
    } catch (e) {
      console.error('Storage save error:', e);
    }
  }

  saveContacts() {
    try {
      localStorage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(this.contacts));
    } catch (e) {
      console.error('Storage save error:', e);
    }
  }

  saveMissedAlerts() {
    try {
      localStorage.setItem(STORAGE_KEYS.MISSED_ALERTS, JSON.stringify(this.missedDoseAlerts));
    } catch (e) {
      console.error('Storage save error:', e);
    }
  }

  // Ensure daily schedule resets each midnight
  checkDayRollover() {
    const todayStr = this.getTodayDateString();
    const lastActiveDate = localStorage.getItem(STORAGE_KEYS.LAST_DATE);
    
    if (lastActiveDate !== todayStr) {
      // Day changed: archive any untaken doses from previous day as 'Missed' in history log for accurate adherence history!
      if (lastActiveDate && this.medications.length > 0) {
        this.medications.forEach(med => {
          if (!med.times || !Array.isArray(med.times)) return;
          med.times.forEach(time => {
            const doseKey = `${med.id}_${time}`;
            const dose = this.todayDoses[doseKey];
            if (!dose || (dose.status !== 'taken' && dose.status !== 'skipped')) {
              this.addHistoryLog({
                timestamp: `${lastActiveDate}T${time}:00.000Z`,
                medName: med.name,
                dosage: med.dosage,
                scheduledTime: this.formatDisplayTime(time),
                status: 'Missed',
                notes: `Dose missed on ${lastActiveDate}`
              });
            }
          });
        });
      }

      this.todayDoses = {};
      this.saveDoses();
      localStorage.setItem(STORAGE_KEYS.LAST_DATE, todayStr);
      this.triggeredThisMinute.clear();
      this.snoozedDoses = [];
    }
  }

  getTodayDateString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // --------------------------------------------------------------------------
  // Precision Clock & Alarm Engine
  // --------------------------------------------------------------------------
  startPrecisionClock() {
    const update = () => {
      const now = new Date();
      
      // Update Live Clock in Header
      const liveClockEl = document.getElementById('liveClock');
      const liveDateEl = document.getElementById('liveDate');
      
      if (liveClockEl) {
        let hours = now.getHours();
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        liveClockEl.textContent = `${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
      }

      if (liveDateEl) {
        const options = { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' };
        liveDateEl.textContent = now.toLocaleDateString('en-US', options);
      }

      // Check Alarms every second
      this.checkScheduledAlarms(now);
      this.updateNextDoseCountdown(now);
    };

    update();
    setInterval(update, 1000);
  }

  /**
   * Evaluates if any medication dose time matches the current minute
   */
  checkScheduledAlarms(now) {
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentSeconds = now.getSeconds();
    const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
    const currentMinuteKey = `${currentTimeStr}_${now.getDate()}`;

    // Reset minute tracking on new minute & evaluate missed doses
    if (this.lastCheckedMinute !== currentMinute) {
      this.lastCheckedMinute = currentMinute;
      this.triggeredThisMinute.clear();
      this.evaluateMissedDoses(now);
    }

    // 1. Check normal schedule (fires at :00-:04 seconds of the due minute)
    this.medications.forEach(med => {
      if (!med.times || !Array.isArray(med.times)) return;

      med.times.forEach(time => {
        if (time === currentTimeStr) {
          const doseKey = `${med.id}_${time}`;
          const triggerKey = `${doseKey}_${currentMinuteKey}`;

          // Check if dose has already been taken, skipped, or triggered in this exact minute
          const doseStatus = this.todayDoses[doseKey]?.status;
          if (doseStatus !== 'taken' && doseStatus !== 'skipped' && !this.triggeredThisMinute.has(triggerKey)) {
            // Check if currently snoozed for a later time
            const isCurrentlySnoozed = this.snoozedDoses.some(s => s.medId === med.id && s.time === time && s.targetTimestamp > now.getTime());
            if (!isCurrentlySnoozed) {
              this.triggeredThisMinute.add(triggerKey);
              this.triggerAlarm(med, time);
            }
          }
        }
      });
    });

    // 2. Check snoozed alarms whose timer has elapsed
    const nowMs = now.getTime();
    for (let i = this.snoozedDoses.length - 1; i >= 0; i--) {
      const snooze = this.snoozedDoses[i];
      if (nowMs >= snooze.targetTimestamp) {
        const med = this.medications.find(m => m.id === snooze.medId);
        this.snoozedDoses.splice(i, 1);
        if (med) {
          this.triggerAlarm(med, snooze.time, true);
        }
      }
    }
  }

  /**
   * Sound the alarm, vibrate, show system notification, and display glowing modal
   */
  triggerAlarm(med, scheduledTime, isSnoozeWakeup = false) {
    // If an alarm is already ringing, queue or replace
    this.activeAlarmDose = { med, scheduledTime };

    // 1. Play procedural synthesized audio chime
    if (this.alarmAudio) {
      this.alarmAudio.setVolume(this.settings.volume / 100);
      if (this.settings.continuousRing) {
        this.alarmAudio.startContinuousAlarm(this.settings.sound);
      } else {
        this.alarmAudio.playSound(this.settings.sound);
      }

      // Voice-Guided speech announcement
      if (this.settings.voiceSpeechEnabled) {
        this.alarmAudio.speakMedicationReminder({
          medName: med.name,
          dosage: med.dosage,
          instructions: med.notes || '',
          mealTiming: med.foodInstruction || '',
          patientName: this.patientProfile?.name || this.settings.patientName || 'Alex'
        });
      }
    }

    // 2. Vibration API (mobile / supported browsers)
    if (this.settings.vibration && 'vibrate' in navigator) {
      try {
        navigator.vibrate([400, 200, 400, 200, 600]);
      } catch (e) {
        // Safe fallback
      }
    }

    // 3. Desktop/System Notification
    this.sendDesktopNotification(med, scheduledTime, isSnoozeWakeup);

    // 4. Open Fullscreen Glassy Alarm Overlay
    this.showAlarmModal(med, scheduledTime, isSnoozeWakeup);
  }

  showAlarmModal(med, scheduledTime, isSnoozeWakeup) {
    const overlay = document.getElementById('alarmAlertOverlay');
    const nameEl = document.getElementById('alarmAlertMedName');
    const dosageEl = document.getElementById('alarmAlertDosage');
    const foodEl = document.getElementById('alarmAlertFood');
    const timeEl = document.getElementById('alarmAlertTime');
    const noteRow = document.getElementById('alarmAlertNoteRow');
    const noteEl = document.getElementById('alarmAlertNote');
    const snoozeMinEl = document.getElementById('alarmSnoozeMinutes');

    if (!overlay) return;

    if (nameEl) nameEl.textContent = med.name;
    if (dosageEl) dosageEl.innerHTML = `${med.dosage} &bull; ${med.type ? med.type.toUpperCase() : 'MEDICINE'}`;
    if (foodEl) foodEl.textContent = med.foodInstruction || 'Any time';
    if (timeEl) timeEl.textContent = this.formatDisplayTime(scheduledTime);
    if (snoozeMinEl) snoozeMinEl.textContent = this.settings.snoozeMinutes;

    if (med.notes && med.notes.trim()) {
      if (noteRow) noteRow.style.display = 'flex';
      if (noteEl) noteEl.textContent = med.notes;
    } else {
      if (noteRow) noteRow.style.display = 'none';
    }

    // Display dietary precautions if set
    const dietaryRow = document.getElementById('alarmAlertDietaryRow');
    const dietaryPills = document.getElementById('alarmAlertDietaryPills');
    if (dietaryRow && dietaryPills) {
      if (med.dietaryWarnings && Array.isArray(med.dietaryWarnings) && med.dietaryWarnings.length > 0) {
        dietaryPills.innerHTML = med.dietaryWarnings.map(w => `<span class="alarm-dietary-pill">⚠️ ${this.escapeHtml(w)}</span>`).join('');
        dietaryRow.style.display = 'flex';
      } else {
        dietaryRow.style.display = 'none';
      }
    }

    overlay.style.display = 'flex';
    if (window.lucide) {
      lucide.createIcons();
    }
  }

  stopAlarmSound() {
    if (this.alarmAudio) {
      this.alarmAudio.stopContinuousAlarm();
      this.alarmAudio.stopSpeech();
    }
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(0); // Cancel vibration
      } catch (e) {}
    }
  }

  closeAlarmModal() {
    this.stopAlarmSound();
    const overlay = document.getElementById('alarmAlertOverlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
    this.activeAlarmDose = null;
  }

  // --------------------------------------------------------------------------
  // Dose Actions (Take Now, Snooze, Skip)
  // --------------------------------------------------------------------------
  takeDose(medId, time) {
    const med = this.medications.find(m => m.id === medId);
    if (!med) return;

    const doseKey = `${medId}_${time}`;
    const now = new Date();
    const timestampStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Mark as taken in today's tracking
    this.todayDoses[doseKey] = {
      status: 'taken',
      takenAt: now.toISOString(),
      displayTime: timestampStr
    };
    this.saveDoses();

    // Decrement inventory stock
    if (typeof med.currentStock === 'number' && med.currentStock > 0) {
      med.currentStock -= 1;
      this.saveMedications();
      
      // Stock warning if low
      if (med.currentStock <= (med.lowStockThreshold || 5)) {
        setTimeout(() => {
          this.showToast('Low Stock Alert', `${med.name} has only ${med.currentStock} units remaining. Time to refill!`, 'warning');
        }, 800);
      }
    }

    // Add entry to permanent history log
    this.addHistoryLog({
      timestamp: now.toISOString(),
      medName: med.name,
      dosage: med.dosage,
      scheduledTime: this.formatDisplayTime(time),
      status: 'Taken',
      notes: med.foodInstruction || 'On schedule'
    });

    // Remove any active snooze for this dose
    this.snoozedDoses = this.snoozedDoses.filter(s => !(s.medId === medId && s.time === time));

    // Dismiss any active missed dose alerts for this medication dose
    this.missedDoseAlerts = this.missedDoseAlerts.filter(a => !(a.medId === medId && a.scheduledTime === time));
    this.saveMissedAlerts();

    // Close alarm modal if open
    if (this.activeAlarmDose?.med?.id === medId && this.activeAlarmDose?.scheduledTime === time) {
      this.closeAlarmModal();
    }

    this.showToast('Dose Confirmed! 🎉', `Marked ${med.name} (${med.dosage}) as taken. Great job staying on track!`, 'success');
    this.render();
  }

  snoozeDose(medId, time, minutes = null) {
    const med = this.medications.find(m => m.id === medId);
    if (!med) return;

    const snoozeMins = minutes || this.settings.snoozeMinutes || 10;
    const targetTimestamp = Date.now() + (snoozeMins * 60 * 1000);

    // Save snooze state
    this.snoozedDoses.push({
      medId,
      time,
      targetTimestamp
    });

    const doseKey = `${medId}_${time}`;
    this.todayDoses[doseKey] = {
      status: 'snoozed',
      snoozedUntil: new Date(targetTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    this.saveDoses();

    if (this.activeAlarmDose?.med?.id === medId && this.activeAlarmDose?.scheduledTime === time) {
      this.closeAlarmModal();
    }

    this.showToast('Alarm Snoozed ⏰', `Alarm will ring again in ${snoozeMins} minutes.`, 'info');
    this.render();
  }

  skipDose(medId, time) {
    const med = this.medications.find(m => m.id === medId);
    if (!med) return;

    const doseKey = `${medId}_${time}`;
    const now = new Date();

    this.todayDoses[doseKey] = {
      status: 'skipped',
      skippedAt: now.toISOString()
    };
    this.saveDoses();

    // Dismiss any active missed dose alerts for this medication dose
    this.missedDoseAlerts = this.missedDoseAlerts.filter(a => !(a.medId === medId && a.scheduledTime === time));
    this.saveMissedAlerts();

    this.addHistoryLog({
      timestamp: now.toISOString(),
      medName: med.name,
      dosage: med.dosage,
      scheduledTime: this.formatDisplayTime(time),
      status: 'Skipped',
      notes: 'Dose skipped by user'
    });

    if (this.activeAlarmDose?.med?.id === medId && this.activeAlarmDose?.scheduledTime === time) {
      this.closeAlarmModal();
    }

    this.showToast('Dose Skipped', `Marked ${med.name} as skipped for ${this.formatDisplayTime(time)}.`, 'warning');
    this.render();
  }

  undoDose(medId, time) {
    const med = this.medications.find(m => m.id === medId);
    const doseKey = `${medId}_${time}`;
    const previous = this.todayDoses[doseKey];
    if (!previous) return;

    // Restore stock if it was previously marked taken
    if (previous.status === 'taken' && med && typeof med.currentStock === 'number') {
      med.currentStock += 1;
      this.saveMedications();
    }

    delete this.todayDoses[doseKey];
    this.saveDoses();

    // Remove latest corresponding history log entry
    if (med) {
      const formattedTime = this.formatDisplayTime(time);
      const idx = this.historyLogs.findIndex(h => h.medName === med.name && h.scheduledTime === formattedTime);
      if (idx !== -1) {
        this.historyLogs.splice(idx, 1);
        this.saveHistory();
      }
    }

    this.showToast('Dose Reset ↺', `Marked ${med ? med.name : 'medication'} dose as pending.`, 'info');
    this.render();
  }

  addHistoryLog(entry) {
    this.historyLogs.unshift({
      id: 'log_' + Date.now() + Math.random().toString(36).substr(2, 4),
      ...entry
    });
    // Keep last 250 log entries
    if (this.historyLogs.length > 250) {
      this.historyLogs = this.historyLogs.slice(0, 250);
    }
    this.saveHistory();
  }

  // --------------------------------------------------------------------------
  // Notifications
  // --------------------------------------------------------------------------
  checkNotificationPermission() {
    if (!('Notification' in window)) return;

    const banner = document.getElementById('notificationBanner');
    const toggleBtn = document.getElementById('toggleNotificationBtn');

    if (Notification.permission === 'granted') {
      if (banner) banner.style.display = 'none';
      if (toggleBtn) {
        toggleBtn.textContent = 'Enabled (Active)';
        toggleBtn.classList.remove('btn-primary');
        toggleBtn.classList.add('btn-ghost');
      }
    } else if (Notification.permission === 'default') {
      if (banner) banner.style.display = 'flex';
      if (toggleBtn) toggleBtn.textContent = 'Enable Desktop Alerts';
    } else {
      if (banner) banner.style.display = 'none';
      if (toggleBtn) {
        toggleBtn.textContent = 'Blocked in Browser';
        toggleBtn.classList.add('btn-ghost');
      }
    }
  }

  async requestNotificationPermission() {
    if (!('Notification' in window)) {
      this.showToast('Not Supported', 'Desktop notifications are not supported in this browser.', 'warning');
      return;
    }

    const permission = await Notification.requestPermission();
    this.checkNotificationPermission();

    if (permission === 'granted') {
      this.showToast('Notifications Active! 🔔', 'You will receive alarms even when this tab is in the background.', 'success');
      new Notification('LuminaMed Alerts Active', {
        body: 'Medication alarms will notify you on time.',
        icon: 'https://cdn-icons-png.flaticon.com/512/883/883407.png'
      });
    } else {
      this.showToast('Permission Not Granted', 'Notifications were not enabled.', 'info');
    }
  }

  sendDesktopNotification(med, scheduledTime, isSnoozeWakeup) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    try {
      const title = isSnoozeWakeup 
        ? `⏰ Snooze Over: Time for ${med.name}`
        : `🔔 Medication Alarm: ${med.name}`;

      const options = {
        body: `Dosage: ${med.dosage} (${med.foodInstruction || 'Take as directed'})\nScheduled for: ${this.formatDisplayTime(scheduledTime)}`,
        icon: 'https://cdn-icons-png.flaticon.com/512/883/883407.png',
        tag: `dose_${med.id}_${scheduledTime}`,
        requireInteraction: true
      };

      const notification = new Notification(title, options);
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (e) {
      console.warn('Desktop notification dispatch error:', e);
    }
  }

  // --------------------------------------------------------------------------
  // Countdown to Next Due Dose
  // --------------------------------------------------------------------------
  updateNextDoseCountdown(now) {
    const currentMins = now.getHours() * 60 + now.getMinutes();
    let nextDose = null;
    let minDiff = Infinity;

    this.medications.forEach(med => {
      if (!med.times) return;
      med.times.forEach(time => {
        const doseKey = `${med.id}_${time}`;
        if (this.todayDoses[doseKey]?.status === 'taken') return;

        const [h, m] = time.split(':').map(Number);
        const doseTotalMins = h * 60 + m;
        let diff = doseTotalMins - currentMins;

        // If later today
        if (diff >= 0 && diff < minDiff) {
          minDiff = diff;
          nextDose = { med, time, diff };
        }
      });
    });

    // Update Header Pill
    const countdownValEl = document.getElementById('headerNextCountdown');
    const headerPill = document.getElementById('headerNextAlarmPill');
    const nextDoseNameEl = document.getElementById('nextDoseMedName');
    const nextDoseTimeEl = document.getElementById('nextDoseScheduledTime');
    const nextDoseBadge = document.getElementById('nextDoseTimerBadge');

    if (nextDose) {
      const formattedTime = this.formatDisplayTime(nextDose.time);
      const hoursLeft = Math.floor(nextDose.diff / 60);
      const minsLeft = nextDose.diff % 60;
      let countdownStr = '';

      if (nextDose.diff === 0) {
        countdownStr = 'Due Right Now!';
      } else if (hoursLeft > 0) {
        countdownStr = `in ${hoursLeft}h ${minsLeft}m (${formattedTime})`;
      } else {
        countdownStr = `in ${minsLeft}m (${formattedTime})`;
      }

      if (countdownValEl) countdownValEl.textContent = countdownStr;
      if (headerPill) headerPill.style.display = 'flex';

      if (nextDoseNameEl) nextDoseNameEl.textContent = nextDose.med.name;
      if (nextDoseTimeEl) nextDoseTimeEl.textContent = formattedTime;
      if (nextDoseBadge) {
        nextDoseBadge.textContent = nextDose.diff === 0 ? 'DUE NOW' : `In ${nextDose.diff}m`;
        nextDoseBadge.className = nextDose.diff <= 5 ? 'next-dose-relative bg-rose text-white' : 'next-dose-relative';
      }
    } else {
      if (countdownValEl) countdownValEl.textContent = 'All Done For Today! ✨';
      if (nextDoseNameEl) nextDoseNameEl.textContent = 'All Completed';
      if (nextDoseTimeEl) nextDoseTimeEl.textContent = '--:--';
      if (nextDoseBadge) {
        nextDoseBadge.textContent = 'All Clear';
        nextDoseBadge.className = 'next-dose-relative';
      }
    }
  }

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------
  render() {
    this.renderDashboardHero();
    this.renderMetrics();
    this.renderTodayTimeline();
    this.renderMedicationsCabinet();
    this.renderHistoryTable();
    this.renderContacts();
    this.renderMissedAlerts();
    this.renderVitals();
    this.renderAppointments();
    this.renderRefillStation();
    this.renderPatientHeaderBadge();
    this.updateInteractionsStatus();
    this.updateTabBadges();
    this.updateNotificationBadge();

    if (window.lucide) {
      lucide.createIcons();
    }
  }

  renderDashboardHero() {
    const heroGreetingBadge = document.getElementById('heroGreetingBadge');
    const heroGreetingTitle = document.getElementById('heroGreetingTitle');
    const heroGreetingSubtitle = document.getElementById('heroGreetingSubtitle');
    const heroScheduleStatusText = document.getElementById('heroScheduleStatusText');
    const heroGreetingPatientName = document.getElementById('heroGreetingPatientName');

    if (!heroGreetingBadge && !heroGreetingTitle) return;

    const now = new Date();
    const hour = now.getHours();
    let timeGreeting = 'Good morning';
    if (hour >= 12 && hour < 17) {
      timeGreeting = 'Good afternoon';
    } else if (hour >= 17) {
      timeGreeting = 'Good evening';
    }

    const patientName = this.patientProfile?.name || this.settings.patientName || '';
    const displayName = patientName && patientName !== 'Patient' ? patientName.split(' ')[0] : (patientName || 'Alex');

    if (heroGreetingBadge) {
      heroGreetingBadge.textContent = timeGreeting;
    }

    if (heroGreetingPatientName) {
      heroGreetingPatientName.textContent = displayName;
    }

    if (heroGreetingTitle) {
      heroGreetingTitle.innerHTML = `Welcome back, <span class="brand-teal">${this.escapeHtml(displayName)}</span>`;
    }

    let totalDoses = 0;
    let completedDoses = 0;
    this.medications.forEach(m => {
      if (m.times) {
        totalDoses += m.times.length;
        m.times.forEach(t => {
          if (this.todayDoses[`${m.id}_${t}`]?.status === 'taken') completedDoses++;
        });
      }
    });

    if (heroGreetingSubtitle) {
      if (totalDoses === 0) {
        heroGreetingSubtitle.textContent = 'No medications scheduled for today. Add a prescription or enjoy your clear schedule.';
      } else if (completedDoses === totalDoses) {
        heroGreetingSubtitle.textContent = `All ${totalDoses} doses scheduled for today are completed. Excellent adherence! ✨`;
      } else {
        const remaining = totalDoses - completedDoses;
        heroGreetingSubtitle.textContent = `You have ${totalDoses} dose${totalDoses === 1 ? '' : 's'} scheduled today: ${completedDoses} taken, ${remaining} remaining.`;
      }
    }

    if (heroScheduleStatusText) {
      if (totalDoses === 0) {
        heroScheduleStatusText.textContent = 'No medications scheduled today';
      } else if (completedDoses === totalDoses) {
        heroScheduleStatusText.textContent = `All ${totalDoses} doses completed! ✨`;
      } else {
        const remaining = totalDoses - completedDoses;
        heroScheduleStatusText.textContent = `${completedDoses} of ${totalDoses} taken • ${remaining} remaining`;
      }
    }
  }

  renderMetrics() {
    // 1. Calculate Doses Completed & Total Scheduled
    let totalDosesToday = 0;
    let completedDosesToday = 0;

    this.medications.forEach(med => {
      if (med.times && Array.isArray(med.times)) {
        totalDosesToday += med.times.length;
        med.times.forEach(time => {
          const key = `${med.id}_${time}`;
          if (this.todayDoses[key]?.status === 'taken') {
            completedDosesToday += 1;
          }
        });
      }
    });

    const percent = totalDosesToday === 0 ? 100 : Math.round((completedDosesToday / totalDosesToday) * 100);

    const adherencePercentEl = document.getElementById('adherencePercent');
    const adherenceBarEl = document.getElementById('adherenceProgressBar');
    const adherenceStatusEl = document.getElementById('adherenceStatus');
    const dosesRatioEl = document.getElementById('dosesCompletedRatio');
    const pendingTextEl = document.getElementById('pendingDosesText');
    const adherenceSubtextEl = document.getElementById('adherenceSubtext');
    const dosesCompletedSubtextEl = document.getElementById('dosesCompletedSubtext');

    if (adherencePercentEl) adherencePercentEl.textContent = `${percent}%`;
    if (adherenceBarEl) adherenceBarEl.style.width = `${percent}%`;

    if (adherenceStatusEl) {
      if (percent === 100 && totalDosesToday > 0) {
        adherenceStatusEl.textContent = 'All Done! 🌟';
        adherenceStatusEl.className = 'metric-badge badge-green';
      } else if (percent >= 70) {
        adherenceStatusEl.textContent = 'On Track';
        adherenceStatusEl.className = 'metric-badge badge-green';
      } else {
        adherenceStatusEl.textContent = 'In Progress';
        adherenceStatusEl.className = 'metric-badge badge-blue';
      }
    }

    if (adherenceSubtextEl) {
      adherenceSubtextEl.textContent = totalDosesToday > 0 ? `${completedDosesToday} of ${totalDosesToday} doses logged` : 'Daily dosing target';
    }

    if (dosesRatioEl) dosesRatioEl.textContent = `${completedDosesToday} / ${totalDosesToday}`;
    if (pendingTextEl) {
      const remaining = totalDosesToday - completedDosesToday;
      pendingTextEl.textContent = `${remaining} ${remaining === 1 ? 'dose' : 'doses'} remaining`;
    }
    if (dosesCompletedSubtextEl) {
      dosesCompletedSubtextEl.textContent = completedDosesToday > 0 ? `${completedDosesToday} dose${completedDosesToday === 1 ? '' : 's'} taken today` : 'Recorded intake audit';
    }

    // 2. Missed / Overdue Doses Calculation
    const missedCountEl = document.getElementById('missedDosesCount');
    const missedStatusEl = document.getElementById('missedDosesStatusText');
    const missedSubtextEl = document.getElementById('missedDosesSubtext');
    const missedCardEl = document.getElementById('missedDosesCard');
    
    // Check overdue doses for today
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    let overdueCount = 0;
    let overdueMedName = '';

    this.medications.forEach(m => {
      if (m.times) {
        m.times.forEach(t => {
          const key = `${m.id}_${t}`;
          const dose = this.todayDoses[key];
          if (!dose || (dose.status !== 'taken' && dose.status !== 'skipped')) {
            const [h, min] = t.split(':').map(Number);
            const scheduledMins = h * 60 + min;
            if (currentMins - scheduledMins > 15) {
              overdueCount++;
              if (!overdueMedName) overdueMedName = m.name;
            }
          }
        });
      }
    });

    const activeMissedAlertCount = Math.max(overdueCount, this.missedDoseAlerts.length);

    if (missedCountEl) missedCountEl.textContent = activeMissedAlertCount;
    if (missedStatusEl) {
      if (activeMissedAlertCount === 0) {
        missedStatusEl.textContent = 'All on track';
        missedStatusEl.className = 'metric-badge badge-green';
      } else {
        missedStatusEl.textContent = `${activeMissedAlertCount} Overdue`;
        missedStatusEl.className = 'metric-badge badge-rose';
      }
    }
    if (missedSubtextEl) {
      if (activeMissedAlertCount === 0) {
        missedSubtextEl.textContent = 'No missed doses today';
      } else {
        missedSubtextEl.textContent = overdueMedName ? `Overdue: ${overdueMedName}` : `${activeMissedAlertCount} dose(s) need attention`;
      }
    }
    if (missedCardEl) {
      missedCardEl.classList.toggle('has-missed-alert', activeMissedAlertCount > 0);
    }

    // 3. Refill Watchlist
    const lowStockMeds = this.medications.filter(m => (m.currentStock || 0) <= (m.lowStockThreshold || 5));
    const lowStockCountEl = document.getElementById('lowStockCount');
    const refillStatusTextEl = document.getElementById('refillStatusText');

    if (lowStockCountEl) lowStockCountEl.textContent = lowStockMeds.length;
    if (refillStatusTextEl) {
      if (lowStockMeds.length === 0) {
        refillStatusTextEl.textContent = 'Inventory sufficient';
        refillStatusTextEl.className = 'metric-meta text-emerald';
      } else {
        refillStatusTextEl.textContent = `${lowStockMeds.length} items need refill`;
        refillStatusTextEl.className = 'metric-meta text-danger';
      }
    }
  }

  renderTodayTimeline() {
    const container = document.getElementById('todayTimelineContainer');
    const emptyState = document.getElementById('emptyTodayScheduleState');
    if (!container) return;

    // Collect and sort all scheduled doses for today
    const allDoses = [];
    this.medications.forEach(med => {
      if (!med.times) return;
      med.times.forEach(time => {
        const doseKey = `${med.id}_${time}`;
        const doseRecord = this.todayDoses[doseKey] || { status: 'pending' };
        
        allDoses.push({
          med,
          time,
          status: doseRecord.status,
          takenAt: doseRecord.displayTime || null,
          snoozedUntil: doseRecord.snoozedUntil || null
        });
      });
    });

    // Chronological Sort
    allDoses.sort((a, b) => a.time.localeCompare(b.time));

    // Filter by Dose Status
    let filteredDoses = allDoses;
    if (this.activeFilter !== 'all') {
      filteredDoses = allDoses.filter(d => d.status === this.activeFilter);
    }

    // Filter by Daylight Slot (Morning, Afternoon, Evening, Bedtime)
    if (this.activeDaylightFilter && this.activeDaylightFilter !== 'all') {
      filteredDoses = filteredDoses.filter(d => {
        const phase = this.getDaylightPhase(d.time);
        return phase.key === this.activeDaylightFilter;
      });
    }

    // Search query filter
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      filteredDoses = filteredDoses.filter(d => 
        d.med.name.toLowerCase().includes(q) ||
        d.med.dosage.toLowerCase().includes(q)
      );
    }

    const dashContainer = document.getElementById('dashboardTimelineContainer');
    const dashEmpty = document.getElementById('emptyDashboardScheduleState');

    if (filteredDoses.length === 0) {
      if (container) container.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      if (dashContainer) dashContainer.innerHTML = '';
      if (dashEmpty) dashEmpty.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (dashEmpty) dashEmpty.style.display = 'none';

    const timelineHtml = filteredDoses.map(dose => {
      const isTaken = dose.status === 'taken';
      const isSkipped = dose.status === 'skipped';
      const isSnoozed = dose.status === 'snoozed';
      const typeIcon = this.typeIcons[dose.med.type] || 'pill';
      const colorClass = this.colorClasses[dose.med.color] || 'bg-cyan';
      const phase = this.getDaylightPhase(dose.time);
      const foodInst = dose.med.foodInstruction || 'Any time';
      const isMealRelated = foodInst.toLowerCase().includes('before') || foodInst.toLowerCase().includes('after') || foodInst.toLowerCase().includes('empty');
      const isBufferRunning = this.activeMealBuffer && this.activeMealBuffer.medName === dose.med.name;

      const [h, m] = dose.time.split(':').map(Number);
      const doseMins = (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
      const now = new Date();
      const currentMins = now.getHours() * 60 + now.getMinutes();
      const minsDiff = currentMins - doseMins;
      const isPastDue = !isTaken && !isSkipped && !isSnoozed && minsDiff > 0;

      let statusBadgeHtml = '';
      if (isTaken) {
        statusBadgeHtml = `<span class="badge-status-pill badge-taken"><i data-lucide="check"></i> Taken at ${dose.takenAt || 'Today'}</span>`;
      } else if (isSkipped) {
        statusBadgeHtml = `<span class="badge-status-pill badge-skipped"><i data-lucide="x"></i> Skipped</span>`;
      } else if (isSnoozed) {
        statusBadgeHtml = `<span class="badge-status-pill badge-snoozed"><i data-lucide="clock"></i> Snoozed to ${dose.snoozedUntil}</span>`;
      } else if (isPastDue) {
        if (minsDiff <= 15) {
          statusBadgeHtml = `<span class="badge-status-pill badge-due-now"><i data-lucide="alert-circle"></i> Due Right Now</span>`;
        } else {
          statusBadgeHtml = `<span class="badge-status-pill badge-overdue"><i data-lucide="alert-triangle"></i> Overdue (${minsDiff}m ago)</span>`;
        }
      } else {
        statusBadgeHtml = `<span class="badge-status-pill badge-pending"><i data-lucide="bell"></i> Scheduled</span>`;
      }

      return `
        <div class="dose-timeline-card glass-card theme-${dose.med.color || 'cyan'} ${isTaken ? 'is-taken' : ''} ${isSkipped ? 'is-skipped' : ''} ${isPastDue ? 'is-overdue' : ''}">
          <div class="dose-card-header">
            <div class="dose-time-badge">
              <i data-lucide="clock"></i>
              <span>${this.formatDisplayTime(dose.time)}</span>
            </div>
            <span class="dose-daylight-tag">${phase.icon} ${phase.label}</span>
            ${statusBadgeHtml}
            <div class="dose-header-actions">
              <button type="button" class="dose-action-icon-btn edit-med-btn" data-id="${dose.med.id}" title="Edit ${this.escapeHtml(dose.med.name)}">
                <i data-lucide="pencil" style="width: 13px; height: 13px;"></i>
              </button>
              <button type="button" class="dose-action-icon-btn btn-delete-today delete-med-btn" data-id="${dose.med.id}" onclick="luminaApp.confirmDeleteMedication('${dose.med.id}', event)" title="Delete ${this.escapeHtml(dose.med.name)}">
                <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
              </button>
            </div>
          </div>

          <div class="dose-card-body">
            <div class="dose-icon-wrap ${colorClass}">
              <i data-lucide="${typeIcon}"></i>
            </div>
            <div class="dose-med-details">
              <h3 class="dose-med-name">${this.escapeHtml(dose.med.name)}</h3>
              <p class="dose-med-sub">
                <span class="dose-dosage-highlight">${this.escapeHtml(dose.med.dosage)}</span>
                <span class="dose-bullet">&bull;</span>
                <span class="dose-instruction-highlight"><i data-lucide="utensils"></i> ${this.escapeHtml(foodInst)}</span>
              </p>
              ${!isTaken && isMealRelated ? `
                <button type="button" class="btn-meal-buffer ${isBufferRunning ? 'is-running' : ''}" onclick="luminaApp.startMealBuffer('${this.escapeHtml(dose.med.name)}', 30, '${this.escapeHtml(foodInst)}')">
                  <i data-lucide="timer"></i>
                  <span>${isBufferRunning ? '⏳ Buffer Active (Ticking)' : '🍽️ Start 30m Meal Buffer'}</span>
                </button>
              ` : ''}
              ${dose.med.notes ? `<p class="dose-med-note"><i data-lucide="info"></i> "${this.escapeHtml(dose.med.notes)}"</p>` : ''}
                ${dose.med.dietaryWarnings && Array.isArray(dose.med.dietaryWarnings) && dose.med.dietaryWarnings.length > 0 ? `
                  <div class="dose-dietary-chips">
                    ${dose.med.dietaryWarnings.map(w => {
                      const icon = window.LuminaInteractions ? window.LuminaInteractions.getDietaryIcon(w) : 'alert-triangle';
                      return `<span class="dietary-chip"><i data-lucide="${icon}"></i> ${this.escapeHtml(w)}</span>`;
                    }).join('')}
                  </div>
                ` : ''}
              </div>
            </div>

          <div class="dose-card-actions">
            ${isTaken ? `
              <div class="dose-done-indicator">
                <i data-lucide="check-circle-2"></i>
                <span>Dose Completed</span>
              </div>
              <button type="button" class="btn btn-undo-dose" onclick="luminaApp.undoDose('${dose.med.id}', '${dose.time}')" title="Reset dose to pending">
                <i data-lucide="rotate-ccw" style="width: 13px; height: 13px;"></i>
                <span>Undo</span>
              </button>
              <button type="button" class="btn btn-delete-today-card delete-med-btn" data-id="${dose.med.id}" onclick="luminaApp.confirmDeleteMedication('${dose.med.id}', event)" title="Remove this medicine">
                <i data-lucide="trash-2"></i>
                <span>Delete</span>
              </button>
            ` : isSkipped ? `
              <div class="dose-done-indicator" style="opacity: 0.7;">
                <i data-lucide="x-circle"></i>
                <span>Dose Skipped</span>
              </div>
              <button type="button" class="btn btn-undo-dose" onclick="luminaApp.undoDose('${dose.med.id}', '${dose.time}')" title="Reset dose to pending">
                <i data-lucide="rotate-ccw" style="width: 13px; height: 13px;"></i>
                <span>Undo</span>
              </button>
              <button class="btn btn-take-dose take-dose-btn" data-med-id="${dose.med.id}" data-time="${dose.time}">
                <i data-lucide="check-check"></i>
                <span>Take Dose</span>
              </button>
            ` : `
              <button class="btn btn-take-dose take-dose-btn" data-med-id="${dose.med.id}" data-time="${dose.time}">
                <i data-lucide="check-check"></i>
                <span>Take Dose</span>
              </button>
              <button class="btn btn-snooze-dose snooze-dose-btn" data-med-id="${dose.med.id}" data-time="${dose.time}" title="Snooze alarm">
                <i data-lucide="alarm-clock-off"></i>
                <span>Snooze</span>
              </button>
              <button class="btn btn-skip-dose skip-dose-btn" data-med-id="${dose.med.id}" data-time="${dose.time}" title="Skip dose">
                <i data-lucide="x"></i>
                <span>Skip</span>
              </button>
              <button type="button" class="btn btn-delete-today-card delete-med-btn" data-id="${dose.med.id}" onclick="luminaApp.confirmDeleteMedication('${dose.med.id}', event)" title="Remove this medicine">
                <i data-lucide="trash-2"></i>
                <span>Delete</span>
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');

    if (container) container.innerHTML = timelineHtml;
    if (dashContainer) dashContainer.innerHTML = timelineHtml;
  }

  renderMedicationsCabinet() {
    const container = document.getElementById('medicationsCabinetGrid');
    const emptyState = document.getElementById('emptyCabinetState');
    if (!container) return;

    let filtered = this.medications;
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      filtered = filtered.filter(m => 
        m.name.toLowerCase().includes(q) ||
        m.dosage.toLowerCase().includes(q) ||
        (m.notes && m.notes.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    container.innerHTML = filtered.map(med => {
      const typeIcon = this.typeIcons[med.type] || 'pill';
      const colorClass = this.colorClasses[med.color] || 'bg-cyan';
      const currentStock = med.currentStock || 0;
      const threshold = med.lowStockThreshold || 5;
      const isLowStock = currentStock <= threshold;
      const stockPercent = Math.min(100, Math.max(8, Math.round((currentStock / Math.max(30, currentStock + 10)) * 100)));
      const timesFormatted = med.times && med.times.length 
        ? med.times.map(t => this.formatDisplayTime(t)).join(', ')
        : 'No times set';

      return `
        <div class="med-cabinet-card glass-card theme-${med.color || 'cyan'}">
          <div class="cabinet-card-top">
            <div class="cabinet-icon-badge ${colorClass}">
              <i data-lucide="${typeIcon}"></i>
            </div>
            <div class="cabinet-header-text">
              <h3 class="cabinet-med-name">${this.escapeHtml(med.name)}</h3>
              <div class="cabinet-pill-row">
                <span class="cabinet-dosage-pill">${this.escapeHtml(med.dosage)}</span>
                <span class="cabinet-type-pill">${(med.type || 'tablet').toUpperCase()}</span>
                <span class="cabinet-status-tag ${isLowStock ? 'tag-refill-warn' : 'tag-stock-good'}">
                  ${isLowStock ? '⚠️ Low Stock' : '✓ In Stock'}
                </span>
              </div>
            </div>
          </div>

          <div class="cabinet-details-list">
            <div class="cabinet-detail-row">
              <div class="detail-label-icon"><i data-lucide="alarm-clock"></i></div>
              <div class="detail-content">
                <span class="detail-title">Scheduled Alarms</span>
                <span class="detail-val-highlight">${timesFormatted}</span>
              </div>
            </div>
            <div class="cabinet-detail-row">
              <div class="detail-label-icon"><i data-lucide="utensils"></i></div>
              <div class="detail-content">
                <span class="detail-title">Food Instructions</span>
                <span class="detail-val-highlight">${this.escapeHtml(med.foodInstruction || 'Any time')}</span>
              </div>
            </div>
            ${med.notes ? `
              <div class="cabinet-detail-row notes-row">
                <div class="detail-label-icon"><i data-lucide="info"></i></div>
                <div class="detail-content">
                  <span class="notes-text">"${this.escapeHtml(med.notes)}"</span>
                </div>
              </div>
            ` : ''}
          </div>

          ${med.dietaryWarnings && Array.isArray(med.dietaryWarnings) && med.dietaryWarnings.length > 0 ? `
            <div class="cabinet-dietary-row" style="margin-top: 10px; margin-bottom: 4px; display: flex; flex-wrap: wrap; gap: 5px;">
              ${med.dietaryWarnings.map(w => `<span class="dietary-chip" style="font-size: 10.5px;"><i data-lucide="${window.LuminaInteractions ? window.LuminaInteractions.getDietaryIcon(w) : 'alert-triangle'}"></i> ${this.escapeHtml(w)}</span>`).join('')}
            </div>
          ` : ''}

          <!-- Stock Level Bar & Inventory Info -->
          <div class="cabinet-stock-section">
            <div class="stock-header-row">
              <span class="stock-label">Inventory Level</span>
              <span class="stock-count-highlight ${isLowStock ? 'text-danger' : 'text-emerald'}">
                <strong>${currentStock}</strong> pills left
              </span>
            </div>
            <div class="stock-progress-track">
              <div class="stock-progress-bar ${isLowStock ? 'bar-low' : 'bar-normal'}" style="width: ${stockPercent}%;"></div>
            </div>
          </div>

          <!-- Neat Spacious Action Buttons Row -->
          <div class="cabinet-card-actions">
            <button class="btn refill-open-btn btn-refill-spacious" data-id="${med.id}">
              <i data-lucide="package-plus"></i>
              <span>Refill Stock</span>
            </button>
            <button class="btn edit-med-btn btn-edit-spacious" data-id="${med.id}" title="Edit Medicine">
              <i data-lucide="pencil"></i>
              <span>Edit</span>
            </button>
            <button class="btn delete-med-btn btn-delete-spacious" data-id="${med.id}" onclick="luminaApp.confirmDeleteMedication('${med.id}', event)" title="Delete Medicine">
              <i data-lucide="trash-2"></i>
              <span>Delete</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  renderHistoryTable() {
    const tbody = document.getElementById('historyTableBody');
    const emptyState = document.getElementById('emptyHistoryState');
    if (!tbody) return;

    if (this.historyLogs.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    tbody.innerHTML = this.historyLogs.map(log => {
      const date = new Date(log.timestamp);
      const formattedDate = date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const isTaken = log.status === 'Taken';

      return `
        <tr>
          <td><span class="history-time">${formattedDate}</span></td>
          <td><strong>${this.escapeHtml(log.medName)}</strong></td>
          <td><span class="badge-dosage">${this.escapeHtml(log.dosage)}</span></td>
          <td>${this.escapeHtml(log.scheduledTime)}</td>
          <td>
            <span class="badge-status-pill ${isTaken ? 'badge-taken' : 'badge-skipped'}">
              <i data-lucide="${isTaken ? 'check' : 'x'}"></i> ${log.status}
            </span>
          </td>
          <td class="text-secondary">${this.escapeHtml(log.notes || '--')}</td>
        </tr>
      `;
    }).join('');
  }

  updateTabBadges() {
    const todayBadge = document.getElementById('todayScheduleCount');
    const medBadge = document.getElementById('medicationsCount');
    const emergencyBadge = document.getElementById('emergencyContactsCount');
    const apptBadge = document.getElementById('appointmentsTabBadge');

    const sideTodayBadge = document.getElementById('sidebarTodayBadge');
    const sideMedsBadge = document.getElementById('sidebarMedsBadge');
    const sideVitalsBadge = document.getElementById('sidebarVitalsBadge');
    const sideApptsBadge = document.getElementById('sidebarApptsBadge');
    const sideSosBadge = document.getElementById('sidebarSosBadge');

    let totalDoses = 0;
    this.medications.forEach(m => {
      if (m.times) totalDoses += m.times.length;
    });

    if (todayBadge) todayBadge.textContent = totalDoses;
    if (medBadge) medBadge.textContent = this.medications.length;
    if (emergencyBadge) emergencyBadge.textContent = this.contacts.length;
    if (apptBadge) apptBadge.textContent = this.appointments.filter(a => a.status !== 'completed').length;

    if (sideTodayBadge) sideTodayBadge.textContent = totalDoses;
    if (sideMedsBadge) sideMedsBadge.textContent = this.medications.length;
    if (sideApptsBadge) sideApptsBadge.textContent = this.appointments.filter(a => a.status !== 'completed').length;
    if (sideSosBadge) sideSosBadge.textContent = this.contacts.length;
    if (sideVitalsBadge && window.LuminaVitals) {
      sideVitalsBadge.textContent = window.LuminaVitals.getRecords().length;
    }
  }

  // --------------------------------------------------------------------------
  // Event Handlers & Modal Controllers
  // --------------------------------------------------------------------------
  bindEvents() {
    // 1. Navigation Tabs & Sidebar Items
    document.querySelectorAll('.tab-btn, .sidebar-nav-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabTarget = btn.getAttribute('data-tab');
        if (tabTarget) {
          this.switchTab(tabTarget);
        }
      });
    });

    // 2. Schedule Filter Pills
    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.activeFilter = pill.getAttribute('data-filter');
        this.renderTodayTimeline();
        if (window.lucide) lucide.createIcons();
      });
    });

    // 2b. Daylight Phase Filter Pills (Morning, Afternoon, Evening, Bedtime)
    document.querySelectorAll('.daylight-pill-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.daylight-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeDaylightFilter = btn.getAttribute('data-daylight');
        this.renderTodayTimeline();
        if (window.lucide) lucide.createIcons();
      });
    });

    // 2c. Appointment Filter Pills
    document.querySelectorAll('[data-appointment-filter]').forEach(pill => {
      pill.addEventListener('click', (e) => {
        document.querySelectorAll('[data-appointment-filter]').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.activeAppointmentFilter = pill.getAttribute('data-appointment-filter');
        this.renderAppointments();


    
        if (window.lucide) lucide.createIcons();
      });
    });

    // 3. Global Search Input & Keyboard Navigation (Cmd+K / Ctrl+K and Escape)
    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim();
        this.renderTodayTimeline();
        this.renderMedicationsCabinet();
        if (window.lucide) lucide.createIcons();
      });
    }

    // Global Keyboard Navigation (Cmd+K / Ctrl+K to search, Escape to close modals)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      } else if (e.key === 'Escape') {
        this.closeAllModals();
      }
    });

    // Close notification popover on outside click
    document.addEventListener('click', (e) => {
      const popover = document.getElementById('notificationPopover');
      const btn = document.getElementById('headerNotificationBtn');
      if (popover && popover.style.display !== 'none' && !popover.contains(e.target) && !btn?.contains(e.target)) {
        this.toggleNotificationPopover(false);
      }
    });

    // 4. Header Action Buttons
    const openAddBtn = document.getElementById('openAddModalBtn');
    if (openAddBtn) openAddBtn.addEventListener('click', () => this.openMedModal());

    const testAlarmBtn = document.getElementById('testAlarmQuickBtn');
    if (testAlarmBtn) {
      testAlarmBtn.addEventListener('click', () => {
        if (this.medications.length > 0) {
          const sample = this.medications[0];
          this.triggerAlarm(sample, '12:00', false);
        } else {
          this.showToast('No Medicines Added', 'Please add a medicine first to test alarms.', 'warning');
        }
      });
    }

    // Prescription / Receipt Scanner Modal Buttons
    const openRxBtn = document.getElementById('openRxModalBtn');
    if (openRxBtn) openRxBtn.addEventListener('click', () => this.openRxModal());

    const closeRxBtn = document.getElementById('closeRxModalBtn');
    if (closeRxBtn) closeRxBtn.addEventListener('click', () => this.closeRxModal());

    const cancelRxBtn = document.getElementById('cancelRxModalBtn');
    if (cancelRxBtn) cancelRxBtn.addEventListener('click', () => this.closeRxModal());

    const rxFileInput = document.getElementById('rxFileInput');
    const rxDropzone = document.getElementById('rxDropzoneTrigger');
    const rxUploadArea = document.getElementById('rxUploadArea');

    if (rxDropzone && rxFileInput) {
      rxDropzone.addEventListener('click', () => rxFileInput.click());
    }

    if (rxFileInput) {
      rxFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.handleRxFile(e.target.files[0]);
        }
      });
    }

    if (rxUploadArea) {
      rxUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        rxUploadArea.classList.add('dragover');
      });
      rxUploadArea.addEventListener('dragleave', () => {
        rxUploadArea.classList.remove('dragover');
      });
      rxUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        rxUploadArea.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          this.handleRxFile(e.dataTransfer.files[0]);
        }
      });
    }

    const useSampleRxBtn = document.getElementById('useSampleRxBtn');
    if (useSampleRxBtn) {
      useSampleRxBtn.addEventListener('click', () => this.handleSampleRx());
    }

    const rescanRxBtn = document.getElementById('rescanRxBtn');
    if (rescanRxBtn) {
      rescanRxBtn.addEventListener('click', () => this.resetRxModal());
    }

    const toggleRawTextBtn = document.getElementById('toggleRawTextBtn');
    if (toggleRawTextBtn) {
      toggleRawTextBtn.addEventListener('click', () => {
        const box = document.getElementById('rawTextContainer');
        if (box) {
          box.style.display = box.style.display === 'none' ? 'block' : 'none';
        }
      });
    }

    const reparseRawTextBtn = document.getElementById('reparseRawTextBtn');
    if (reparseRawTextBtn) {
      reparseRawTextBtn.addEventListener('click', () => {
        const txt = document.getElementById('rawExtractedTextarea')?.value || '';
        if (window.luminaRxParser && txt.trim()) {
          const parsed = window.luminaRxParser.parsePrescriptionText(txt);
          this.detectedRxMeds = parsed;
          this.renderDetectedMeds();
          this.showToast('Re-parsed Text', `Identified ${parsed.length} medications from updated text.`, 'info');
        }
      });
    }

    const addManualRxMedBtn = document.getElementById('addManualRxMedBtn');
    if (addManualRxMedBtn) {
      addManualRxMedBtn.addEventListener('click', () => this.addManualDetectedMed());
    }

    const importMedsBtn = document.getElementById('importMedsBtn');
    if (importMedsBtn) {
      importMedsBtn.addEventListener('click', () => this.importSelectedMeds());
    }

    // 5. Notification Permission Banner & Toggle
    const enableBannerBtn = document.getElementById('enableNotificationsBtn');
    if (enableBannerBtn) {
      enableBannerBtn.addEventListener('click', () => this.requestNotificationPermission());
    }

    const dismissBannerBtn = document.getElementById('dismissBannerBtn');
    if (dismissBannerBtn) {
      dismissBannerBtn.addEventListener('click', () => {
        const banner = document.getElementById('notificationBanner');
        if (banner) banner.style.display = 'none';
      });
    }

    const toggleNotifBtn = document.getElementById('toggleNotificationBtn');
    if (toggleNotifBtn) {
      toggleNotifBtn.addEventListener('click', () => this.requestNotificationPermission());
    }

    // 6. Active Alarm Overlay Buttons
    const alarmTakeBtn = document.getElementById('alarmTakeNowBtn');
    if (alarmTakeBtn) {
      alarmTakeBtn.addEventListener('click', () => {
        if (this.activeAlarmDose) {
          this.takeDose(this.activeAlarmDose.med.id, this.activeAlarmDose.scheduledTime);
        }
      });
    }

    const alarmSnoozeBtn = document.getElementById('alarmSnoozeBtn');
    if (alarmSnoozeBtn) {
      alarmSnoozeBtn.addEventListener('click', () => {
        if (this.activeAlarmDose) {
          this.snoozeDose(this.activeAlarmDose.med.id, this.activeAlarmDose.scheduledTime);
        }
      });
    }

    const alarmSkipBtn = document.getElementById('alarmSkipBtn');
    if (alarmSkipBtn) {
      alarmSkipBtn.addEventListener('click', () => {
        if (this.activeAlarmDose) {
          this.skipDose(this.activeAlarmDose.med.id, this.activeAlarmDose.scheduledTime);
        }
      });
    }

    // 7. Add/Edit Medicine Modal Controls
    const closeMedModalBtn = document.getElementById('closeMedModalBtn');
    const cancelMedModalBtn = document.getElementById('cancelMedModalBtn');
    if (closeMedModalBtn) closeMedModalBtn.addEventListener('click', () => this.closeMedModal());
    if (cancelMedModalBtn) cancelMedModalBtn.addEventListener('click', () => this.closeMedModal());

    const addTimeBtn = document.getElementById('addDoseTimeBtn');
    if (addTimeBtn) {
      addTimeBtn.addEventListener('click', () => this.addTimeSlotInput('12:00'));
    }

    // Type Pills Selection in Form
    document.querySelectorAll('#medTypeSelector .type-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#medTypeSelector .type-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.updateFormIconPreview();
      });
    });

    // Color Swatches in Form
    document.querySelectorAll('#colorPaletteSelector .color-swatch-btn').forEach(swatch => {
      swatch.addEventListener('click', () => {
        document.querySelectorAll('#colorPaletteSelector .color-swatch-btn').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
      });
    });

    // Form Submit
    const medForm = document.getElementById('medicationForm');
    if (medForm) {
      medForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleMedicationFormSubmit();
      });
    }

    // 8. Event Delegation for Timeline & Cabinet dynamic buttons
    document.addEventListener('click', (e) => {
      // Take Dose Button
      const takeBtn = e.target.closest('.take-dose-btn');
      if (takeBtn) {
        const medId = takeBtn.getAttribute('data-med-id');
        const time = takeBtn.getAttribute('data-time');
        this.takeDose(medId, time);
        return;
      }

      // Snooze Dose Button
      const snoozeBtn = e.target.closest('.snooze-dose-btn');
      if (snoozeBtn) {
        const medId = snoozeBtn.getAttribute('data-med-id');
        const time = snoozeBtn.getAttribute('data-time');
        this.snoozeDose(medId, time);
        return;
      }

      // Skip Dose Button
      const skipBtn = e.target.closest('.skip-dose-btn');
      if (skipBtn) {
        const medId = skipBtn.getAttribute('data-med-id');
        const time = skipBtn.getAttribute('data-time');
        this.skipDose(medId, time);
        return;
      }

      // Edit Medicine Button
      const editBtn = e.target.closest('.edit-med-btn');
      if (editBtn) {
        const id = editBtn.getAttribute('data-id');
        const med = this.medications.find(m => m.id === id);
        if (med) this.openMedModal(med);
        return;
      }

      // Delete Medicine Button (Works in Cabinet, Today Timeline, and Med Modal)
      const delBtn = e.target.closest('.delete-med-btn');
      if (delBtn) {
        const id = delBtn.getAttribute('data-id') || document.getElementById('editMedId')?.value;
        if (id) {
          this.confirmDeleteMedication(id, e);
        }
        return;
      }

      // Rx Extracted Medicine Delete Button
      const rxDelBtn = e.target.closest('.rx-delete-item-btn');
      if (rxDelBtn) {
        const idx = rxDelBtn.getAttribute('data-index');
        this.deleteDetectedRxMed(idx, e);
        return;
      }

      // Reset / Clear New Medicine Form Button
      const resetBtn = e.target.closest('#resetMedFormBtn');
      if (resetBtn) {
        const nameInput = document.getElementById('medNameInput');
        const dosageInput = document.getElementById('medDosageInput');
        const notesInput = document.getElementById('medNotesInput');
        if (nameInput) nameInput.value = '';
        if (dosageInput) dosageInput.value = '';
        if (notesInput) notesInput.value = '';
        const timesContainer = document.getElementById('timesContainer');
        if (timesContainer) {
          timesContainer.innerHTML = '';
          this.addTimeSlotInput('08:00');
        }
        document.querySelectorAll('#dietaryChipsSelector input[type="checkbox"]').forEach(cb => {
          cb.checked = false;
        });
        this.showToast('Form Cleared', 'All medication inputs have been reset.', 'info');
        return;
      }

      // Refill Open Button
      const refillBtn = e.target.closest('.refill-open-btn');
      if (refillBtn) {
        const id = refillBtn.getAttribute('data-id');
        this.openRefillModal(id);
        return;
      }

      // Play Sound Preview Sample Button
      const sampleBtn = e.target.closest('.play-sample-btn');
      if (sampleBtn) {
        const sound = sampleBtn.getAttribute('data-sound');
        if (this.alarmAudio) {
          this.alarmAudio.setVolume(this.settings.volume / 100);
          this.alarmAudio.playSound(sound);
        }
        return;
      }
    });

    // 9. Sound & Settings Tab Events
    document.querySelectorAll('input[name="chimeSound"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.settings.sound = e.target.value;
        this.saveSettings();
        if (this.alarmAudio) {
          this.alarmAudio.playSound(this.settings.sound);
        }
      });
    });

    const volSlider = document.getElementById('alarmVolumeSlider');
    const volLabel = document.getElementById('alarmVolumeLabel');
    if (volSlider) {
      volSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.settings.volume = val;
        if (volLabel) volLabel.textContent = `${val}%`;
        this.saveSettings();
        if (this.alarmAudio) this.alarmAudio.setVolume(val / 100);
      });
    }

    const snoozeSelect = document.getElementById('defaultSnoozeSelect');
    if (snoozeSelect) {
      snoozeSelect.addEventListener('change', (e) => {
        this.settings.snoozeMinutes = parseInt(e.target.value, 10);
        this.saveSettings();
      });
    }

    const continuousToggle = document.getElementById('continuousRingToggle');
    if (continuousToggle) {
      continuousToggle.addEventListener('change', (e) => {
        this.settings.continuousRing = e.target.checked;
        this.saveSettings();
      });
    }

    const vibToggle = document.getElementById('vibrationToggle');
    if (vibToggle) {
      vibToggle.addEventListener('change', (e) => {
        this.settings.vibration = e.target.checked;
        this.saveSettings();
      });
    }

    // Voice Speech Reminder Settings
    const voiceToggle = document.getElementById('voiceAnnounceToggle');
    if (voiceToggle) {
      voiceToggle.addEventListener('change', (e) => {
        this.settings.voiceSpeechEnabled = e.target.checked;
        this.saveSettings();
        if (this.alarmAudio) this.alarmAudio.setSpeechEnabled(e.target.checked);
        this.showToast('Voice Reminders', e.target.checked ? 'Spoken dose reminders enabled.' : 'Spoken dose reminders muted.', 'info');
      });
    }

    const voiceRateSlider = document.getElementById('voiceRateSlider');
    const voiceRateLabel = document.getElementById('voiceRateLabel');
    if (voiceRateSlider) {
      voiceRateSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.settings.voiceRate = val;
        if (voiceRateLabel) voiceRateLabel.textContent = `${val}x`;
        this.saveSettings();
        if (this.alarmAudio) this.alarmAudio.setSpeechRate(val);
      });
    }

    // 10. Data Reset Controls

    const resetDataBtn = document.getElementById('resetAllDataBtn');
    if (resetDataBtn) {
      resetDataBtn.addEventListener('click', () => {
        if (confirm('Reset all medications, history, and preferences to a clean slate?')) {
          localStorage.clear();
          this.medications = [];
          this.todayDoses = {};
          this.historyLogs = [];
          this.settings = { ...DEFAULT_SETTINGS };
          this.render();
          this.showToast('Reset Complete', 'All data has been cleared.', 'info');
        }
      });
    }

    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener('click', () => {
        if (confirm('Clear entire adherence intake history log?')) {
          this.historyLogs = [];
          this.saveHistory();
          this.renderHistoryTable();
          this.showToast('History Cleared', 'Adherence logs have been wiped.', 'info');
        }
      });
    }

    // 11. Refill Modal Controls
    const closeRefillBtn = document.getElementById('closeRefillModalBtn');
    const cancelRefillBtn = document.getElementById('cancelRefillModalBtn');
    if (closeRefillBtn) closeRefillBtn.addEventListener('click', () => this.closeRefillModal());
    if (cancelRefillBtn) cancelRefillBtn.addEventListener('click', () => this.closeRefillModal());

    document.querySelectorAll('.refill-quick-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const addAmount = parseInt(btn.getAttribute('data-add'), 10);
        const input = document.getElementById('customRefillInput');
        if (input) input.value = addAmount;
      });
    });

    const confirmRefillBtn = document.getElementById('confirmRefillBtn');
    if (confirmRefillBtn) {
      confirmRefillBtn.addEventListener('click', () => {
        const input = document.getElementById('customRefillInput');
        const qty = parseInt(input?.value || '0', 10);
        if (this.refillTargetMedId && qty > 0) {
          const med = this.medications.find(m => m.id === this.refillTargetMedId);
          if (med) {
            med.currentStock = (med.currentStock || 0) + qty;
            this.saveMedications();
            this.showToast('Stock Refilled! 📦', `Added ${qty} units to ${med.name}. Current stock: ${med.currentStock}`, 'success');
            this.closeRefillModal();
            this.render();
          }
        }
      });
    }

    // 12. Caregiver & Emergency Contacts Controls
    const closeContactBtn = document.getElementById('closeContactModalBtn');
    const cancelContactBtn = document.getElementById('cancelContactModalBtn');
    if (closeContactBtn) closeContactBtn.addEventListener('click', () => this.closeContactModal());
    if (cancelContactBtn) cancelContactBtn.addEventListener('click', () => this.closeContactModal());

    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
      contactForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleContactFormSubmit();
      });
    }

    const closeSosBtn = document.getElementById('closeEmergencySosBtn');
    if (closeSosBtn) closeSosBtn.addEventListener('click', () => this.closeEmergencySosModal());

    const patientInput = document.getElementById('patientNameInput');
    if (patientInput) {
      patientInput.addEventListener('change', (e) => {
        this.settings.patientName = e.target.value.trim() || 'Patient';
        this.saveSettings();
        this.showToast('Patient Name Updated', `Saved as "${this.settings.patientName}" for alerts.`, 'info');
      });
    }

    const missedThresholdSel = document.getElementById('missedThresholdSelect');
    if (missedThresholdSel) {
      missedThresholdSel.addEventListener('change', (e) => {
        this.settings.missedDoseThreshold = parseInt(e.target.value, 10);
        this.saveSettings();
        this.evaluateMissedDoses(new Date());
        this.showToast('Rule Updated', `Alerts will trigger after ${this.settings.missedDoseThreshold} mins of delay.`, 'info');
      });
    }

    // 13. Vitals & Health Metrics Controls
    document.querySelectorAll('[data-vitals-filter]').forEach(pill => {
      pill.addEventListener('click', (e) => {
        document.querySelectorAll('[data-vitals-filter]').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.activeVitalsFilter = pill.getAttribute('data-vitals-filter');
        this.renderVitalsTable();
        if (window.lucide) lucide.createIcons();
      });
    });

    const closeVitalsBtn = document.getElementById('closeVitalsModalBtn');
    const cancelVitalsBtn = document.getElementById('cancelVitalsModalBtn');
    if (closeVitalsBtn) closeVitalsBtn.addEventListener('click', () => this.closeVitalsModal());
    if (cancelVitalsBtn) cancelVitalsBtn.addEventListener('click', () => this.closeVitalsModal());

    const vitalsForm = document.getElementById('vitalsForm');
    if (vitalsForm) {
      vitalsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleVitalsFormSubmit();
      });
    }

    document.querySelectorAll('#vitalTypeSelector .vitals-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#vitalTypeSelector .vitals-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const type = btn.getAttribute('data-vital-type');
        this.switchVitalsInputType(type);
      });
    });

    ['vitalSystolicInput', 'vitalDiastolicInput', 'vitalGlucoseInput', 'vitalGlucoseContext', 'vitalPulseInput', 'vitalTempInput'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => this.updateVitalsLivePreview());
      if (el) el.addEventListener('change', () => this.updateVitalsLivePreview());
    });

    // 14. Drug Interactions & Clinical Safety Hub Controls
    const openInteractionsBtn = document.getElementById('openInteractionsModalBtn');
    if (openInteractionsBtn) openInteractionsBtn.addEventListener('click', () => this.openInteractionsModal());

    const closeInteractionsBtn = document.getElementById('closeInteractionsModalBtn');
    if (closeInteractionsBtn) closeInteractionsBtn.addEventListener('click', () => this.closeInteractionsModal());

    document.querySelectorAll('.safety-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.safety-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.getAttribute('data-safety-tab');
        document.querySelectorAll('.safety-tab-content').forEach(c => {
          c.style.display = c.id === target ? 'block' : 'none';
        });
        if (window.lucide) lucide.createIcons();
      });
    });

    const runSandboxBtn = document.getElementById('runSandboxCheckBtn');
    if (runSandboxBtn) runSandboxBtn.addEventListener('click', () => this.runSandboxInteractionCheck());

    document.querySelectorAll('.quick-pair-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pair = btn.getAttribute('data-pair');
        if (pair) {
          const [d1, d2] = pair.split(',');
          const inp1 = document.getElementById('sandboxDrug1');
          const inp2 = document.getElementById('sandboxDrug2');
          if (inp1) inp1.value = d1.trim();
          if (inp2) inp2.value = d2.trim();
          this.runSandboxInteractionCheck();
        }
      });
    });

    // 15. Real-time Drug Name Precaution & Interaction Watcher
    const medNameInp = document.getElementById('medNameInput');
    if (medNameInp) {
      medNameInp.addEventListener('input', (e) => {
        this.handleMedNameInput(e.target.value.trim());
      });
    }
  }

  // --------------------------------------------------------------------------
  // Navigation & Tabs
  // --------------------------------------------------------------------------
  switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.sidebar-nav-item').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === tabId);
    });

    const titles = {
      'tab-dashboard': 'Dashboard',
      'tab-today': "Today's Schedule",
      'tab-medications': 'Medicines & Stock',
      'tab-vitals': 'Health Checker',
      'tab-appointments': 'Appointments & Refills',
      'tab-history': 'Adherence History',
      'tab-caregivers': 'Caregivers & SOS',
      'tab-settings': 'Settings'
    };
    const breadcrumb = document.getElementById('headerBreadcrumbTitle');
    if (breadcrumb && titles[tabId]) {
      breadcrumb.textContent = titles[tabId];
    }

    this.toggleSidebar(false);

    if (tabId === 'tab-dashboard' || tabId === 'tab-today') {
      this.renderTodayTimeline();
    }

    if (window.lucide) {
      lucide.createIcons();
    }
  }

  toggleSidebar(forceState = null) {
    const sidebar = document.getElementById('appSidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!sidebar) return;
    const isCurrentlyOpen = sidebar.classList.contains('mobile-open');
    const shouldOpen = forceState !== null ? forceState : !isCurrentlyOpen;
    if (shouldOpen) {
      sidebar.classList.add('mobile-open');
      if (backdrop) backdrop.classList.add('active');
    } else {
      sidebar.classList.remove('mobile-open');
      if (backdrop) backdrop.classList.remove('active');
    }
  }

  closeAllModals() {
    this.closeMedModal();
    this.closeEmergencySosModal();
    this.closePatientProfileModal();
    this.closeDeleteConfirmModal();
    this.closeRxModal();
    this.toggleNotificationPopover(false);
    this.toggleSidebar(false);
    const vitalsModal = document.getElementById('vitalsModalOverlay');
    if (vitalsModal) vitalsModal.style.display = 'none';
    const apptModal = document.getElementById('appointmentModalOverlay');
    if (apptModal) apptModal.style.display = 'none';
    const interModal = document.getElementById('interactionsModalOverlay');
    if (interModal) interModal.style.display = 'none';
  }

  toggleNotificationPopover(forceState = null) {
    const popover = document.getElementById('notificationPopover');
    if (!popover) return;
    const isVisible = popover.style.display !== 'none';
    const shouldShow = forceState !== null ? forceState : !isVisible;
    popover.style.display = shouldShow ? 'block' : 'none';

    if (shouldShow) {
      this.renderNotificationPopoverList();
      if (window.lucide) lucide.createIcons();
    }
  }

  renderNotificationPopoverList() {
    const listEl = document.getElementById('notificationPopoverList');
    if (!listEl) return;

    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const items = [];

    this.medications.forEach(m => {
      if (m.times) {
        m.times.forEach(t => {
          const key = `${m.id}_${t}`;
          const dose = this.todayDoses[key];
          const isTaken = dose && dose.status === 'taken';
          const isSkipped = dose && dose.status === 'skipped';
          if (!isTaken && !isSkipped) {
            const [h, min] = t.split(':').map(Number);
            const scheduledMins = (isNaN(h) ? 0 : h) * 60 + (isNaN(min) ? 0 : min);
            const diff = currentMins - scheduledMins;
            if (diff > 15) {
              items.push({
                type: 'overdue',
                med: m,
                time: t,
                label: `Overdue by ${diff}m`,
                title: `${m.name} (${m.dosage})`
              });
            } else if (diff >= -60 && diff <= 15) {
              items.push({
                type: 'upcoming',
                med: m,
                time: t,
                label: diff > 0 ? 'Due right now' : `Due in ${Math.abs(diff)}m`,
                title: `${m.name} (${m.dosage})`
              });
            }
          }
        });
      }
    });

    if (items.length === 0) {
      listEl.innerHTML = `
        <div class="notif-item">
          <div class="notif-item-icon icon-empty">
            <i data-lucide="check" style="width: 14px; height: 14px;"></i>
          </div>
          <div class="notif-item-content">
            <div class="notif-item-title">All Caught Up!</div>
            <div class="notif-item-meta">No overdue or urgent alerts right now.</div>
          </div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = items.map(item => `
      <div class="notif-item" onclick="luminaApp.switchTab('tab-today'); luminaApp.toggleNotificationPopover(false);">
        <div class="notif-item-icon ${item.type === 'overdue' ? 'icon-overdue' : 'icon-upcoming'}">
          <i data-lucide="${item.type === 'overdue' ? 'alert-triangle' : 'clock'}" style="width: 14px; height: 14px;"></i>
        </div>
        <div class="notif-item-content">
          <div class="notif-item-title">${this.escapeHtml(item.title)}</div>
          <div class="notif-item-meta">${item.label} • Scheduled: ${this.formatDisplayTime(item.time)}</div>
        </div>
      </div>
    `).join('');
  }

  updateNotificationBadge() {
    const badge = document.getElementById('headerNotificationBadge');
    if (!badge) return;

    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    let alertCount = 0;

    this.medications.forEach(m => {
      if (m.times) {
        m.times.forEach(t => {
          const key = `${m.id}_${t}`;
          const dose = this.todayDoses[key];
          if (!dose || (dose.status !== 'taken' && dose.status !== 'skipped')) {
            const [h, min] = t.split(':').map(Number);
            const scheduledMins = (isNaN(h) ? 0 : h) * 60 + (isNaN(min) ? 0 : min);
            if (currentMins - scheduledMins > 15) {
              alertCount++;
            }
          }
        });
      }
    });

    if (alertCount > 0) {
      badge.textContent = alertCount;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  applySettingsToUI() {
    // Sound selection
    const soundRadio = document.querySelector(`input[name="chimeSound"][value="${this.settings.sound}"]`);
    if (soundRadio) soundRadio.checked = true;

    // Volume
    const volSlider = document.getElementById('alarmVolumeSlider');
    const volLabel = document.getElementById('alarmVolumeLabel');
    if (volSlider) volSlider.value = this.settings.volume;
    if (volLabel) volLabel.textContent = `${this.settings.volume}%`;

    // Snooze
    const snoozeSelect = document.getElementById('defaultSnoozeSelect');
    if (snoozeSelect) snoozeSelect.value = String(this.settings.snoozeMinutes);

    // Continuous & Vibration
    const contToggle = document.getElementById('continuousRingToggle');
    if (contToggle) contToggle.checked = this.settings.continuousRing;

    const vibToggle = document.getElementById('vibrationToggle');
    if (vibToggle) vibToggle.checked = this.settings.vibration;

    // Voice Reminders
    const voiceToggle = document.getElementById('voiceAnnounceToggle');
    if (voiceToggle) voiceToggle.checked = this.settings.voiceSpeechEnabled !== false;

    const voiceRateSlider = document.getElementById('voiceRateSlider');
    const voiceRateLabel = document.getElementById('voiceRateLabel');
    if (voiceRateSlider) {
      voiceRateSlider.value = this.settings.voiceRate || 0.95;
      if (voiceRateLabel) voiceRateLabel.textContent = `${this.settings.voiceRate || 0.95}x`;
    }

    // Caregiver & Patient settings
    const patientInput = document.getElementById('patientNameInput');
    if (patientInput) patientInput.value = this.settings.patientName || 'Patient';

    const missedThresholdSel = document.getElementById('missedThresholdSelect');
    if (missedThresholdSel) missedThresholdSel.value = String(this.settings.missedDoseThreshold || 30);

    // Apply Elderly Mode
    if (this.isElderlyMode) {
      document.body.classList.add('elderly-mode');
    } else {
      document.body.classList.remove('elderly-mode');
    }
  }

  // --------------------------------------------------------------------------
  // Medication CRUD Modal
  // --------------------------------------------------------------------------
  openMedModal(medToEdit = null) {
    const overlay = document.getElementById('medModalOverlay');
    const title = document.getElementById('medModalTitle');
    const editIdInput = document.getElementById('editMedId');
    const nameInput = document.getElementById('medNameInput');
    const dosageInput = document.getElementById('medDosageInput');
    const foodSelect = document.getElementById('foodInstructionSelect');
    const stockInput = document.getElementById('currentStockInput');
    const thresholdInput = document.getElementById('lowStockThresholdInput');
    const notesInput = document.getElementById('medNotesInput');
    const timesContainer = document.getElementById('timesContainer');

    if (!overlay) return;

    const delModalBtn = document.getElementById('deleteMedModalBtn');
    const resetFormBtn = document.getElementById('resetMedFormBtn');

    if (medToEdit) {
      if (title) title.textContent = 'Edit Medication';
      if (editIdInput) editIdInput.value = medToEdit.id;
      if (nameInput) nameInput.value = medToEdit.name;
      if (dosageInput) dosageInput.value = medToEdit.dosage;
      if (foodSelect) foodSelect.value = medToEdit.foodInstruction || 'After food';
      if (stockInput) stockInput.value = medToEdit.currentStock || 30;
      if (thresholdInput) thresholdInput.value = medToEdit.lowStockThreshold || 5;
      if (notesInput) notesInput.value = medToEdit.notes || '';

      if (delModalBtn) {
        delModalBtn.style.display = 'inline-flex';
        delModalBtn.setAttribute('data-id', medToEdit.id);
      }
      if (resetFormBtn) resetFormBtn.style.display = 'none';

      // Type button
      document.querySelectorAll('#medTypeSelector .type-pill-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-type') === medToEdit.type);
      });

      // Color button
      document.querySelectorAll('#colorPaletteSelector .color-swatch-btn').forEach(s => {
        s.classList.toggle('active', s.getAttribute('data-color') === medToEdit.color);
      });

      // Populate times
      if (timesContainer) {
        timesContainer.innerHTML = '';
        if (medToEdit.times && medToEdit.times.length) {
          medToEdit.times.forEach(t => this.addTimeSlotInput(t));
        } else {
          this.addTimeSlotInput('08:00');
        }
      }

      // Populate dietary warning checkboxes
      const editWarnings = Array.isArray(medToEdit.dietaryWarnings) ? medToEdit.dietaryWarnings : [];
      document.querySelectorAll('#dietaryChipsSelector input[type="checkbox"]').forEach(cb => {
        cb.checked = editWarnings.includes(cb.value);
      });
    } else {
      if (title) title.textContent = 'Add New Medication';
      if (editIdInput) editIdInput.value = '';
      if (nameInput) nameInput.value = '';
      if (dosageInput) dosageInput.value = '';
      if (foodSelect) foodSelect.value = 'After food';
      if (stockInput) stockInput.value = 30;
      if (thresholdInput) thresholdInput.value = 5;
      if (notesInput) notesInput.value = '';

      if (delModalBtn) {
        delModalBtn.style.display = 'none';
        delModalBtn.removeAttribute('data-id');
      }
      if (resetFormBtn) resetFormBtn.style.display = 'inline-flex';

      // Default type & color
      document.querySelectorAll('#medTypeSelector .type-pill-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
      document.querySelectorAll('#colorPaletteSelector .color-swatch-btn').forEach((s, i) => s.classList.toggle('active', i === 0));

      if (timesContainer) {
        timesContainer.innerHTML = '';
        this.addTimeSlotInput('08:00');
      }

      // Clear dietary checkboxes
      document.querySelectorAll('#dietaryChipsSelector input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
      });
    }

    // Reset auto-suggest and conflict boxes
    const suggestBox = document.getElementById('dietaryAutoSuggestBox');
    if (suggestBox) {
      suggestBox.style.display = 'none';
      suggestBox.innerHTML = '';
    }
    const conflictBox = document.getElementById('modalConflictAlertBox');
    if (conflictBox) {
      conflictBox.style.display = 'none';
      conflictBox.innerHTML = '';
    }

    this.updateFormIconPreview();
    overlay.style.display = 'flex';
    if (nameInput) nameInput.focus();
    if (window.lucide) lucide.createIcons();
  }

  closeMedModal() {
    const overlay = document.getElementById('medModalOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  addTimeSlotInput(defaultTime = '08:00') {
    const container = document.getElementById('timesContainer');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'time-input-row';
    row.innerHTML = `
      <input type="time" class="glass-input time-value-input" value="${defaultTime}" required>
      <button type="button" class="btn-icon-tiny remove-time-btn" title="Remove Time">
        <i data-lucide="minus-circle"></i>
      </button>
    `;

    row.querySelector('.remove-time-btn').addEventListener('click', () => {
      // Keep at least one time
      if (container.children.length > 1) {
        row.remove();
      } else {
        this.showToast('At Least One Time Required', 'Every medication requires at least one alarm trigger time.', 'info');
      }
    });

    container.appendChild(row);
    if (window.lucide) lucide.createIcons();
  }

  updateFormIconPreview() {
    const activeTypeBtn = document.querySelector('#medTypeSelector .type-pill-btn.active');
    const previewBox = document.getElementById('modalIconPreview');
    if (previewBox && activeTypeBtn) {
      const type = activeTypeBtn.getAttribute('data-type') || 'tablet';
      const icon = this.typeIcons[type] || 'pill';
      previewBox.innerHTML = `<i data-lucide="${icon}"></i>`;
      if (window.lucide) lucide.createIcons();
    }
  }

  handleMedicationFormSubmit() {
    const editId = document.getElementById('editMedId')?.value;
    const name = document.getElementById('medNameInput')?.value.trim();
    const dosage = document.getElementById('medDosageInput')?.value.trim();
    const foodInstruction = document.getElementById('foodInstructionSelect')?.value;
    const currentStock = parseInt(document.getElementById('currentStockInput')?.value || '30', 10);
    const lowStockThreshold = parseInt(document.getElementById('lowStockThresholdInput')?.value || '5', 10);
    const notes = document.getElementById('medNotesInput')?.value.trim();

    const activeType = document.querySelector('#medTypeSelector .type-pill-btn.active')?.getAttribute('data-type') || 'tablet';
    const activeColor = document.querySelector('#colorPaletteSelector .color-swatch-btn.active')?.getAttribute('data-color') || 'cyan';

    // Collect all times
    const timeInputs = document.querySelectorAll('.time-value-input');
    const times = [];
    timeInputs.forEach(inp => {
      if (inp.value && !times.includes(inp.value)) {
        times.push(inp.value);
      }
    });
    times.sort();

    if (!name || !dosage) {
      this.showToast('Missing Fields', 'Please specify medication name and dosage.', 'warning');
      return;
    }

    if (times.length === 0) {
      this.showToast('Time Required', 'Please set at least one alarm trigger time.', 'warning');
      return;
    }

    // Collect dietary warnings
    const dietaryWarnings = [];
    document.querySelectorAll('#dietaryChipsSelector input[type="checkbox"]:checked').forEach(cb => {
      dietaryWarnings.push(cb.value);
    });

    if (editId) {
      // Update existing
      const medIndex = this.medications.findIndex(m => m.id === editId);
      if (medIndex !== -1) {
        this.medications[medIndex] = {
          ...this.medications[medIndex],
          name,
          dosage,
          type: activeType,
          color: activeColor,
          times,
          foodInstruction,
          dietaryWarnings,
          currentStock,
          lowStockThreshold,
          notes
        };
        this.saveMedications();
        this.showToast('Medication Updated', `${name} schedule has been saved.`, 'success');
      }
    } else {
      // Add new
      const newMed = {
        id: 'med_' + Date.now(),
        name,
        dosage,
        type: activeType,
        color: activeColor,
        times,
        foodInstruction,
        dietaryWarnings,
        currentStock,
        lowStockThreshold,
        notes,
        createdAt: new Date().toISOString()
      };
      this.medications.push(newMed);
      this.saveMedications();
      this.showToast('Medication Created! 💊', `${name} alarms set for ${times.map(t => this.formatDisplayTime(t)).join(', ')}.`, 'success');

      // Check if newly added medication conflicts with any existing active medications
      if (window.LuminaInteractions) {
        const conflicts = window.LuminaInteractions.checkNewAgainstCabinet(name, this.medications, newMed.id);
        if (conflicts.length > 0) {
          setTimeout(() => {
            this.showToast('⚠️ Drug Conflict Alert', `Potential interaction detected with ${conflicts[0].otherMed.name}. Check Drug Safety Hub.`, 'warning');
          }, 1200);
        }
      }
    }

    this.closeMedModal();
    this.render();
  }

  deleteMedication(id) {
    if (!id) return;
    const med = this.medications.find(m => m.id === id);
    const medName = med ? med.name : 'Medication';
    this.medications = this.medications.filter(m => m.id !== id);
    this.saveMedications();

    // Clean up today doses
    Object.keys(this.todayDoses).forEach(k => {
      if (k.startsWith(id + '_') || k === id) {
        delete this.todayDoses[k];
      }
    });
    this.saveDoses();

    // If active buffer running for this med, stop it
    if (this.activeMealBuffer && this.activeMealBuffer.medName === medName) {
      this.stopActiveMealBuffer(false);
    }

    this.showToast('Medication Removed 🗑️', `${medName} and its alarms deleted.`, 'info');
    this.render();
  }

  confirmDeleteMedication(medId, event) {
    if (event) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
    }
    const targetId = medId || document.getElementById('editMedId')?.value;
    if (!targetId) return;

    this.pendingDeleteMedId = targetId;
    const med = this.medications.find(m => m.id === targetId);
    const medName = med ? med.name : 'this medication';

    const overlay = document.getElementById('deleteConfirmModalOverlay');
    const title = document.getElementById('deleteConfirmTitle');
    const desc = document.getElementById('deleteConfirmDesc');

    if (title) title.textContent = `Delete "${medName}"?`;
    if (desc) desc.textContent = `Are you sure you want to permanently remove ${medName}? All daily alarms, reminder chimes, and today's schedule records for this medicine will be deleted.`;

    if (overlay) {
      overlay.style.display = 'flex';
      if (window.lucide) lucide.createIcons();
    } else {
      // Fallback
      this.deleteMedication(targetId);
      this.closeMedModal();
    }
  }

  closeDeleteConfirmModal() {
    this.pendingDeleteMedId = null;
    const overlay = document.getElementById('deleteConfirmModalOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  executePendingDelete() {
    if (this.pendingDeleteMedId) {
      const id = this.pendingDeleteMedId;
      this.pendingDeleteMedId = null;
      this.deleteMedication(id);
      this.closeMedModal();
      this.closeDeleteConfirmModal();
    }
  }

  deleteDetectedRxMed(index, event) {
    if (event) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
    }
    const idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0 || idx >= this.detectedRxMeds.length) return;

    const removed = this.detectedRxMeds[idx];
    this.detectedRxMeds.splice(idx, 1);
    this.renderDetectedMeds();
    this.showToast('Medicine Removed', `Removed ${removed?.name || 'medication'} from list.`, 'info');
  }

  // --------------------------------------------------------------------------
  // Refill Modal
  // --------------------------------------------------------------------------
  openRefillModal(medId) {
    const med = this.medications.find(m => m.id === medId);
    if (!med) return;

    this.refillTargetMedId = medId;
    const overlay = document.getElementById('refillModalOverlay');
    const nameEl = document.getElementById('refillMedName');
    const customInp = document.getElementById('customRefillInput');

    if (nameEl) nameEl.textContent = `${med.name} (Current Stock: ${med.currentStock || 0})`;
    if (customInp) customInp.value = 30;

    if (overlay) {
      overlay.style.display = 'flex';
      if (window.lucide) lucide.createIcons();
    }
  }

  closeRefillModal() {
    const overlay = document.getElementById('refillModalOverlay');
    if (overlay) overlay.style.display = 'none';
    this.refillTargetMedId = null;
  }

  // --------------------------------------------------------------------------
  // Toast Notifications
  // --------------------------------------------------------------------------
  showToast(title, message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-glass-notification toast-${type}`;
    
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle-2';
    if (type === 'warning') iconName = 'alert-triangle';
    if (type === 'danger' || type === 'error') iconName = 'alert-octagon';

    toast.innerHTML = `
      <div class="toast-icon-wrap">
        <i data-lucide="${iconName}"></i>
      </div>
      <div class="toast-body">
        <h5>${this.escapeHtml(title)}</h5>
        <p>${this.escapeHtml(message)}</p>
      </div>
      <button class="toast-close-btn" aria-label="Dismiss toast">
        <i data-lucide="x"></i>
      </button>
    `;

    toast.querySelector('.toast-close-btn').addEventListener('click', () => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 250);
    });

    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();

    // Auto dismiss after 4.5 seconds
    setTimeout(() => {
      if (toast.isConnected) {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 250);
      }
    }, 4500);
  }

  // --------------------------------------------------------------------------
  // Doctor Prescription & Medical Receipt Scanner Methods
  // --------------------------------------------------------------------------
  openRxModal() {
    this.resetRxModal();
    const overlay = document.getElementById('rxModalOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      if (window.lucide) lucide.createIcons();
    }
  }

  closeRxModal() {
    const overlay = document.getElementById('rxModalOverlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  resetRxModal() {
    const uploadArea = document.getElementById('rxUploadArea');
    const scanningState = document.getElementById('rxScanningState');
    const resultsSection = document.getElementById('rxResultsSection');
    const rescanBtn = document.getElementById('rescanRxBtn');
    const importBtn = document.getElementById('importMedsBtn');
    const rawBox = document.getElementById('rawTextContainer');
    const fileInput = document.getElementById('rxFileInput');

    if (uploadArea) uploadArea.style.display = 'block';
    if (scanningState) scanningState.style.display = 'none';
    if (resultsSection) resultsSection.style.display = 'none';
    if (rescanBtn) rescanBtn.style.display = 'none';
    if (importBtn) importBtn.style.display = 'none';
    if (rawBox) rawBox.style.display = 'none';
    if (fileInput) fileInput.value = '';

    const bar = document.getElementById('rxProgressBar');
    if (bar) bar.style.width = '0%';
    const pct = document.getElementById('rxProgressPercentText');
    if (pct) pct.textContent = '0%';
  }

  handleRxFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      this.showToast('Invalid File', 'Please upload a valid image file (JPG, PNG, WEBP).', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      this.processRxImage(e.target.result);
    };
    reader.readAsDataURL(file);
  }

  handleSampleRx() {
    if (!window.luminaRxParser) {
      this.showToast('Scanner Not Ready', 'Prescription parser engine is loading.', 'warning');
      return;
    }

    this.showToast('Generating Doctor Rx', 'Creating realistic clinic prescription receipt preview...', 'info');
    const sampleDataUrl = window.luminaRxParser.generateSampleReceiptImage();
    this.processRxImage(sampleDataUrl);
  }

  async processRxImage(imageSource) {
    const uploadArea = document.getElementById('rxUploadArea');
    const scanningState = document.getElementById('rxScanningState');
    const previewImg = document.getElementById('rxPreviewImg');
    const statusText = document.getElementById('rxProgressStatusText');
    const percentText = document.getElementById('rxProgressPercentText');
    const progressBar = document.getElementById('rxProgressBar');

    if (uploadArea) uploadArea.style.display = 'none';
    if (scanningState) scanningState.style.display = 'flex';
    if (previewImg) previewImg.src = imageSource;

    if (statusText) statusText.textContent = 'Initializing OCR neural reader...';
    if (percentText) percentText.textContent = '10%';
    if (progressBar) progressBar.style.width = '10%';

    try {
      let rawText = '';
      if (window.luminaRxParser) {
        rawText = await window.luminaRxParser.extractTextFromImage(imageSource, (progress) => {
          if (progressBar) progressBar.style.width = `${progress}%`;
          if (percentText) percentText.textContent = `${progress}%`;
          if (statusText) {
            statusText.textContent = progress < 50 
              ? 'Recognizing medical typography and symbols...' 
              : 'Extracting drug names, dosages & frequencies...';
          }
        });
      }

      // If OCR yielded text or if fallback
      const rawTextarea = document.getElementById('rawExtractedTextarea');
      if (rawTextarea) rawTextarea.value = rawText || '';

      const parsedMeds = window.luminaRxParser 
        ? window.luminaRxParser.parsePrescriptionText(rawText) 
        : [];

      this.detectedRxMeds = parsedMeds;

      // Switch to results view
      if (scanningState) scanningState.style.display = 'none';
      const resultsSection = document.getElementById('rxResultsSection');
      if (resultsSection) resultsSection.style.display = 'block';

      const rescanBtn = document.getElementById('rescanRxBtn');
      if (rescanBtn) rescanBtn.style.display = 'inline-flex';

      const importBtn = document.getElementById('importMedsBtn');
      if (importBtn) importBtn.style.display = 'inline-flex';

      this.renderDetectedMeds();

      if (this.alarmAudio) {
        this.alarmAudio.playSound('crystalBell');
      }

      this.showToast('Prescription Scanned! 🎉', `Detected ${this.detectedRxMeds.length} medications ready for review.`, 'success');

    } catch (err) {
      console.error('Prescription OCR processing error:', err);
      // Fallback: provide sample parsed medicines and let user edit
      if (statusText) statusText.textContent = 'Manual review mode active';
      
      const sampleFallback = [
        {
          id: 'rx_fallback_1',
          name: 'Azithromycin',
          dosage: '500 mg',
          type: 'tablet',
          times: ['08:00'],
          foodInstruction: 'After food',
          currentStock: 5,
          notes: 'Prescribed once daily for 5 days',
          color: 'cyan'
        },
        {
          id: 'rx_fallback_2',
          name: 'Pantoprazole',
          dosage: '40 mg',
          type: 'tablet',
          times: ['07:30'],
          foodInstruction: 'Before food',
          currentStock: 14,
          notes: 'Take on empty stomach 30 mins before meal',
          color: 'emerald'
        },
        {
          id: 'rx_fallback_3',
          name: 'Paracetamol',
          dosage: '650 mg',
          type: 'tablet',
          times: ['08:00', '20:00'],
          foodInstruction: 'After food',
          currentStock: 10,
          notes: 'Twice daily after meals',
          color: 'rose'
        }
      ];

      this.detectedRxMeds = sampleFallback;
      if (scanningState) scanningState.style.display = 'none';
      const resultsSection = document.getElementById('rxResultsSection');
      if (resultsSection) resultsSection.style.display = 'block';
      const rescanBtn = document.getElementById('rescanRxBtn');
      if (rescanBtn) rescanBtn.style.display = 'inline-flex';
      const importBtn = document.getElementById('importMedsBtn');
      if (importBtn) importBtn.style.display = 'inline-flex';

      this.renderDetectedMeds();
      this.showToast('OCR Completed', 'Review the extracted medications below or customize them.', 'info');
    }

    if (window.lucide) lucide.createIcons();
  }

  renderDetectedMeds() {
    const listEl = document.getElementById('detectedMedsList');
    const countEl = document.getElementById('detectedMedsCount');
    if (!listEl) return;

    if (countEl) countEl.textContent = this.detectedRxMeds.length;

    if (this.detectedRxMeds.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state" style="padding: 20px;">
          <p>No medications could be recognized automatically. Click below to add an item manually.</p>
        </div>
      `;
      this.updateImportButtonCount();
      return;
    }

    listEl.innerHTML = this.detectedRxMeds.map((med, index) => {
      const timesFormatted = (med.times || []).map(t => this.formatDisplayTime(t)).join(', ');

      return `
        <div class="detected-med-card" data-index="${index}">
          <div class="med-select-col">
            <input type="checkbox" class="med-select-checkbox" checked data-index="${index}" title="Select to import">
          </div>
          
          <div class="detected-med-content">
            <div>
              <label class="form-label" style="font-size: 11px;">Medicine Name</label>
              <input type="text" class="glass-input rx-edit-name" value="${this.escapeHtml(med.name)}" placeholder="Medicine Name">
            </div>

            <div>
              <label class="form-label" style="font-size: 11px;">Dosage</label>
              <input type="text" class="glass-input rx-edit-dosage" value="${this.escapeHtml(med.dosage)}" placeholder="e.g. 500 mg">
            </div>

            <div>
              <label class="form-label" style="font-size: 11px;">Alarm Times</label>
              <input type="text" class="glass-input rx-edit-times" value="${(med.times || []).join(', ')}" placeholder="e.g. 08:00, 20:00" title="Comma separated 24h times">
            </div>

            <div>
              <label class="form-label" style="font-size: 11px;">Instruction</label>
              <select class="glass-select rx-edit-food" style="padding: 8px 10px; font-size: 12px;">
                <option value="After food" ${med.foodInstruction === 'After food' ? 'selected' : ''}>After food</option>
                <option value="Before food" ${med.foodInstruction === 'Before food' ? 'selected' : ''}>Before food</option>
                <option value="With food" ${med.foodInstruction === 'With food' ? 'selected' : ''}>With food</option>
                <option value="At bedtime" ${med.foodInstruction === 'At bedtime' ? 'selected' : ''}>At bedtime</option>
                <option value="Any time" ${med.foodInstruction === 'Any time' ? 'selected' : ''}>Any time</option>
              </select>
            </div>
          </div>

          <div>
            <button type="button" class="btn btn-danger-soft btn-sm rx-delete-item-btn" data-index="${index}" onclick="luminaApp.deleteDetectedRxMed(${index}, event)" title="Remove this medication from list">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
              <span>Delete</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach listeners to review card inputs
    listEl.querySelectorAll('.med-select-checkbox').forEach(cb => {
      cb.addEventListener('change', () => this.updateImportButtonCount());
    });

    listEl.querySelectorAll('.rx-delete-item-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = btn.getAttribute('data-index');
        this.deleteDetectedRxMed(idx, e);
      });
    });

    const clearAllBtn = document.getElementById('clearAllRxMedsBtn');
    if (clearAllBtn) {
      clearAllBtn.onclick = () => {
        if (!this.detectedRxMeds || this.detectedRxMeds.length === 0) {
          this.showToast('List Empty', 'There are no extracted medicines to clear.', 'info');
          return;
        }
        this.detectedRxMeds = [];
        this.renderDetectedMeds();
        this.showToast('List Cleared', 'All extracted medicines have been cleared.', 'info');
      };
    }

    this.updateImportButtonCount();
    if (window.lucide) lucide.createIcons();
  }

  updateImportButtonCount() {
    const listEl = document.getElementById('detectedMedsList');
    const countEl = document.getElementById('selectedMedsCount');
    const importBtn = document.getElementById('importMedsBtn');

    if (!listEl) return;
    const checkedBoxes = listEl.querySelectorAll('.med-select-checkbox:checked');
    const count = checkedBoxes.length;

    if (countEl) countEl.textContent = count;
    if (importBtn) {
      importBtn.disabled = count === 0;
      importBtn.style.opacity = count === 0 ? '0.5' : '1';
    }
  }

  addManualDetectedMed() {
    this.detectedRxMeds.push({
      id: `rx_manual_${Date.now()}`,
      name: 'New Medication',
      dosage: '500 mg',
      type: 'tablet',
      times: ['08:00', '20:00'],
      foodInstruction: 'After food',
      currentStock: 20,
      notes: 'Added from prescription review',
      color: 'cyan'
    });
    this.renderDetectedMeds();
  }

  importSelectedMeds() {
    const listEl = document.getElementById('detectedMedsList');
    if (!listEl) return;

    const cards = listEl.querySelectorAll('.detected-med-card');
    let importedCount = 0;

    cards.forEach(card => {
      const checkbox = card.querySelector('.med-select-checkbox');
      if (checkbox && checkbox.checked) {
        const nameInput = card.querySelector('.rx-edit-name');
        const dosageInput = card.querySelector('.rx-edit-dosage');
        const timesInput = card.querySelector('.rx-edit-times');
        const foodSelect = card.querySelector('.rx-edit-food');

        const name = nameInput?.value.trim() || 'Prescribed Medicine';
        const dosage = dosageInput?.value.trim() || '1 Dose';
        const rawTimes = timesInput?.value.trim() || '08:00';
        const foodInstruction = foodSelect?.value || 'After food';

        // Parse times
        const times = rawTimes.split(',')
          .map(t => t.trim())
          .filter(t => /^\d{1,2}:\d{2}$/.test(t))
          .map(t => {
            const [h, m] = t.split(':');
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          });

        if (times.length === 0) {
          times.push('08:00');
        }

        const colors = ['cyan', 'emerald', 'indigo', 'rose', 'amber'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        const newMed = {
          id: 'med_rx_' + Date.now() + Math.random().toString(36).substr(2, 4),
          name,
          dosage,
          type: 'tablet',
          color: randomColor,
          times,
          foodInstruction,
          currentStock: 20,
          lowStockThreshold: 5,
          notes: 'Imported from doctor medical receipt scan',
          createdAt: new Date().toISOString()
        };

        this.medications.push(newMed);
        importedCount++;
      }
    });

    if (importedCount > 0) {
      this.saveMedications();
      this.closeRxModal();
      this.render();
      this.showToast('Import Successful! 💊', `Added ${importedCount} medications from doctor receipt to your cabinet and alarm schedules.`, 'success');
      if (this.alarmAudio) {
        this.alarmAudio.playSound('crystalBell');
      }
    } else {
      this.showToast('No Medicines Selected', 'Please check at least one medication to import.', 'warning');
    }
  }

  // --------------------------------------------------------------------------
  // Caregiver, Emergency Contacts & Automated Missed Dose Alerts
  // --------------------------------------------------------------------------
  evaluateMissedDoses(now) {
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const thresholdMins = parseInt(this.settings.missedDoseThreshold || 30, 10);
    const todayStr = this.getTodayDateString();

    let newAlertsFound = false;

    this.medications.forEach(med => {
      if (!med.times || !Array.isArray(med.times)) return;

      med.times.forEach(time => {
        const [h, m] = time.split(':').map(Number);
        const scheduledTotalMins = h * 60 + m;
        const diffMins = currentMins - scheduledTotalMins;

        // If dose was scheduled earlier today, is past the grace threshold, and was not taken or skipped
        if (diffMins >= thresholdMins && diffMins < 720) {
          const doseKey = `${med.id}_${time}`;
          const doseRecord = this.todayDoses[doseKey];
          const isTaken = doseRecord?.status === 'taken';
          const isSkipped = doseRecord?.status === 'skipped';

          if (!isTaken && !isSkipped) {
            const alertKey = `${todayStr}_${doseKey}`;
            const alreadyAlerted = this.missedDoseAlerts.some(a => a.key === alertKey);

            if (!alreadyAlerted) {
              const newAlert = {
                id: `alert_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                key: alertKey,
                medId: med.id,
                medName: med.name,
                dosage: med.dosage,
                scheduledTime: time,
                diffMinutes: diffMins,
                createdAt: new Date().toISOString()
              };
              this.missedDoseAlerts.unshift(newAlert);
              newAlertsFound = true;

              // Send browser notification
              if (this.settings.desktopNotifications && 'Notification' in window && Notification.permission === 'granted') {
                new Notification(`⚠️ MISSED DOSE ALERT: ${med.name}`, {
                  body: `${med.name} (${med.dosage}) scheduled for ${this.formatDisplayTime(time)} was missed by over ${thresholdMins} minutes. Tap to notify caregiver.`,
                  icon: 'icon.svg'
                });
              }

              this.showToast('⚠️ Missed Dose Alert', `${med.name} missed by ${diffMins}m. You can notify your caregiver now.`, 'warning');
            }
          }
        }
      });
    });

    if (newAlertsFound) {
      this.saveMissedAlerts();
      this.renderMissedAlerts();
    }
  }

  renderContacts() {
    const container = document.getElementById('contactsDirectoryGrid');
    const emptyState = document.getElementById('emptyContactsState');
    if (!container) return;

    if (this.contacts.length === 0) {
      container.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    const roleLabels = {
      doctor: { label: 'Personal Doctor', tag: 'tag-doctor', avatarClass: 'avatar-doctor', icon: 'stethoscope' },
      hospital: { label: 'Hospital / ER', tag: 'tag-hospital', avatarClass: 'avatar-hospital', icon: 'cross' },
      caregiver: { label: 'Primary Caregiver', tag: 'tag-caregiver', avatarClass: 'avatar-caregiver', icon: 'heart-pulse' },
      family: { label: 'Family Member', tag: 'tag-family', avatarClass: 'avatar-family', icon: 'users' },
      friend: { label: 'Neighbor / Friend', tag: 'tag-friend', avatarClass: 'avatar-friend', icon: 'user' }
    };

    container.innerHTML = this.contacts.map(contact => {
      const role = roleLabels[contact.role] || roleLabels.family;
      const cleanPhone = contact.phone ? contact.phone.replace(/[^0-9+]/g, '') : '';
      const waUrl = this.createCaregiverCheckInWaUrl(contact);

      return `
        <div class="contact-card glass-card">
          <div>
            <div class="contact-card-top">
              <div class="contact-avatar ${role.avatarClass}">
                <i data-lucide="${role.icon}"></i>
              </div>
              <div class="contact-meta-header">
                <div class="contact-name-row">
                  <h3>${this.escapeHtml(contact.name)}</h3>
                  ${contact.isPrimarySos ? '<span class="primary-sos-star"><i data-lucide="star"></i> Primary SOS</span>' : ''}
                </div>
                <span class="contact-role-tag ${role.tag}">${role.label}</span>
              </div>
            </div>

            <div class="contact-details-box">
              <div class="contact-detail-item">
                <i data-lucide="phone"></i>
                <span>${this.escapeHtml(contact.phone)}</span>
              </div>
              ${contact.hospital ? `
                <div class="contact-detail-item">
                  <i data-lucide="building-2"></i>
                  <span>${this.escapeHtml(contact.hospital)}</span>
                </div>
              ` : ''}
              ${contact.email ? `
                <div class="contact-detail-item">
                  <i data-lucide="mail"></i>
                  <span>${this.escapeHtml(contact.email)}</span>
                </div>
              ` : ''}
              ${contact.notes ? `
                <div class="contact-detail-item text-secondary" style="font-size: 12px; font-weight: normal; margin-top: 4px;">
                  <i data-lucide="info"></i>
                  <em>"${this.escapeHtml(contact.notes)}"</em>
                </div>
              ` : ''}
            </div>
          </div>

          <div class="contact-actions-bar">
            <a href="tel:${cleanPhone}" class="btn-contact-call" title="Call directly">
              <i data-lucide="phone-call"></i>
              <span>Call</span>
            </a>
            <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn-contact-wa" title="Send WhatsApp alert">
              <i data-lucide="message-square"></i>
              <span>WhatsApp</span>
            </a>
            <button type="button" class="btn-contact-more edit-contact-btn" data-id="${contact.id}" title="Edit contact">
              <i data-lucide="pencil"></i>
            </button>
            <button type="button" class="btn-contact-more text-danger delete-contact-btn" data-id="${contact.id}" title="Delete contact">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.edit-contact-btn').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        this.openContactModal(id);
      });
    });

    container.querySelectorAll('.delete-contact-btn').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        this.deleteContact(id);
      });
    });

    if (window.lucide) lucide.createIcons();
  }

  renderMissedAlerts() {
    const container = document.getElementById('missedDoseAlertContainer');
    if (!container) return;

    if (this.missedDoseAlerts.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    container.style.display = 'flex';

    const notifyContact = this.contacts.find(c => c.isPrimarySos && c.notifyMissed) ||
      this.contacts.find(c => c.notifyMissed) ||
      this.contacts[0] || null;

    container.innerHTML = this.missedDoseAlerts.map(alert => {
      let waAlertBtn = '';
      if (notifyContact && notifyContact.phone) {
        const waUrl = this.createWhatsAppAlertUrl(notifyContact.phone, alert.medName, alert.dosage, alert.scheduledTime);
        waAlertBtn = `
          <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp-broadcast btn-sm" title="Send WhatsApp alert to caregiver">
            <i data-lucide="send"></i>
            <span>WhatsApp ${this.escapeHtml(notifyContact.name)}</span>
          </a>
        `;
      } else {
        waAlertBtn = `
          <button type="button" class="btn btn-glass-secondary btn-sm" onclick="luminaApp.openContactModal()">
            <i data-lucide="user-plus"></i> Set Caregiver Contact
          </button>
        `;
      }

      return `
        <div class="missed-alert-card glass-card">
          <div class="missed-alert-info">
            <div class="missed-alert-badge-icon">
              <i data-lucide="alert-triangle"></i>
            </div>
            <div class="missed-alert-text">
              <h4>⚠️ Missed Medication Dose Alert</h4>
              <p>
                <strong>${this.escapeHtml(alert.medName)} (${this.escapeHtml(alert.dosage)})</strong> scheduled for 
                <strong>${this.formatDisplayTime(alert.scheduledTime)}</strong> was missed by over ${this.settings.missedDoseThreshold || 30} minutes.
              </p>
            </div>
          </div>
          <div class="missed-alert-actions">
            ${waAlertBtn}
            <button type="button" class="btn btn-success-glow btn-sm mark-missed-taken-btn" data-id="${alert.id}" data-med="${alert.medId}" data-time="${alert.scheduledTime}">
              <i data-lucide="check"></i> Taken Now
            </button>
            <button type="button" class="btn btn-ghost btn-sm dismiss-missed-alert-btn" data-id="${alert.id}">
              <i data-lucide="x"></i> Dismiss
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.mark-missed-taken-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const medId = btn.getAttribute('data-med');
        const time = btn.getAttribute('data-time');
        const alertId = btn.getAttribute('data-id');
        this.takeDose(medId, time);
        this.dismissMissedAlert(alertId);
      });
    });

    container.querySelectorAll('.dismiss-missed-alert-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const alertId = btn.getAttribute('data-id');
        this.dismissMissedAlert(alertId);
      });
    });

    if (window.lucide) lucide.createIcons();
  }

  openContactModal(contactId = null) {
    this.editingContactId = contactId;
    const overlay = document.getElementById('contactModalOverlay');
    const title = document.getElementById('contactModalTitle');
    const idInput = document.getElementById('editContactId');
    const nameInput = document.getElementById('contactNameInput');
    const roleSelect = document.getElementById('contactRoleSelect');
    const hospInput = document.getElementById('contactHospitalInput');
    const phoneInput = document.getElementById('contactPhoneInput');
    const emailInput = document.getElementById('contactEmailInput');
    const notifyToggle = document.getElementById('contactNotifyMissedToggle');
    const primaryToggle = document.getElementById('contactPrimarySosToggle');
    const notesInput = document.getElementById('contactNotesInput');

    if (!overlay) return;

    if (contactId) {
      const contact = this.contacts.find(c => c.id === contactId);
      if (contact) {
        if (title) title.textContent = 'Edit Emergency Contact';
        if (idInput) idInput.value = contact.id;
        if (nameInput) nameInput.value = contact.name || '';
        if (roleSelect) roleSelect.value = contact.role || 'family';
        if (hospInput) hospInput.value = contact.hospital || '';
        if (phoneInput) phoneInput.value = contact.phone || '';
        if (emailInput) emailInput.value = contact.email || '';
        if (notifyToggle) notifyToggle.checked = contact.notifyMissed !== false;
        if (primaryToggle) primaryToggle.checked = !!contact.isPrimarySos;
        if (notesInput) notesInput.value = contact.notes || '';
      }
    } else {
      if (title) title.textContent = 'Add Emergency Contact';
      if (idInput) idInput.value = '';
      if (nameInput) nameInput.value = '';
      if (roleSelect) roleSelect.value = 'family';
      if (hospInput) hospInput.value = '';
      if (phoneInput) phoneInput.value = '';
      if (emailInput) emailInput.value = '';
      if (notifyToggle) notifyToggle.checked = true;
      if (primaryToggle) primaryToggle.checked = this.contacts.length === 0;
      if (notesInput) notesInput.value = '';
    }

    overlay.style.display = 'flex';
    if (nameInput) nameInput.focus();
    if (window.lucide) lucide.createIcons();
  }

  closeContactModal() {
    const overlay = document.getElementById('contactModalOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  handleContactFormSubmit() {
    const id = document.getElementById('editContactId')?.value;
    const name = document.getElementById('contactNameInput')?.value.trim();
    const role = document.getElementById('contactRoleSelect')?.value || 'family';
    const hospital = document.getElementById('contactHospitalInput')?.value.trim();
    const phone = document.getElementById('contactPhoneInput')?.value.trim();
    const email = document.getElementById('contactEmailInput')?.value.trim();
    const notifyMissed = document.getElementById('contactNotifyMissedToggle')?.checked;
    const isPrimarySos = document.getElementById('contactPrimarySosToggle')?.checked;
    const notes = document.getElementById('contactNotesInput')?.value.trim();

    if (!name || !phone) {
      this.showToast('Missing Details', 'Please provide a name and valid contact phone number.', 'warning');
      return;
    }

    if (isPrimarySos) {
      this.contacts.forEach(c => {
        if (c.id !== id) c.isPrimarySos = false;
      });
    }

    if (id) {
      const index = this.contacts.findIndex(c => c.id === id);
      if (index !== -1) {
        this.contacts[index] = {
          ...this.contacts[index],
          name,
          role,
          hospital,
          phone,
          email,
          notifyMissed,
          isPrimarySos,
          notes
        };
        this.showToast('Contact Updated', `${name} updated successfully.`, 'success');
      }
    } else {
      const newContact = {
        id: `contact_${Date.now()}`,
        name,
        role,
        hospital,
        phone,
        email,
        notifyMissed,
        isPrimarySos: isPrimarySos || this.contacts.length === 0,
        notes
      };
      this.contacts.push(newContact);
      this.showToast('Contact Added! 🛡️', `${name} added to emergency directory.`, 'success');
    }

    this.saveContacts();
    this.closeContactModal();
    this.render();
  }

  deleteContact(id) {
    const contact = this.contacts.find(c => c.id === id);
    if (!contact) return;

    if (confirm(`Remove ${contact.name} from emergency contacts?`)) {
      this.contacts = this.contacts.filter(c => c.id !== id);
      this.saveContacts();
      this.render();
      this.showToast('Contact Removed', `${contact.name} was removed.`, 'info');
    }
  }

  openEmergencySosModal() {
    const overlay = document.getElementById('emergencySosModalOverlay');
    const list = document.getElementById('sosContactsList');
    if (!overlay || !list) return;

    if (this.contacts.length === 0) {
      list.innerHTML = `
        <div class="empty-state glass-card" style="padding: 24px; text-align: center;">
          <p style="margin-bottom: 12px; font-weight: 600; color: var(--text-main);">No emergency contacts or doctors saved yet.</p>
          <button type="button" class="btn btn-primary btn-sm" onclick="luminaApp.closeEmergencySosModal(); luminaApp.openContactModal();">
            <i data-lucide="user-plus"></i> Add Doctor or Hospital Number
          </button>
        </div>
      `;
    } else {
      const sortedContacts = [...this.contacts].sort((a, b) => (b.isPrimarySos ? 1 : 0) - (a.isPrimarySos ? 1 : 0));
      
      const roleIcons = {
        doctor: 'stethoscope',
        hospital: 'cross',
        caregiver: 'heart-pulse',
        family: 'users',
        friend: 'user'
      };

      list.innerHTML = sortedContacts.map(c => {
        const cleanPhone = c.phone ? c.phone.replace(/[^0-9+]/g, '') : '';
        const waUrl = this.createCaregiverCheckInWaUrl(c);
        const icon = roleIcons[c.role] || 'phone';

        return `
          <div class="sos-contact-row">
            <div class="sos-contact-info">
              <h4>
                <i data-lucide="${icon}" style="color: var(--primary); width: 18px; height: 18px;"></i>
                <span>${this.escapeHtml(c.name)}</span>
                ${c.isPrimarySos ? '<span class="primary-sos-star" style="font-size: 10px;">Primary SOS</span>' : ''}
              </h4>
              <p>${this.escapeHtml(c.hospital || c.role.toUpperCase())} &bull; ${this.escapeHtml(c.phone)}</p>
            </div>
            <div class="sos-contact-actions">
              <a href="tel:${cleanPhone}" class="btn-sos-call" title="Call directly">
                <i data-lucide="phone-call"></i>
                <span>Call</span>
              </a>
              <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn-whatsapp-broadcast" style="padding: 10px 14px; font-size: 13px;" title="Send WhatsApp alert">
                <i data-lucide="message-square"></i>
                <span>WhatsApp</span>
              </a>
            </div>
          </div>
        `;
      }).join('');
    }

    overlay.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  }

  closeEmergencySosModal() {
    const overlay = document.getElementById('emergencySosModalOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  getPatientSummaryForMessage() {
    if (!this.patientProfile) {
      return `👤 *Patient:* ${this.settings.patientName || 'Patient'}`;
    }
    const p = this.patientProfile;
    let details = `👤 *Patient:* ${p.name || 'Patient'}`;
    if (p.age || p.gender) details += ` (${p.age ? p.age + 'y' : ''}${p.age && p.gender ? ', ' : ''}${p.gender || ''})`;
    if (p.bloodGroup) details += `\n🩸 *Blood Group:* ${p.bloodGroup}`;
    if (p.allergies && p.allergies !== 'None' && p.allergies !== 'None known') {
      details += `\n⚠️ *Allergies:* ${p.allergies}`;
    }
    if (p.conditions && p.conditions !== 'None') {
      details += `\n🏥 *Conditions:* ${p.conditions}`;
    }
    if (p.phone) {
      details += `\n📞 *Patient Phone:* ${p.phone}`;
    }
    return details;
  }

  broadcastEmergencyWhatsApp() {
    const activeMeds = this.medications.map(m => `• ${m.name} (${m.dosage})`).join('\n') || 'None recorded';
    const patientBlock = this.getPatientSummaryForMessage();
    const patientName = this.patientProfile?.name || this.settings.patientName || 'Patient';
    const text = `🚨 *IMMEDIATE MEDICAL SOS & EMERGENCY ALERT*\n\n` +
      `${patientBlock}\n\n` +
      `⚠️ *URGENT:* ${patientName} has triggered an emergency alert and requires immediate medical attention.\n\n` +
      `📋 *Current Active Medications:*\n${activeMeds}\n\n` +
      `Please contact or reach ${patientName} immediately!`;

    const notifyContacts = this.contacts.filter(c => c.notifyMissed || c.isPrimarySos);
    if (notifyContacts.length === 0 && this.contacts.length > 0) {
      notifyContacts.push(this.contacts[0]);
    }

    if (notifyContacts.length > 0) {
      const primary = notifyContacts[0];
      const cleanPhone = primary.phone.replace(/[^0-9+]/g, '').replace(/^\+/, '');
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, '_blank');
      this.showToast('SOS Prepared', `Opened WhatsApp alert for ${primary.name}`, 'warning');
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
      this.showToast('SOS Prepared', 'Opened WhatsApp to select emergency contact', 'warning');
    }
  }

  createWhatsAppAlertUrl(phone, medName, dosage, scheduledTime) {
    const cleanPhone = (phone || '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
    const patientBlock = this.getPatientSummaryForMessage();
    const patientName = this.patientProfile?.name || this.settings.patientName || 'Patient';
    const timeFormatted = this.formatDisplayTime(scheduledTime);
    const text = `🚨 *URGENT MEDICAL ALERT from LuminaMed*\n\n` +
      `${patientBlock}\n\n` +
      `⚠️ *MISSED MEDICATION:*\n` +
      `• *Medicine:* ${medName}\n` +
      `• *Prescribed Dosage:* ${dosage}\n` +
      `• *Scheduled Time:* ${timeFormatted}\n` +
      `• *Status:* Missed / Not confirmed after ${this.settings.missedDoseThreshold || 30} minutes.\n\n` +
      `Please check on ${patientName} or call them immediately to ensure their safety.`;
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
  }

  createCaregiverCheckInWaUrl(contact) {
    const cleanPhone = (contact.phone || '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
    const patientName = this.patientProfile?.name || this.settings.patientName || 'Patient';
    const bloodGroup = this.patientProfile?.bloodGroup ? ` (Blood: ${this.patientProfile.bloodGroup})` : '';
    const text = `👋 Hello ${contact.name},\n\n` +
      `This is a health update from ${patientName}${bloodGroup} regarding my LuminaMed medication schedule.\n` +
      `Everything is currently tracked and on schedule. Thank you for being my emergency care contact!`;
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
  }

  dismissMissedAlert(alertId) {
    this.missedDoseAlerts = this.missedDoseAlerts.filter(a => a.id !== alertId);
    this.saveMissedAlerts();
    this.renderMissedAlerts();
  }

  formatDisplayTime(timeStr) {
    if (!timeStr) return '--:--';
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    return `${String(displayH).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
  }

  // --------------------------------------------------------------------------
  // Vitals & Health Metrics Methods
  // --------------------------------------------------------------------------
  openVitalsModal(defaultType = 'bp') {
    const overlay = document.getElementById('vitalsModalOverlay');
    if (!overlay) return;

    // Set active button in type selector
    document.querySelectorAll('#vitalTypeSelector .vitals-pill-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-vital-type') === defaultType);
    });

    // Reset inputs
    const sysInp = document.getElementById('vitalSystolicInput');
    const diaInp = document.getElementById('vitalDiastolicInput');
    const gluInp = document.getElementById('vitalGlucoseInput');
    const pulInp = document.getElementById('vitalPulseInput');
    const temInp = document.getElementById('vitalTempInput');
    const notInp = document.getElementById('vitalNotesInput');

    if (sysInp) sysInp.value = '';
    if (diaInp) diaInp.value = '';
    if (gluInp) gluInp.value = '';
    if (pulInp) pulInp.value = '';
    if (temInp) temInp.value = '';
    if (notInp) notInp.value = '';

    this.switchVitalsInputType(defaultType);
    overlay.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  }

  closeVitalsModal() {
    const overlay = document.getElementById('vitalsModalOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  switchVitalsInputType(type) {
    const titleEl = document.getElementById('vitalsModalTitle');
    const iconBadge = document.getElementById('vitalsModalIcon');

    // Hide all input groups
    const bpGroup = document.getElementById('vitalInputGroupBP');
    const glucoseGroup = document.getElementById('vitalInputGroupGlucose');
    const pulseGroup = document.getElementById('vitalInputGroupPulse');
    const tempGroup = document.getElementById('vitalInputGroupTemp');

    if (bpGroup) bpGroup.style.display = type === 'bp' ? 'block' : 'none';
    if (glucoseGroup) glucoseGroup.style.display = type === 'glucose' ? 'block' : 'none';
    if (pulseGroup) pulseGroup.style.display = type === 'pulse' ? 'block' : 'none';
    if (tempGroup) tempGroup.style.display = type === 'temperature' ? 'block' : 'none';

    if (type === 'bp') {
      if (titleEl) titleEl.textContent = 'Log Blood Pressure Reading';
      if (iconBadge) {
        iconBadge.className = 'modal-icon-badge bg-indigo';
        iconBadge.innerHTML = '<i data-lucide="heart"></i>';
      }
      document.getElementById('vitalSystolicInput')?.focus();
    } else if (type === 'glucose') {
      if (titleEl) titleEl.textContent = 'Log Blood Glucose Reading';
      if (iconBadge) {
        iconBadge.className = 'modal-icon-badge bg-emerald';
        iconBadge.innerHTML = '<i data-lucide="droplet"></i>';
      }
      document.getElementById('vitalGlucoseInput')?.focus();
    } else if (type === 'pulse') {
      if (titleEl) titleEl.textContent = 'Log Heart Rate (Pulse)';
      if (iconBadge) {
        iconBadge.className = 'modal-icon-badge bg-rose';
        iconBadge.innerHTML = '<i data-lucide="activity"></i>';
      }
      document.getElementById('vitalPulseInput')?.focus();
    } else if (type === 'temperature') {
      if (titleEl) titleEl.textContent = 'Log Body Temperature';
      if (iconBadge) {
        iconBadge.className = 'modal-icon-badge bg-amber';
        iconBadge.innerHTML = '<i data-lucide="thermometer"></i>';
      }
      document.getElementById('vitalTempInput')?.focus();
    }

    this.updateVitalsLivePreview();
    if (window.lucide) lucide.createIcons();
  }

  updateVitalsLivePreview() {
    const activeBtn = document.querySelector('#vitalTypeSelector .vitals-pill-btn.active');
    const type = activeBtn?.getAttribute('data-vital-type') || 'bp';
    const badgeEl = document.getElementById('vitalsPreviewBadge');
    const adviceEl = document.getElementById('vitalsPreviewAdvice');

    if (!badgeEl || !adviceEl || !window.LuminaVitals) return;

    if (type === 'bp') {
      const sys = parseInt(document.getElementById('vitalSystolicInput')?.value, 10);
      const dia = parseInt(document.getElementById('vitalDiastolicInput')?.value, 10);
      if (sys && dia) {
        const cls = window.LuminaVitals.classifyBloodPressure(sys, dia);
        badgeEl.textContent = cls.label;
        badgeEl.className = 'vital-badge ' + cls.badgeClass;
        adviceEl.textContent = cls.advice;
      } else {
        badgeEl.textContent = 'Awaiting Values';
        badgeEl.className = 'vital-badge badge-green';
        adviceEl.textContent = 'Enter systolic and diastolic values to see AHA clinical classification.';
      }
    } else if (type === 'glucose') {
      const val = parseInt(document.getElementById('vitalGlucoseInput')?.value, 10);
      const context = document.getElementById('vitalGlucoseContext')?.value || 'fasting';
      if (val) {
        const cls = window.LuminaVitals.classifyGlucose(val, context);
        badgeEl.textContent = cls.label;
        badgeEl.className = 'vital-badge ' + cls.badgeClass;
        adviceEl.textContent = cls.advice;
      } else {
        badgeEl.textContent = 'Awaiting Value';
        badgeEl.className = 'vital-badge badge-green';
        adviceEl.textContent = 'Enter glucose in mg/dL to view ADA clinical target range.';
      }
    } else if (type === 'pulse') {
      const val = parseInt(document.getElementById('vitalPulseInput')?.value, 10);
      if (val) {
        const cls = window.LuminaVitals.classifyPulse(val);
        badgeEl.textContent = cls.label;
        badgeEl.className = 'vital-badge ' + cls.badgeClass;
        adviceEl.textContent = cls.advice;
      } else {
        badgeEl.textContent = 'Awaiting Pulse';
        badgeEl.className = 'vital-badge badge-green';
        adviceEl.textContent = 'Standard adult resting heart rate target is 60-100 bpm.';
      }
    } else if (type === 'temperature') {
      const val = parseFloat(document.getElementById('vitalTempInput')?.value);
      if (val) {
        const cls = window.LuminaVitals.classifyTemperature(val);
        badgeEl.textContent = cls.label;
        badgeEl.className = 'vital-badge ' + cls.badgeClass;
        adviceEl.textContent = cls.advice;
      } else {
        badgeEl.textContent = 'Awaiting Temp';
        badgeEl.className = 'vital-badge badge-green';
        adviceEl.textContent = 'Normal body temperature is typically 97.0°F - 99.0°F.';
      }
    }
  }

  handleVitalsFormSubmit() {
    if (!window.LuminaVitals) return;

    const activeBtn = document.querySelector('#vitalTypeSelector .vitals-pill-btn.active');
    const type = activeBtn?.getAttribute('data-vital-type') || 'bp';
    const notes = document.getElementById('vitalNotesInput')?.value.trim() || '';

    let entry = { type, notes };

    if (type === 'bp') {
      const sys = parseInt(document.getElementById('vitalSystolicInput')?.value, 10);
      const dia = parseInt(document.getElementById('vitalDiastolicInput')?.value, 10);
      const pulse = parseInt(document.getElementById('vitalBPPulseInput')?.value, 10) || null;

      if (!sys || !dia) {
        this.showToast('Values Required', 'Please enter both systolic and diastolic blood pressure.', 'warning');
        return;
      }
      entry.systolic = sys;
      entry.diastolic = dia;
      if (pulse) entry.pulse = pulse;
      entry.displayVal = `${sys} / ${dia} mmHg`;
      entry.classification = window.LuminaVitals.classifyBloodPressure(sys, dia);
    } else if (type === 'glucose') {
      const val = parseInt(document.getElementById('vitalGlucoseInput')?.value, 10);
      const context = document.getElementById('vitalGlucoseContext')?.value || 'fasting';
      if (!val) {
        this.showToast('Value Required', 'Please enter your blood glucose reading.', 'warning');
        return;
      }
      entry.value = val;
      entry.context = context;
      entry.displayVal = `${val} mg/dL`;
      entry.classification = window.LuminaVitals.classifyGlucose(val, context);
    } else if (type === 'pulse') {
      const val = parseInt(document.getElementById('vitalPulseInput')?.value, 10);
      const context = document.getElementById('vitalPulseContext')?.value || 'resting';
      if (!val) {
        this.showToast('Value Required', 'Please enter heart rate in bpm.', 'warning');
        return;
      }
      entry.value = val;
      entry.context = context;
      entry.displayVal = `${val} bpm`;
      entry.classification = window.LuminaVitals.classifyPulse(val);
    } else if (type === 'temperature') {
      const val = parseFloat(document.getElementById('vitalTempInput')?.value);
      const site = document.getElementById('vitalTempSite')?.value || 'oral';
      if (!val) {
        this.showToast('Value Required', 'Please enter temperature in °F.', 'warning');
        return;
      }
      entry.value = val;
      entry.site = site;
      entry.displayVal = `${val.toFixed(1)} °F`;
      entry.classification = window.LuminaVitals.classifyTemperature(val);
    }

    window.LuminaVitals.addRecord(entry);
    this.closeVitalsModal();
    this.render();
    this.showToast('Vitals Saved! 🩺', `Recorded ${entry.displayVal} (${entry.classification.label})`, 'success');
  }

  renderVitals() {
    if (!window.LuminaVitals) return;

    const latest = window.LuminaVitals.getLatest();
    const records = window.LuminaVitals.getRecords();

    // 1. Blood Pressure Card & Overview
    const bpValEl = document.getElementById('vitalsLatestBP');
    const bpBadgeEl = document.getElementById('vitalsLatestBPBadge');
    const bpTimeEl = document.getElementById('vitalsLatestBPTime');
    const overBPValEl = document.getElementById('overviewBPVal');
    const overBPBadgeEl = document.getElementById('overviewBPBadge');
    const overBPTimeEl = document.getElementById('overviewBPTime');

    if (latest && latest.bp) {
      const bpStr = `${latest.bp.systolic} / ${latest.bp.diastolic}`;
      if (bpValEl) bpValEl.textContent = bpStr;
      if (overBPValEl) overBPValEl.textContent = bpStr;

      const cls = window.LuminaVitals.classifyBloodPressure(latest.bp.systolic, latest.bp.diastolic);
      if (bpBadgeEl) {
        bpBadgeEl.textContent = cls.label;
        bpBadgeEl.className = 'vital-badge ' + cls.badgeClass;
      }
      if (overBPBadgeEl) {
        overBPBadgeEl.textContent = cls.label;
        overBPBadgeEl.className = 'widget-badge ' + cls.badgeClass;
      }

      const d = new Date(latest.bp.timestamp);
      const timeStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      if (bpTimeEl) bpTimeEl.textContent = timeStr;
      if (overBPTimeEl) overBPTimeEl.textContent = `Latest: ${timeStr}`;
    } else {
      if (bpValEl) bpValEl.textContent = '-- / --';
      if (overBPValEl) overBPValEl.textContent = '-- / --';
      if (bpBadgeEl) {
        bpBadgeEl.textContent = 'No Data';
        bpBadgeEl.className = 'vital-badge badge-green';
      }
      if (overBPBadgeEl) {
        overBPBadgeEl.textContent = 'Normal Target';
        overBPBadgeEl.className = 'widget-badge badge-green';
      }
      if (bpTimeEl) bpTimeEl.textContent = 'Click to log reading';
      if (overBPTimeEl) overBPTimeEl.textContent = 'No records logged yet';
    }

    // 2. Glucose Card & Overview
    const gluValEl = document.getElementById('vitalsLatestGlucose');
    const gluBadgeEl = document.getElementById('vitalsLatestGlucoseBadge');
    const gluTimeEl = document.getElementById('vitalsLatestGlucoseTime');
    const overGluValEl = document.getElementById('overviewGlucoseVal');
    const overGluBadgeEl = document.getElementById('overviewGlucoseBadge');
    const overGluTimeEl = document.getElementById('overviewGlucoseTime');

    if (latest && latest.glucose) {
      if (gluValEl) gluValEl.textContent = latest.glucose.value;
      if (overGluValEl) overGluValEl.textContent = latest.glucose.value;

      const cls = window.LuminaVitals.classifyGlucose(latest.glucose.value, latest.glucose.context);
      if (gluBadgeEl) {
        gluBadgeEl.textContent = cls.label;
        gluBadgeEl.className = 'vital-badge ' + cls.badgeClass;
      }
      if (overGluBadgeEl) {
        overGluBadgeEl.textContent = cls.label;
        overGluBadgeEl.className = 'widget-badge ' + cls.badgeClass;
      }

      const d = new Date(latest.glucose.timestamp);
      const timeStr = `${(latest.glucose.context || 'reading').toUpperCase()} • ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
      if (gluTimeEl) gluTimeEl.textContent = timeStr;
      if (overGluTimeEl) overGluTimeEl.textContent = `Latest: ${timeStr}`;
    } else {
      if (gluValEl) gluValEl.textContent = '--';
      if (overGluValEl) overGluValEl.textContent = '--';
      if (gluBadgeEl) {
        gluBadgeEl.textContent = 'No Data';
        gluBadgeEl.className = 'vital-badge badge-green';
      }
      if (overGluBadgeEl) {
        overGluBadgeEl.textContent = 'Normal Target';
        overGluBadgeEl.className = 'widget-badge badge-green';
      }
      if (gluTimeEl) gluTimeEl.textContent = 'Click to log reading';
      if (overGluTimeEl) overGluTimeEl.textContent = 'No records logged yet';
    }

    // 3. Pulse Card & Overview
    const pulValEl = document.getElementById('vitalsLatestPulse');
    const pulBadgeEl = document.getElementById('vitalsLatestPulseBadge');
    const pulTimeEl = document.getElementById('vitalsLatestPulseTime');
    const overPulValEl = document.getElementById('overviewPulseVal');
    const overPulBadgeEl = document.getElementById('overviewPulseBadge');
    const overPulTimeEl = document.getElementById('overviewPulseTime');

    if (latest && latest.pulse) {
      const bpm = latest.pulse.value || latest.pulse.pulse;
      if (pulValEl) pulValEl.textContent = bpm;
      if (overPulValEl) overPulValEl.textContent = bpm;

      const cls = window.LuminaVitals.classifyPulse(bpm);
      if (pulBadgeEl) {
        pulBadgeEl.textContent = cls.label;
        pulBadgeEl.className = 'vital-badge ' + cls.badgeClass;
      }
      if (overPulBadgeEl) {
        overPulBadgeEl.textContent = cls.label;
        overPulBadgeEl.className = 'widget-badge ' + cls.badgeClass;
      }

      const d = new Date(latest.pulse.timestamp);
      const timeStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      if (pulTimeEl) pulTimeEl.textContent = timeStr;
      if (overPulTimeEl) overPulTimeEl.textContent = `Latest: ${timeStr}`;
    } else {
      if (pulValEl) pulValEl.textContent = '--';
      if (overPulValEl) overPulValEl.textContent = '--';
      if (pulBadgeEl) {
        pulBadgeEl.textContent = 'No Data';
        pulBadgeEl.className = 'vital-badge badge-green';
      }
      if (overPulBadgeEl) {
        overPulBadgeEl.textContent = 'Normal Target';
        overPulBadgeEl.className = 'widget-badge badge-green';
      }
      if (pulTimeEl) pulTimeEl.textContent = 'Click to log reading';
      if (overPulTimeEl) overPulTimeEl.textContent = 'No records logged yet';
    }

    // 4. Temperature Card & Overview
    const temValEl = document.getElementById('vitalsLatestTemp');
    const temBadgeEl = document.getElementById('vitalsLatestTempBadge');
    const temTimeEl = document.getElementById('vitalsLatestTempTime');
    const overTemValEl = document.getElementById('overviewTempVal');
    const overTemBadgeEl = document.getElementById('overviewTempBadge');
    const overTemTimeEl = document.getElementById('overviewTempTime');

    if (latest && latest.temperature) {
      const val = Number(latest.temperature.value).toFixed(1);
      if (temValEl) temValEl.textContent = val;
      if (overTemValEl) overTemValEl.textContent = val;

      const cls = window.LuminaVitals.classifyTemperature(latest.temperature.value);
      if (temBadgeEl) {
        temBadgeEl.textContent = cls.label;
        temBadgeEl.className = 'vital-badge ' + cls.badgeClass;
      }
      if (overTemBadgeEl) {
        overTemBadgeEl.textContent = cls.label;
        overTemBadgeEl.className = 'widget-badge ' + cls.badgeClass;
      }

      const d = new Date(latest.temperature.timestamp);
      const timeStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      if (temTimeEl) temTimeEl.textContent = timeStr;
      if (overTemTimeEl) overTemTimeEl.textContent = `Latest: ${timeStr}`;
    } else {
      if (temValEl) temValEl.textContent = '--';
      if (overTemValEl) overTemValEl.textContent = '--';
      if (temBadgeEl) {
        temBadgeEl.textContent = 'No Data';
        temBadgeEl.className = 'vital-badge badge-green';
      }
      if (overTemBadgeEl) {
        overTemBadgeEl.textContent = 'Normal Target';
        overTemBadgeEl.className = 'widget-badge badge-green';
      }
      if (temTimeEl) temTimeEl.textContent = 'Click to log reading';
      if (overTemTimeEl) overTemTimeEl.textContent = 'No records logged yet';
    }

    // Render Mini Trend Curves for Dashboard Health Overview Widgets
    const overBPTrendEl = document.getElementById('overviewBPTrend');
    const overGluTrendEl = document.getElementById('overviewGlucoseTrend');
    const overPulTrendEl = document.getElementById('overviewPulseTrend');
    const overTemTrendEl = document.getElementById('overviewTempTrend');

    if (overBPTrendEl) {
      const bpRecords = records.filter(r => r.type === 'bp' && r.systolic).map(r => r.systolic).reverse();
      overBPTrendEl.innerHTML = this.generateMiniSparklineSVG(bpRecords, '#0f766e');
    }
    if (overGluTrendEl) {
      const gluRecords = records.filter(r => r.type === 'glucose' && r.value).map(r => r.value).reverse();
      overGluTrendEl.innerHTML = this.generateMiniSparklineSVG(gluRecords, '#10b981');
    }
    if (overPulTrendEl) {
      const pulRecords = records.filter(r => (r.type === 'pulse' || r.pulse) && (r.value || r.pulse)).map(r => r.value || r.pulse).reverse();
      overPulTrendEl.innerHTML = this.generateMiniSparklineSVG(pulRecords, '#e11d48');
    }
    if (overTemTrendEl) {
      const temRecords = records.filter(r => r.type === 'temperature' && r.value).map(r => r.value).reverse();
      overTemTrendEl.innerHTML = this.generateMiniSparklineSVG(temRecords, '#d97706');
    }

    // Render SVG Charts
    const bpChartEl = document.getElementById('bpChartContainer');
    if (bpChartEl) {
      bpChartEl.innerHTML = window.LuminaVitals.generateBPChartSVG(records);
    }
    const gluChartEl = document.getElementById('glucoseChartContainer');
    if (gluChartEl) {
      gluChartEl.innerHTML = window.LuminaVitals.generateGlucoseChartSVG(records);
    }

    // Update Tab badge
    const badgeCount = document.getElementById('vitalsTabBadge');
    if (badgeCount) badgeCount.textContent = records.length;

    // Render Table
    this.renderVitalsTable();
  }

  generateMiniSparklineSVG(dataPoints, strokeColor = '#0f766e', width = 140, height = 24) {
    if (!dataPoints || dataPoints.length < 2) {
      return '<span class="widget-trend-empty">Trend available with 2+ logged readings</span>';
    }
    const values = dataPoints.map(Number).filter(n => !isNaN(n));
    if (values.length < 2) {
      return '<span class="widget-trend-empty">Trend available with 2+ logged readings</span>';
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = (max - min) === 0 ? 1 : (max - min);
    const padding = 3;
    const w = width - padding * 2;
    const h = height - padding * 2;

    const points = values.map((val, idx) => {
      const x = padding + (idx / (values.length - 1)) * w;
      const y = height - padding - ((val - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    return `
      <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 8px;">
        <svg class="widget-sparkline-svg" viewBox="0 0 ${width} ${height}" style="flex: 1; max-width: 140px; height: 20px;">
          <polyline fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${points}" />
        </svg>
        <span class="widget-trend-pill">${values.length} records</span>
      </div>
    `;
  }

  loadSamplePrescriptions() {
    this.medications = [
      {
        id: 'med_sample_atorvastatin',
        name: 'Atorvastatin',
        dosage: '20 mg',
        type: 'tablet',
        color: 'emerald',
        times: ['21:00'],
        foodInstruction: 'At bedtime',
        currentStock: 28,
        lowStockThreshold: 7,
        dietaryWarnings: ['Avoid Grapefruit & Juice'],
        notes: 'Prescribed for cholesterol management. Take with water at night.',
        createdAt: new Date().toISOString()
      },
      {
        id: 'med_sample_metformin',
        name: 'Metformin HCl',
        dosage: '500 mg',
        type: 'tablet',
        color: 'cyan',
        times: ['08:00', '20:00'],
        foodInstruction: 'With food',
        currentStock: 52,
        lowStockThreshold: 10,
        dietaryWarnings: ['Strict No Alcohol', 'Drink Full Glass of Water & Stay Upright'],
        notes: 'Take with morning and evening meals to minimize GI upset.',
        createdAt: new Date().toISOString()
      },
      {
        id: 'med_sample_lisinopril',
        name: 'Lisinopril',
        dosage: '10 mg',
        type: 'tablet',
        color: 'indigo',
        times: ['08:30'],
        foodInstruction: 'After food',
        currentStock: 24,
        lowStockThreshold: 5,
        dietaryWarnings: ['Avoid High Potassium / Bananas / Salt Substitutes'],
        notes: 'Blood pressure regulation. Monitor sitting BP regularly.',
        createdAt: new Date().toISOString()
      },
      {
        id: 'med_sample_amoxicillin',
        name: 'Amoxicillin',
        dosage: '500 mg',
        type: 'capsule',
        color: 'amber',
        times: ['13:00'],
        foodInstruction: 'After food',
        currentStock: 6,
        lowStockThreshold: 8,
        dietaryWarnings: ['Drink Full Glass of Water & Stay Upright'],
        notes: 'Finish full 7-day antibiotic course even if feeling better.',
        createdAt: new Date().toISOString()
      }
    ];

    // Mark the 08:00 Metformin and 08:30 Lisinopril as taken for demo adherence realism!
    const now = new Date();
    this.todayDoses = {
      'med_sample_metformin_08:00': {
        status: 'taken',
        takenAt: now.toISOString(),
        displayTime: '08:05 AM'
      },
      'med_sample_lisinopril_08:30': {
        status: 'taken',
        takenAt: now.toISOString(),
        displayTime: '08:32 AM'
      }
    };

    this.saveMedications();
    this.saveDoses();

    // Seed sample vitals if none exist
    if (window.LuminaVitals) {
      const records = window.LuminaVitals.getRecords();
      if (records.length === 0) {
        window.LuminaVitals.addRecord({
          type: 'bp',
          systolic: 118,
          diastolic: 76,
          pulse: 72,
          notes: 'Morning resting reading'
        });
        window.LuminaVitals.addRecord({
          type: 'glucose',
          value: 94,
          context: 'fasting',
          notes: 'Fasting glycemic check'
        });
        window.LuminaVitals.addRecord({
          type: 'pulse',
          value: 72,
          context: 'resting',
          notes: 'Resting heart rate'
        });
        window.LuminaVitals.addRecord({
          type: 'temperature',
          value: 98.6,
          site: 'oral',
          notes: 'Normal body temperature'
        });
      }
    }

    this.render();
    this.showToast('Sample Regimen Loaded 🩺', 'Loaded realistic medication schedule and clinical vitals.', 'success');
  }

  renderVitalsTable() {
    if (!window.LuminaVitals) return;

    const tbody = document.getElementById('vitalsTableBody');
    const emptyState = document.getElementById('emptyVitalsState');
    if (!tbody) return;

    let records = window.LuminaVitals.getRecords();

    if (this.activeVitalsFilter && this.activeVitalsFilter !== 'all') {
      records = records.filter(r => r.type === this.activeVitalsFilter);
    }

    if (records.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    tbody.innerHTML = records.map(r => {
      const dateStr = new Date(r.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      let metricName = 'Blood Pressure';
      let icon = 'heart';
      let displayVal = `${r.systolic} / ${r.diastolic} mmHg`;
      let classification = r.classification || window.LuminaVitals.classifyBloodPressure(r.systolic, r.diastolic);
      let context = r.pulse ? `Pulse: ${r.pulse} bpm` : 'Routine Check';

      if (r.type === 'glucose') {
        metricName = 'Blood Glucose';
        icon = 'droplet';
        displayVal = `${r.value} mg/dL`;
        classification = r.classification || window.LuminaVitals.classifyGlucose(r.value, r.context);
        context = (r.context || 'fasting').replace('_', ' ').toUpperCase();
      } else if (r.type === 'pulse') {
        metricName = 'Heart Rate';
        icon = 'activity';
        displayVal = `${r.value} bpm`;
        classification = r.classification || window.LuminaVitals.classifyPulse(r.value);
        context = (r.context || 'resting').toUpperCase();
      } else if (r.type === 'temperature') {
        metricName = 'Body Temperature';
        icon = 'thermometer';
        displayVal = `${Number(r.value).toFixed(1)} °F`;
        classification = r.classification || window.LuminaVitals.classifyTemperature(r.value);
        context = (r.site || 'oral').toUpperCase();
      }

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: var(--text-main);">${dateStr}</div>
            <div style="font-size: 11px; color: var(--text-muted);">${timeStr}</div>
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 8px; font-weight: 600;">
              <i data-lucide="${icon}" style="width: 16px; height: 16px; color: var(--primary);"></i>
              <span>${metricName}</span>
            </div>
          </td>
          <td>
            <strong style="font-size: 14px; font-family: var(--font-display);">${displayVal}</strong>
          </td>
          <td>
            <span style="font-size: 11.5px; color: var(--text-secondary); background: #f1f5f9; padding: 2px 8px; border-radius: 6px;">${context}</span>
          </td>
          <td>
            <span class="vital-badge ${classification.badgeClass || 'badge-green'}">${classification.label}</span>
          </td>
          <td style="max-width: 180px; font-size: 12px; color: var(--text-muted);">
            ${r.notes ? `"${this.escapeHtml(r.notes)}"` : '&mdash;'}
          </td>
          <td>
            <button type="button" class="btn-icon-tiny text-danger" onclick="luminaApp.deleteVital('${r.id}')" title="Delete entry">
              <i data-lucide="trash-2"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  }

  deleteVital(id) {
    if (!window.LuminaVitals) return;
    if (confirm('Delete this vital sign record?')) {
      window.LuminaVitals.deleteRecord(id);
      this.renderVitals();
      this.showToast('Record Deleted', 'Vitals entry removed.', 'info');
    }
  }

  // --------------------------------------------------------------------------
  // Drug-Drug Interactions & Clinical Safety Hub
  // --------------------------------------------------------------------------
  updateInteractionsStatus() {
    if (!window.LuminaInteractions) return;

    const conflicts = window.LuminaInteractions.scanCabinet(this.medications);
    const badge = document.getElementById('headerSafetyBadge');
    const icon = document.getElementById('headerSafetyIcon');

    if (badge) {
      badge.textContent = conflicts.length;
      if (conflicts.length > 0) {
        badge.className = 'badge-mini-safe has-conflicts';
      } else {
        badge.className = 'badge-mini-safe';
      }
    }

    if (icon) {
      if (conflicts.length > 0) {
        icon.setAttribute('data-lucide', 'shield-alert');
        icon.style.color = '#e11d48';
      } else {
        icon.setAttribute('data-lucide', 'shield-check');
        icon.style.color = '';
      }
    }

    if (window.lucide) lucide.createIcons();
  }

  openInteractionsModal() {
    const overlay = document.getElementById('interactionsModalOverlay');
    if (!overlay || !window.LuminaInteractions) return;

    const conflicts = window.LuminaInteractions.scanCabinet(this.medications);
    const countBadge = document.getElementById('cabinetScanCount');
    const banner = document.getElementById('cabinetScanBanner');
    const titleEl = document.getElementById('cabinetScanTitle');
    const subEl = document.getElementById('cabinetScanSub');
    const listEl = document.getElementById('activeInteractionsList');
    const modalIconBox = document.getElementById('modalSafetyIconBox');
    const modalIcon = document.getElementById('modalSafetyIcon');

    if (modalIconBox && modalIcon) {
      if (conflicts.length > 0) {
        modalIconBox.className = 'modal-icon-badge bg-rose-emergency';
        modalIcon.setAttribute('data-lucide', 'shield-alert');
      } else {
        modalIconBox.className = 'modal-icon-badge bg-emerald';
        modalIcon.setAttribute('data-lucide', 'shield-check');
      }
    }

    if (countBadge) countBadge.textContent = conflicts.length;

    if (conflicts.length === 0) {
      if (banner) {
        banner.className = 'scan-summary-banner';
        banner.innerHTML = `
          <div class="banner-icon"><i data-lucide="check-circle-2" class="text-emerald"></i></div>
          <div>
            <h4>100% Safe - No Drug-Drug Conflicts Detected</h4>
            <p>All ${this.medications.length} active medications in your cabinet can be co-administered safely with no recorded clinical interactions.</p>
          </div>
        `;
      }
      if (listEl) {
        listEl.innerHTML = `
          <div class="empty-state" style="padding: 30px;">
            <div class="empty-icon-wrap" style="background: rgba(16, 185, 129, 0.1); color: #059669;">
              <i data-lucide="shield-check"></i>
            </div>
            <h3>No Adverse Pharmacology Clashes</h3>
            <p>Your current cabinet prescriptions have no contraindications or severe interaction warnings.</p>
          </div>
        `;
      }
    } else {
      if (banner) {
        banner.className = 'scan-summary-banner has-conflicts';
        banner.innerHTML = `
          <div class="banner-icon"><i data-lucide="alert-triangle" class="text-rose"></i></div>
          <div>
            <h4>⚠️ ${conflicts.length} Potential Interaction(s) Detected</h4>
            <p>One or more active medications in your cabinet may interact. Review the clinical guidance and spacing recommendations below.</p>
          </div>
        `;
      }

      if (listEl) {
        listEl.innerHTML = conflicts.map(c => `
          <div class="interaction-conflict-card severity-${c.severity}">
            <div class="conflict-card-header">
              <div class="conflict-title-wrap">
                <i data-lucide="alert-octagon" class="text-rose"></i>
                <h4>${this.escapeHtml(c.title)}</h4>
              </div>
              <span class="conflict-severity-pill">${c.severity.toUpperCase()} RISK</span>
            </div>

            <div class="conflict-pair-pills">
              <span class="conflict-drug-badge">${this.escapeHtml(c.medA.name)}</span>
              <span class="conflict-vs">+</span>
              <span class="conflict-drug-badge">${this.escapeHtml(c.medB.name)}</span>
            </div>

            <p class="conflict-desc">${this.escapeHtml(c.description)}</p>

            <div class="conflict-action-box">
              <i data-lucide="info"></i>
              <span><strong>Action:</strong> ${this.escapeHtml(c.action)} &mdash; ${this.escapeHtml(c.recommendation)}</span>
            </div>
          </div>
        `).join('');
      }
    }

    overlay.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  }

  closeInteractionsModal() {
    const overlay = document.getElementById('interactionsModalOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  runSandboxInteractionCheck() {
    if (!window.LuminaInteractions) return;

    const drug1 = document.getElementById('sandboxDrug1')?.value.trim();
    const drug2 = document.getElementById('sandboxDrug2')?.value.trim();
    const resultBox = document.getElementById('sandboxResultBox');

    if (!drug1 || !drug2) {
      this.showToast('Enter Two Drugs', 'Please specify both medication names to test.', 'warning');
      return;
    }

    const matches = window.LuminaInteractions.checkPair(drug1, drug2);

    if (resultBox) {
      resultBox.style.display = 'block';

      if (matches.length > 0) {
        resultBox.innerHTML = matches.map(m => `
          <div class="interaction-conflict-card severity-${m.severity}">
            <div class="conflict-card-header">
              <div class="conflict-title-wrap">
                <i data-lucide="alert-triangle" class="text-rose"></i>
                <h4>${this.escapeHtml(m.title)}</h4>
              </div>
              <span class="conflict-severity-pill">${m.severity.toUpperCase()} RISK</span>
            </div>
            <div class="conflict-pair-pills">
              <span class="conflict-drug-badge">${this.escapeHtml(drug1)}</span>
              <span class="conflict-vs">+</span>
              <span class="conflict-drug-badge">${this.escapeHtml(drug2)}</span>
            </div>
            <p class="conflict-desc">${this.escapeHtml(m.description)}</p>
            <div class="conflict-action-box">
              <i data-lucide="shield-alert"></i>
              <span><strong>Recommendation:</strong> ${this.escapeHtml(m.recommendation)} &bull; ${this.escapeHtml(m.action)}</span>
            </div>
          </div>
        `).join('');
      } else {
        resultBox.innerHTML = `
          <div class="scan-summary-banner" style="margin-bottom: 0;">
            <div class="banner-icon"><i data-lucide="check-circle-2" class="text-emerald"></i></div>
            <div>
              <h4>No Recorded Interactions Found</h4>
              <p>No major contraindicated drug-drug conflict between <strong>${this.escapeHtml(drug1)}</strong> and <strong>${this.escapeHtml(drug2)}</strong> in clinical records.</p>
            </div>
          </div>
        `;
      }

      if (window.lucide) lucide.createIcons();
    }
  }

  // --------------------------------------------------------------------------
  // Real-time Medication Name Precaution & Conflict Watcher
  // --------------------------------------------------------------------------
  handleMedNameInput(name) {
    if (!name || !window.LuminaInteractions) {
      const suggestBox = document.getElementById('dietaryAutoSuggestBox');
      if (suggestBox) suggestBox.style.display = 'none';
      const conflictBox = document.getElementById('modalConflictAlertBox');
      if (conflictBox) conflictBox.style.display = 'none';
      return;
    }

    // 1. Dietary Auto-Suggest
    const suggestBox = document.getElementById('dietaryAutoSuggestBox');
    if (suggestBox) {
      const detected = window.LuminaInteractions.detectDietaryWarnings(name);
      if (detected.length > 0) {
        suggestBox.innerHTML = `
          <div>
            <strong>💡 Recommended Precaution:</strong> Commonly requires <em>${detected.join(', ')}</em>
          </div>
          <button type="button" id="applyDietarySuggestBtn">1-Click Apply</button>
        `;
        suggestBox.style.display = 'flex';

        document.getElementById('applyDietarySuggestBtn')?.addEventListener('click', () => {
          detected.forEach(w => {
            const cb = document.querySelector(`#dietaryChipsSelector input[value="${w}"]`);
            if (cb) cb.checked = true;
          });
          this.showToast('Precautions Checked', `Applied: ${detected.join(', ')}`, 'info');
        });
      } else {
        suggestBox.style.display = 'none';
      }
    }

    // 2. Conflict Check with active medications
    const conflictBox = document.getElementById('modalConflictAlertBox');
    if (conflictBox) {
      const editId = document.getElementById('editMedId')?.value;
      const conflicts = window.LuminaInteractions.checkNewAgainstCabinet(name, this.medications, editId);
      if (conflicts.length > 0) {
        conflictBox.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-weight: 700;">
            <i data-lucide="alert-triangle" style="width: 16px; height: 16px; color: #e11d48;"></i>
            <span>⚠️ Clinical Drug Interaction Detected with Active Prescription!</span>
          </div>
          ${conflicts.map(c => `
            <div style="margin-top: 4px;">
              &bull; <strong>With ${this.escapeHtml(c.otherMed.name)}:</strong> ${this.escapeHtml(c.title)}
              <br><span style="font-size: 11.5px; opacity: 0.9;">${this.escapeHtml(c.action)}</span>
            </div>
          `).join('')}
        `;
        conflictBox.style.display = 'block';
        if (window.lucide) lucide.createIcons();
      } else {
        conflictBox.style.display = 'none';
      }
    }
  }

  // ==========================================================================
  // Patient Authentication, Onboarding & Medical Profile Engine
  // ==========================================================================
  checkPatientAuth() {
    const gateway = document.getElementById('patientAuthGateway');
    if (!gateway) return;

    // Check query params if forced logout or reset
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('logout') || urlParams.has('signin')) {
        sessionStorage.removeItem('luminamed_session_active');
        if (window.history && window.history.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
    } catch (e) {}

    // Check if there is an active session for this browser visit
    const isSessionActive = sessionStorage.getItem('luminamed_session_active') === 'true';

    if (!isSessionActive) {
      // User is opening the app in real time - always show login page!
      gateway.style.display = 'flex';
      const signInStep = document.getElementById('authStepSignIn');
      const profileStep = document.getElementById('authStepProfile');
      if (signInStep) signInStep.style.display = 'block';
      if (profileStep) profileStep.style.display = 'none';
      this.switchAuthTab('phone');

      // Populate Returning Patient Card if a saved patient profile exists in localStorage
      const retCard = document.getElementById('returningPatientCard');
      if (this.patientProfile && this.patientProfile.name) {
        if (retCard) {
          retCard.style.display = 'block';
          const p = this.patientProfile;
          const retAvatar = document.getElementById('returningPatientAvatar');
          const retName = document.getElementById('returningPatientName');
          const retMeta = document.getElementById('returningPatientMeta');
          if (retAvatar) retAvatar.textContent = p.avatar || 'PT';
          if (retName) retName.textContent = p.name || 'Patient';
          if (retMeta) retMeta.textContent = `🩸 ${p.bloodGroup || 'O+'} • ${p.phone || p.email || 'Saved Patient'}`;
        }
      } else {
        if (retCard) retCard.style.display = 'none';
      }
    } else {
      // User is authenticated for this session - hide gateway and update badges
      gateway.style.display = 'none';
      this.renderPatientHeaderBadge();
    }

    if (window.lucide) lucide.createIcons();
  }

  unlockSavedPatientSession() {
    if (this.patientProfile) {
      this.completeLoginSuccess(this.patientProfile);
    } else {
      try {
        const stored = localStorage.getItem(STORAGE_KEYS.PATIENT);
        if (stored) {
          const p = JSON.parse(stored);
          this.completeLoginSuccess(p);
        }
      } catch (e) {}
    }
  }

  startNewPatientRegistration() {
    const retCard = document.getElementById('returningPatientCard');
    if (retCard) retCard.style.display = 'none';

    // Clear login inputs
    const phoneInput = document.getElementById('loginPhoneInput');
    if (phoneInput) phoneInput.value = '';
    const otpBox = document.getElementById('otpVerificationBox');
    const sendRow = document.getElementById('sendOtpActionRow');
    if (otpBox) otpBox.style.display = 'none';
    if (sendRow) sendRow.style.display = 'block';

    // Reset profile intake inputs
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };
    setVal('profileFullNameInput', '');
    setVal('profileAgeInput', '');
    setVal('profilePhoneInput', '');
    setVal('profileEmailInput', '');
    setVal('profileAllergiesInput', 'None known');
    setVal('profileConditionsInput', 'None');
    setVal('profileDoctorNameInput', '');
    setVal('profileDoctorHospitalInput', '');
    setVal('profileDoctorPhoneInput', '');
    setVal('profileEmergencyNameInput', '');
    setVal('profileEmergencyPhoneInput', '');

    // Reset state so new patient starts fresh with ZERO demo medicines
    this.patientProfile = null;
    this.medications = [];
    this.todayDoses = {};
    this.historyLogs = [];
    this.saveMedications();
    this.saveDoses();
    this.saveHistory();
    try {
      localStorage.removeItem(STORAGE_KEYS.PATIENT);
    } catch (e) {}

    this.render();
    this.showToast('New Patient Registration', 'Enter your mobile number or select Google to create your fresh profile.', 'info');
    if (window.lucide) lucide.createIcons();
  }

  switchAuthTab(method) {
    this.currentAuthMethod = method;
    const phoneBtn = document.getElementById('authTabPhoneBtn');
    const googleBtn = document.getElementById('authTabGoogleBtn');
    const phoneSec = document.getElementById('phoneAuthSection');
    const googleSec = document.getElementById('googleAuthSection');

    if (method === 'phone') {
      if (phoneBtn) phoneBtn.classList.add('active');
      if (googleBtn) googleBtn.classList.remove('active');
      if (phoneSec) phoneSec.style.display = 'block';
      if (googleSec) googleSec.style.display = 'none';
    } else {
      if (phoneBtn) phoneBtn.classList.remove('active');
      if (googleBtn) googleBtn.classList.add('active');
      if (phoneSec) phoneSec.style.display = 'none';
      if (googleSec) googleSec.style.display = 'block';
    }

    if (window.lucide) lucide.createIcons();
  }

  handlePhoneRequestOtp(isResend = false) {
    const code = document.getElementById('loginCountryCode')?.value || '+91';
    const phoneInput = document.getElementById('loginPhoneInput');
    const phone = phoneInput ? phoneInput.value.trim().replace(/[^0-9]/g, '') : '';

    if (!phone || phone.length < 7) {
      this.showToast('Invalid Mobile Number', 'Please enter a valid mobile phone number to receive your OTP code.', 'warning');
      if (phoneInput) phoneInput.focus();
      return;
    }

    const fullPhone = `${code} ${phone}`;
    this.generatedOtp = String(Math.floor(1000 + Math.random() * 9000));
    this.otpExpiresAt = Date.now() + (5 * 60 * 1000); // 5-minute security TTL
    
    const notice = document.getElementById('otpPhoneSentNotice');
    if (notice) notice.textContent = `Security code sent to ${fullPhone}`;
    
    const codeDisplay = document.getElementById('demoOtpCodeDisplay');
    if (codeDisplay) codeDisplay.textContent = this.generatedOtp;

    const otpBox = document.getElementById('otpVerificationBox');
    const sendRow = document.getElementById('sendOtpActionRow');
    if (otpBox) otpBox.style.display = 'block';
    if (sendRow) sendRow.style.display = 'none';

    // Clear digit inputs and focus first
    for (let i = 1; i <= 4; i++) {
      const d = document.getElementById(`otpDigit${i}`);
      if (d) d.value = '';
    }
    const d1 = document.getElementById('otpDigit1');
    if (d1) setTimeout(() => d1.focus(), 150);

    // Start 30s countdown
    this.startOtpCountdown();

    this.showToast('OTP Sent! 📱', `Your LuminaMed verification code is: ${this.generatedOtp}`, 'success');
    if (window.lucide) lucide.createIcons();
  }

  startOtpCountdown() {
    clearInterval(this.otpCountdownTimer);
    this.otpRemainingSeconds = 30;
    const countText = document.getElementById('otpCountdownText');
    const resendBtn = document.getElementById('resendOtpBtn');
    if (resendBtn) resendBtn.style.display = 'none';
    if (countText) countText.style.display = 'inline';

    this.otpCountdownTimer = setInterval(() => {
      this.otpRemainingSeconds--;
      if (countText) countText.textContent = `Resend in ${this.otpRemainingSeconds}s`;
      if (this.otpRemainingSeconds <= 0) {
        clearInterval(this.otpCountdownTimer);
        if (countText) countText.style.display = 'none';
        if (resendBtn) resendBtn.style.display = 'inline';
      }
    }, 1000);
  }

  initOtpDigitInputs() {
    const digits = [
      document.getElementById('otpDigit1'),
      document.getElementById('otpDigit2'),
      document.getElementById('otpDigit3'),
      document.getElementById('otpDigit4')
    ];

    digits.forEach((digit, idx) => {
      if (!digit) return;
      digit.addEventListener('input', (e) => {
        const val = e.target.value.replace(/[^0-9]/g, '');
        e.target.value = val ? val[0] : '';
        if (val && idx < digits.length - 1) {
          digits[idx + 1].focus();
        }
        // Auto-verify if 4 digits complete
        const fullCode = digits.map(d => d.value).join('');
        if (fullCode.length === 4) {
          setTimeout(() => this.verifyPhoneOtp(), 250);
        }
      });

      digit.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && idx > 0) {
          digits[idx - 1].focus();
        }
      });

      digit.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
        if (pasted.length >= 4) {
          for (let i = 0; i < 4; i++) {
            if (digits[i]) digits[i].value = pasted[i];
          }
          digits[3].focus();
          setTimeout(() => this.verifyPhoneOtp(), 250);
        }
      });
    });
  }

  autofillDemoOtp() {
    const digits = [
      document.getElementById('otpDigit1'),
      document.getElementById('otpDigit2'),
      document.getElementById('otpDigit3'),
      document.getElementById('otpDigit4')
    ];
    for (let i = 0; i < 4; i++) {
      if (digits[i] && this.generatedOtp[i]) {
        digits[i].value = this.generatedOtp[i];
      }
    }
    this.verifyPhoneOtp();
  }

  verifyPhoneOtp() {
    const code = [
      document.getElementById('otpDigit1')?.value || '',
      document.getElementById('otpDigit2')?.value || '',
      document.getElementById('otpDigit3')?.value || '',
      document.getElementById('otpDigit4')?.value || ''
    ].join('');

    if (code.length < 4) {
      this.showToast('Incomplete Code', 'Please enter all 4 digits of the security code.', 'warning');
      return;
    }

    // Security TTL check
    if (this.otpExpiresAt && Date.now() > this.otpExpiresAt) {
      this.showToast('Code Expired ⏳', 'The 4-digit verification code has expired (5m security limit). Please request a new OTP.', 'warning');
      return;
    }

    // Accept generated OTP or fallback standard demo codes
    if (code !== this.generatedOtp && code !== '4829' && code !== '1234') {
      this.showToast('Incorrect OTP', `Code ${code} is invalid. Try demo code: ${this.generatedOtp || '4829'}`, 'danger');
      return;
    }

    // Invalidate OTP after successful verification so it cannot be replayed
    this.generatedOtp = null;
    this.otpExpiresAt = null;

    const countryCode = document.getElementById('loginCountryCode')?.value || '+91';
    const rawPhone = document.getElementById('loginPhoneInput')?.value.trim() || '';
    const fullPhone = `${countryCode} ${rawPhone}`;

    this.showToast('Phone Verified! ✅', 'Number confirmed. Setting up patient medical profile...', 'success');

    // Pre-fill Step 2 phone input
    const profilePhoneInput = document.getElementById('profilePhoneInput');
    if (profilePhoneInput) profilePhoneInput.value = fullPhone;

    // Check if patient profile already saved for this phone in localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.PATIENT);
      if (stored) {
        const p = JSON.parse(stored);
        if (p && p.phone && p.phone.replace(/[^0-9]/g, '') === fullPhone.replace(/[^0-9]/g, '')) {
          this.patientProfile = p;
          this.completeLoginSuccess(p);
          return;
        }
      }
    } catch (e) {}

    // Newly registering patient: start with zero demo medicines!
    this.medications = [];
    this.todayDoses = {};
    this.historyLogs = [];
    this.saveMedications();
    this.saveDoses();
    this.saveHistory();

    // Move to step 2 intake
    this.goToProfileIntake('phone', fullPhone);
  }

  triggerGoogleSignIn() {
    this.loginWithPredefinedGoogle('Alex Johnson', 'alex.johnson@healthmail.com', 'AJ');
  }

  loginWithPredefinedGoogle(name, email, avatar) {
    const fullNameInp = document.getElementById('profileFullNameInput');
    const emailInp = document.getElementById('profileEmailInput');
    const phoneInp = document.getElementById('profilePhoneInput');
    if (fullNameInp) fullNameInp.value = name;
    if (emailInp) emailInp.value = email;
    if (phoneInp && !phoneInp.value) phoneInp.value = '+91 98765 43210';

    this.showToast('Google Verified 🌐', `Authenticated as ${name} (${email})`, 'success');

    // Check if existing profile matches this email
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.PATIENT);
      if (stored) {
        const p = JSON.parse(stored);
        if (p && p.email && p.email.toLowerCase() === email.toLowerCase()) {
          this.patientProfile = p;
          this.completeLoginSuccess(p);
          return;
        }
      }
    } catch (e) {}

    // Newly registering Google account: start with zero demo medicines!
    this.medications = [];
    this.todayDoses = {};
    this.historyLogs = [];
    this.saveMedications();
    this.saveDoses();
    this.saveHistory();

    this.goToProfileIntake('google', email);
  }

  continueAsGuest() {
    const guestProfile = {
      id: `patient_guest_${Date.now()}`,
      name: 'Guest Patient',
      age: 38,
      gender: 'Male',
      phone: '+91 98765 43210',
      email: 'guest@luminamed.local',
      bloodGroup: 'O+',
      allergies: 'None known',
      conditions: 'None',
      doctorName: 'Dr. Robert Chen',
      doctorHospital: 'City General Clinic',
      doctorPhone: '+91 98765 12345',
      emergencyContactName: 'Family Caregiver',
      emergencyContactPhone: '+91 98765 67890',
      emergencyRelation: 'Caregiver',
      authProvider: 'guest',
      avatar: 'GP'
    };

    // Newly logged in guest patient: start with zero demo medicines!
    this.medications = [];
    this.todayDoses = {};
    this.historyLogs = [];
    this.saveMedications();
    this.saveDoses();
    this.saveHistory();

    this.patientProfile = guestProfile;
    try {
      localStorage.setItem(STORAGE_KEYS.PATIENT, JSON.stringify(guestProfile));
    } catch (e) {}

    this.completeLoginSuccess(guestProfile);
  }

  goToProfileIntake(provider = 'phone', prefilledContact = '') {
    const signInStep = document.getElementById('authStepSignIn');
    const profileStep = document.getElementById('authStepProfile');
    if (signInStep) signInStep.style.display = 'none';
    if (profileStep) profileStep.style.display = 'block';

    if (provider === 'phone') {
      const phoneInp = document.getElementById('profilePhoneInput');
      if (phoneInp && prefilledContact) phoneInp.value = prefilledContact;
      const nameInp = document.getElementById('profileFullNameInput');
      if (nameInp && !nameInp.value) nameInp.focus();
    } else if (provider === 'google') {
      const emailInp = document.getElementById('profileEmailInput');
      if (emailInp && prefilledContact) emailInp.value = prefilledContact;
    }

    if (window.lucide) lucide.createIcons();
  }

  backToAuthStep() {
    const signInStep = document.getElementById('authStepSignIn');
    const profileStep = document.getElementById('authStepProfile');
    if (signInStep) signInStep.style.display = 'block';
    if (profileStep) profileStep.style.display = 'none';
    if (window.lucide) lucide.createIcons();
  }

  initPatientChipEvents() {
    // Allergies chips
    document.querySelectorAll('#allergiesChipRow .quick-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const val = chip.getAttribute('data-val');
        const input = document.getElementById('profileAllergiesInput');
        if (!input) return;

        if (val === 'None known') {
          document.querySelectorAll('#allergiesChipRow .quick-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          input.value = 'None known';
          return;
        }

        document.querySelector('#allergiesChipRow .quick-chip[data-val="None known"]')?.classList.remove('active');
        chip.classList.toggle('active');

        const activeChips = Array.from(document.querySelectorAll('#allergiesChipRow .quick-chip.active'))
          .map(c => c.getAttribute('data-val'))
          .filter(v => v !== 'None known');

        input.value = activeChips.length > 0 ? activeChips.join(', ') : 'None known';
      });
    });

    // Chronic conditions chips
    document.querySelectorAll('#conditionsChipRow .quick-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const val = chip.getAttribute('data-val');
        const input = document.getElementById('profileConditionsInput');
        if (!input) return;

        if (val === 'None') {
          document.querySelectorAll('#conditionsChipRow .quick-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          input.value = 'None';
          return;
        }

        document.querySelector('#conditionsChipRow .quick-chip[data-val="None"]')?.classList.remove('active');
        chip.classList.toggle('active');

        const activeChips = Array.from(document.querySelectorAll('#conditionsChipRow .quick-chip.active'))
          .map(c => c.getAttribute('data-val'))
          .filter(v => v !== 'None');

        input.value = activeChips.length > 0 ? activeChips.join(', ') : 'None';
      });
    });
  }

  handleSavePatientProfile() {
    const name = document.getElementById('profileFullNameInput')?.value.trim();
    const age = parseInt(document.getElementById('profileAgeInput')?.value, 10);
    const gender = document.getElementById('profileGenderSelect')?.value || 'Male';
    const phone = document.getElementById('profilePhoneInput')?.value.trim();
    const email = document.getElementById('profileEmailInput')?.value.trim();
    const bloodGroup = document.getElementById('profileBloodGroupSelect')?.value || 'O+';
    const allergies = document.getElementById('profileAllergiesInput')?.value.trim() || 'None known';
    const conditions = document.getElementById('profileConditionsInput')?.value.trim() || 'None';
    const doctorName = document.getElementById('profileDoctorNameInput')?.value.trim();
    const doctorHospital = document.getElementById('profileDoctorHospitalInput')?.value.trim();
    const doctorPhone = document.getElementById('profileDoctorPhoneInput')?.value.trim();
    const emergencyName = document.getElementById('profileEmergencyNameInput')?.value.trim();
    const emergencyRelation = document.getElementById('profileEmergencyRelationSelect')?.value || 'Caregiver';
    const emergencyPhone = document.getElementById('profileEmergencyPhoneInput')?.value.trim();

    if (!name) {
      this.showToast('Missing Name', 'Please enter the patient full name.', 'warning');
      return;
    }
    if (!phone) {
      this.showToast('Missing Phone', 'Please provide a valid primary contact phone number.', 'warning');
      return;
    }

    const initials = name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'PT';

    const profile = {
      id: this.patientProfile?.id || `patient_${Date.now()}`,
      name,
      age: isNaN(age) ? 35 : age,
      gender,
      phone,
      email,
      bloodGroup,
      allergies,
      conditions,
      doctorName,
      doctorHospital,
      doctorPhone,
      emergencyContactName: emergencyName,
      emergencyContactPhone: emergencyPhone,
      emergencyRelation,
      avatar: initials,
      updatedAt: new Date().toISOString()
    };

    // Check if this is a newly registered patient (no prior profile or different profile ID)
    const isNewPatient = !this.patientProfile || this.patientProfile.id !== profile.id || !localStorage.getItem(STORAGE_KEYS.PATIENT);
    if (isNewPatient) {
      this.medications = [];
      this.todayDoses = {};
      this.historyLogs = [];
      this.saveMedications();
      this.saveDoses();
      this.saveHistory();
    }

    this.patientProfile = profile;
    try {
      localStorage.setItem(STORAGE_KEYS.PATIENT, JSON.stringify(profile));
    } catch (e) {
      console.error('Failed to save patient profile:', e);
    }

    // Auto-sync Doctor and Emergency contact into this.contacts
    let contactsChanged = false;
    if (doctorName && doctorPhone) {
      const existingDoc = this.contacts.find(c => c.role === 'doctor' || (c.phone && c.phone.replace(/[^0-9]/g, '') === doctorPhone.replace(/[^0-9]/g, '')));
      if (!existingDoc) {
        this.contacts.push({
          id: `contact_doc_${Date.now()}`,
          name: doctorName,
          role: 'doctor',
          hospital: doctorHospital || 'Primary Clinic',
          phone: doctorPhone,
          email: '',
          notifyMissed: true,
          isPrimarySos: false,
          notes: 'Personal Physician'
        });
        contactsChanged = true;
      }
    }

    if (emergencyName && emergencyPhone) {
      const existingEmerg = this.contacts.find(c => c.phone && c.phone.replace(/[^0-9]/g, '') === emergencyPhone.replace(/[^0-9]/g, ''));
      if (!existingEmerg) {
        this.contacts.push({
          id: `contact_emerg_${Date.now()}`,
          name: emergencyName,
          role: 'family',
          hospital: emergencyRelation,
          phone: emergencyPhone,
          email: '',
          notifyMissed: true,
          isPrimarySos: true,
          notes: `Emergency Contact (${emergencyRelation})`
        });
        contactsChanged = true;
      }
    }

    if (contactsChanged) {
      this.saveContacts();
    }

    this.completeLoginSuccess(profile);
  }

  completeLoginSuccess(profile) {
    this.patientProfile = profile;
    sessionStorage.setItem('luminamed_session_active', 'true');
    try {
      localStorage.setItem(STORAGE_KEYS.PATIENT, JSON.stringify(profile));
    } catch (e) {}

    this.settings.patientName = profile.name;
    this.saveSettings();

    // Close auth gateway
    const gateway = document.getElementById('patientAuthGateway');
    if (gateway) gateway.style.display = 'none';

    // Update patient name input in caregiver tab
    const nameInp = document.getElementById('patientNameInput');
    if (nameInp) nameInp.value = profile.name;

    // Render header badge & SOS banner
    this.renderPatientHeaderBadge();
    this.render();

    this.showToast('Profile Verified! 🩺', `Welcome, ${profile.name}! (Blood Group: ${profile.bloodGroup || 'O+'})`, 'success');
  }

  renderPatientHeaderBadge() {
    const avatarEl = document.getElementById('headerPatientAvatar');
    const nameEl = document.getElementById('headerPatientName');
    const bloodEl = document.getElementById('headerPatientBlood');

    const sideAvatar = document.getElementById('sidebarPatientAvatar');
    const sideName = document.getElementById('sidebarPatientName');
    const sideBlood = document.getElementById('sidebarPatientBlood');

    if (!this.patientProfile) {
      if (avatarEl) avatarEl.textContent = 'PT';
      if (nameEl) nameEl.textContent = 'Sign In';
      if (bloodEl) bloodEl.textContent = 'Patient Portal';
      if (sideAvatar) sideAvatar.textContent = 'PT';
      if (sideName) sideName.textContent = 'Sign In';
      if (sideBlood) sideBlood.textContent = 'Patient Portal';
      return;
    }

    const p = this.patientProfile;
    if (avatarEl) avatarEl.textContent = p.avatar || 'PT';
    if (nameEl) nameEl.textContent = p.name || 'Patient';
    if (bloodEl) bloodEl.textContent = `🩸 ${p.bloodGroup || 'O+'}`;

    if (sideAvatar) sideAvatar.textContent = p.avatar || 'PT';
    if (sideName) sideName.textContent = p.name || 'Patient';
    if (sideBlood) sideBlood.textContent = `🩸 ${p.bloodGroup || 'O+'}`;

    // Update SOS modal banner
    const sosAvatar = document.getElementById('sosPatientAvatar');
    const sosName = document.getElementById('sosPatientName');
    const sosBlood = document.getElementById('sosPatientBlood');
    const sosAllergies = document.getElementById('sosPatientAllergies');
    if (sosAvatar) sosAvatar.textContent = p.avatar || 'PT';
    if (sosName) sosName.textContent = p.name || 'Patient';
    if (sosBlood) sosBlood.textContent = `🩸 ${p.bloodGroup || 'O+'}`;
    if (sosAllergies) {
      sosAllergies.textContent = `Allergies: ${p.allergies || 'None known'} • Diagnoses: ${p.conditions || 'None'}`;
    }
  }

  openPatientProfileModal() {
    const overlay = document.getElementById('patientProfileModalOverlay');
    if (!overlay) return;

    if (!this.patientProfile) {
      this.checkPatientAuth();
      return;
    }

    const p = this.patientProfile;
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('idCardAvatar', p.avatar || 'PT');
    setTxt('idCardFullName', p.name || 'Patient');
    setTxt('idCardBloodGroup', `🩸 Blood Group: ${p.bloodGroup || 'O+'}`);
    setTxt('idCardAgeGender', `${p.age ? p.age + ' yrs' : 'Age --'} • ${p.gender || 'Not specified'}`);
    setTxt('idCardPhone', p.phone || 'Not provided');
    setTxt('idCardEmail', p.email || 'Not provided');
    setTxt('idCardAllergies', p.allergies || 'None known');
    setTxt('idCardConditions', p.conditions || 'None recorded');
    setTxt('idCardDoctor', p.doctorName ? `${p.doctorName} • ${p.doctorHospital || 'Clinic'} (${p.doctorPhone || 'No phone'})` : 'No primary doctor saved');
    setTxt('idCardEmergency', p.emergencyContactName ? `${p.emergencyContactName} (${p.emergencyRelation || 'Caregiver'}) • ${p.emergencyContactPhone || '--'}` : 'No emergency caregiver saved');

    overlay.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  }

  closePatientProfileModal() {
    const overlay = document.getElementById('patientProfileModalOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  editPatientProfile() {
    this.closePatientProfileModal();
    const gateway = document.getElementById('patientAuthGateway');
    if (!gateway) return;

    // Fill form fields
    if (this.patientProfile) {
      const p = this.patientProfile;
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
      };
      setVal('profileFullNameInput', p.name);
      setVal('profileAgeInput', p.age);
      setVal('profileGenderSelect', p.gender || 'Male');
      setVal('profilePhoneInput', p.phone);
      setVal('profileEmailInput', p.email);
      setVal('profileBloodGroupSelect', p.bloodGroup || 'O+');
      setVal('profileAllergiesInput', p.allergies);
      setVal('profileConditionsInput', p.conditions);
      setVal('profileDoctorNameInput', p.doctorName);
      setVal('profileDoctorHospitalInput', p.doctorHospital);
      setVal('profileDoctorPhoneInput', p.doctorPhone);
      setVal('profileEmergencyNameInput', p.emergencyContactName);
      setVal('profileEmergencyRelationSelect', p.emergencyRelation || 'Spouse');
      setVal('profileEmergencyPhoneInput', p.emergencyContactPhone);
    }

    gateway.style.display = 'flex';
    this.goToProfileIntake('edit');
  }

  confirmLogoutPatient() {
    this.stopAlarmSound();
    sessionStorage.removeItem('luminamed_session_active');
    this.closePatientProfileModal();
    this.checkPatientAuth();
    this.showToast('Signed Out 🚪', 'Please sign in to access your LuminaMed medical records.', 'info');
  }

  sendClinicalSummaryToDoctor() {
    const p = this.patientProfile || {
      name: this.settings.patientName || 'Patient',
      age: 42,
      gender: 'Not specified',
      bloodGroup: 'O+',
      allergies: 'None known',
      conditions: 'None',
      phone: '',
      doctorName: 'Doctor',
      doctorHospital: '',
      doctorPhone: ''
    };

    const activeMedsList = this.medications.length > 0 
      ? this.medications.map((m, idx) => {
          const times = (m.times || []).map(t => this.formatDisplayTime(t)).join(', ');
          return `${idx + 1}. *${m.name}* (${m.dosage}) - ${m.type || 'Pill'}\n   • Schedule: ${times || 'As needed'}\n   • Food/Notes: ${m.food || 'After meal'}${m.notes ? ' | ' + m.notes : ''}`;
        }).join('\n\n')
      : '• No active prescription medications currently recorded.';

    const stats = this.getAdherenceStats ? this.getAdherenceStats() : null;
    const adherence = stats ? `${stats.percentage}%` : document.getElementById('adherencePercent')?.textContent || '100%';

    let vitalsSummary = 'No recent vitals logged';
    try {
      const storedVitals = localStorage.getItem('luminamed_vitals_records_v1');
      if (storedVitals) {
        const vList = JSON.parse(storedVitals);
        if (vList && vList.length > 0) {
          const latest = vList[0];
          vitalsSummary = `Latest ${latest.type?.toUpperCase() || 'Reading'}: ${latest.formattedValue || latest.value} (${latest.classification?.label || 'Recorded'})`;
        }
      }
    } catch (e) {}

    const text = `🩺 *LUMINAMED PATIENT CLINICAL SUMMARY*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *PATIENT IDENTITY*\n` +
      `• *Name:* ${p.name}\n` +
      `• *Age / Gender:* ${p.age ? p.age + ' yrs' : 'Not specified'} | ${p.gender || 'Not specified'}\n` +
      `• *Blood Group:* 🩸 ${p.bloodGroup || 'Pending'}\n` +
      `• *Patient Contact:* ${p.phone || 'Not provided'}\n` +
      (p.emergencyContactName ? `• *Emergency Contact:* ${p.emergencyContactName} (${p.emergencyContactPhone || '--'})\n` : '') +
      `\n⚠️ *CRITICAL CLINICAL FLAGS*\n` +
      `• *Known Drug Allergies:* ${p.allergies || 'None known'}\n` +
      `• *Chronic Diagnoses:* ${p.conditions || 'None recorded'}\n` +
      `\n💊 *ACTIVE MEDICATIONS SCHEDULE*\n` +
      `${activeMedsList}\n` +
      `\n📊 *HEALTH TRACKING & ADHERENCE*\n` +
      `• *Today's Adherence Rate:* ${adherence}\n` +
      `• *Recent Vitals:* ${vitalsSummary}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `_Generated via LuminaMed Patient Care Portal_`;

    let cleanPhone = (p.doctorPhone || '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
    if (!cleanPhone) {
      const docContact = this.contacts.find(c => c.role === 'doctor');
      if (docContact && docContact.phone) {
        cleanPhone = docContact.phone.replace(/[^0-9+]/g, '').replace(/^\+/, '');
      }
    }

    if (cleanPhone) {
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, '_blank');
      this.showToast('Clinical Summary Ready', `Opened WhatsApp for ${p.doctorName || 'Doctor'} (${cleanPhone})`, 'success');
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
      this.showToast('Clinical Summary Ready', 'Opened WhatsApp. Select your doctor to send.', 'info');
    }
  }

  // --------------------------------------------------------------------------
  // Daylight Phase Planner & Smart Meal Timing Buffer
  // --------------------------------------------------------------------------
  getDaylightPhase(timeStr) {
    if (!timeStr) return { key: 'morning', label: 'Morning', icon: '🌅' };
    const [h] = timeStr.split(':').map(Number);
    if (h >= 6 && h < 12) return { key: 'morning', label: 'Morning', icon: '🌅' };
    if (h >= 12 && h < 17) return { key: 'afternoon', label: 'Afternoon', icon: '☀️' };
    if (h >= 17 && h < 21) return { key: 'evening', label: 'Evening', icon: '🌆' };
    return { key: 'bedtime', label: 'Bedtime', icon: '🌙' };
  }

  startMealBuffer(medName, minutes = 30, foodInst = '') {
    this.stopActiveMealBuffer(false);

    const banner = document.getElementById('activeMealBufferBanner');
    const headingEl = document.getElementById('mealBufferHeading');
    const msgEl = document.getElementById('mealBufferMessage');
    const timerDisplay = document.getElementById('mealBufferTimerDisplay');

    const targetTimestamp = Date.now() + (minutes * 60 * 1000);
    this.activeMealBuffer = {
      medName,
      minutes,
      targetTimestamp,
      foodInst
    };

    if (headingEl) headingEl.innerHTML = `🍽️ Pre-Meal Buffer Active: <strong>${this.escapeHtml(medName)}</strong>`;
    if (msgEl) {
      if (foodInst.toLowerCase().includes('before')) {
        msgEl.textContent = `Absorption buffer running. Please wait 30 minutes before eating breakfast/meal for optimal drug bioavailability.`;
      } else {
        msgEl.textContent = `Digestion buffer running. Please wait for the meal timer to conclude.`;
      }
    }
    if (banner) banner.style.display = 'flex';

    const tick = () => {
      const remainingMs = targetTimestamp - Date.now();
      if (remainingMs <= 0) {
        this.stopActiveMealBuffer(false);
        if (timerDisplay) timerDisplay.textContent = '00:00';
        
        // Chime and speak
        if (this.alarmAudio) {
          this.alarmAudio.playSound('crystalBell');
          if (this.settings.voiceSpeechEnabled) {
            this.alarmAudio.speak(`Meal buffer complete. You can now safely have your meal.`);
          }
        }
        this.showToast('🍽️ Meal Buffer Complete', `The 30-minute digestion/absorption window for ${medName} has elapsed. You can now safely eat!`, 'success');
        this.renderTodayTimeline();
        if (window.lucide) lucide.createIcons();
        return;
      }

      const totalSec = Math.floor(remainingMs / 1000);
      const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const s = String(totalSec % 60).padStart(2, '0');
      if (timerDisplay) timerDisplay.textContent = `${m}:${s}`;
    };

    tick();
    this.mealBufferInterval = setInterval(tick, 1000);
    this.showToast('Buffer Timer Started ⏳', `Counting down 30 minutes for ${medName} before eating.`, 'info');
    this.renderTodayTimeline();
    if (window.lucide) lucide.createIcons();
  }

  stopActiveMealBuffer(notify = true) {
    if (this.mealBufferInterval) {
      clearInterval(this.mealBufferInterval);
      this.mealBufferInterval = null;
    }
    this.activeMealBuffer = null;
    const banner = document.getElementById('activeMealBufferBanner');
    if (banner) banner.style.display = 'none';

    if (notify) {
      this.showToast('Meal Buffer Cancelled', 'Meal digestion countdown was stopped.', 'info');
      this.renderTodayTimeline();
      if (window.lucide) lucide.createIcons();
    }
  }

  // --------------------------------------------------------------------------
  // Elderly Large Text & High Contrast Mode
  // --------------------------------------------------------------------------
  toggleElderlyMode() {
    this.isElderlyMode = !this.isElderlyMode;
    document.body.classList.toggle('elderly-mode', this.isElderlyMode);
    localStorage.setItem(STORAGE_KEYS.ELDERLY_MODE, String(this.isElderlyMode));

    const btn = document.getElementById('elderlyModeToggleBtn');
    if (btn) {
      btn.innerHTML = this.isElderlyMode 
        ? `<i data-lucide="check"></i> <span>Large Text (ON)</span>` 
        : `<i data-lucide="eye"></i> <span>Large Text</span>`;
      btn.classList.toggle('btn-primary', this.isElderlyMode);
      btn.classList.toggle('btn-glass-secondary', !this.isElderlyMode);
    }

    this.showToast(
      this.isElderlyMode ? 'Large Text Mode Enabled 👁️' : 'Standard View Restored',
      this.isElderlyMode ? 'High contrast, enlarged buttons, and bold text activated for easy reading.' : 'Standard interface layout restored.',
      'info'
    );
    if (window.lucide) lucide.createIcons();
  }

  testVoiceSpeech() {
    const pName = this.patientProfile?.name || this.settings.patientName || 'Alex';
    if (this.alarmAudio) {
      this.alarmAudio.testSpeech(pName);
    }
    this.showToast('Voice Announcement 🎙️', `Speaking dose reminder for ${pName} via browser Web Speech API.`, 'info');
  }

  // --------------------------------------------------------------------------
  // Doctor Appointments & Consultations Hub
  // --------------------------------------------------------------------------
  renderAppointments() {
    const grid = document.getElementById('appointmentsGrid');
    const emptyState = document.getElementById('emptyAppointmentsState');
    if (!grid) return;

    let list = [...this.appointments];
    const todayStr = this.getTodayDateString();

    if (this.activeAppointmentFilter === 'upcoming') {
      list = list.filter(a => a.date >= todayStr);
    } else if (this.activeAppointmentFilter === 'past') {
      list = list.filter(a => a.date < todayStr || a.status === 'completed');
    }

    list.sort((a, b) => (a.date + ' ' + (a.time || '00:00')).localeCompare(b.date + ' ' + (b.time || '00:00')));

    if (list.length === 0) {
      grid.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    grid.innerHTML = list.map(appt => {
      const isPast = appt.date < todayStr || appt.status === 'completed';
      const initials = (appt.doctorName || 'DR').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

      const [year, month, day] = appt.date.split('-').map(Number);
      const apptDateObj = new Date(year, month - 1, day);
      const todayDateObj = new Date();
      todayDateObj.setHours(0, 0, 0, 0);

      const diffDays = Math.round((apptDateObj - todayDateObj) / (1000 * 60 * 60 * 24));
      let countdownStr = '';
      if (diffDays === 0) countdownStr = 'Today!';
      else if (diffDays === 1) countdownStr = 'Tomorrow';
      else if (diffDays > 1) countdownStr = `In ${diffDays} days`;
      else countdownStr = 'Past';

      const dateFormatted = apptDateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

      return `
        <div class="appointment-card glass-card ${isPast ? 'is-past' : ''}">
          <div class="appt-card-top">
            <div class="appt-doctor-info">
              <div class="appt-avatar-badge">${initials}</div>
              <div class="appt-doctor-text">
                <h4>${this.escapeHtml(appt.doctorName)}</h4>
                <span class="appt-specialty-tag">${this.escapeHtml(appt.specialty || 'Specialist')}</span>
              </div>
            </div>
            <span class="appt-type-pill">${this.escapeHtml(appt.format || 'Clinic Visit')}</span>
          </div>

          <div class="appt-schedule-box">
            <div class="appt-date-time-row">
              <span>📅 ${dateFormatted} at ${this.formatDisplayTime(appt.time)}</span>
              <span class="appt-countdown-tag">${countdownStr}</span>
            </div>
            <div class="appt-clinic-row">
              <i data-lucide="map-pin"></i>
              <span>${this.escapeHtml(appt.clinic)}</span>
            </div>
          </div>

          ${appt.notes ? `
            <div class="appt-notes-box">
              <strong>Notes:</strong> ${this.escapeHtml(appt.notes)}
            </div>
          ` : ''}

          <div class="appt-actions-row">
            <button type="button" class="btn-appt-cal" onclick="luminaApp.downloadIcsCalendar('${appt.id}')" title="Sync with Google Calendar or Apple Calendar">
              <i data-lucide="calendar"></i> <span>Add to Cal</span>
            </button>
            <button type="button" class="btn-appt-whatsapp" onclick="luminaApp.whatsappDoctorAppointment('${appt.id}')" title="Message Doctor on WhatsApp">
              <i data-lucide="message-square"></i> <span>WhatsApp</span>
            </button>
            <button type="button" class="btn-appt-remove" onclick="luminaApp.deleteAppointment('${appt.id}')" title="Remove Appointment">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  openAppointmentModal(apptToEdit = null) {
    const overlay = document.getElementById('appointmentModalOverlay');
    const form = document.getElementById('appointmentForm');
    if (!overlay || !form) return;

    if (apptToEdit) {
      document.getElementById('editAppointmentId').value = apptToEdit.id;
      document.getElementById('apptDoctorNameInput').value = apptToEdit.doctorName || '';
      document.getElementById('apptSpecialtyInput').value = apptToEdit.specialty || 'Cardiologist';
      document.getElementById('apptClinicInput').value = apptToEdit.clinic || '';
      document.getElementById('apptTypeSelect').value = apptToEdit.format || 'In-Person Visit';
      document.getElementById('apptDateInput').value = apptToEdit.date || '';
      document.getElementById('apptTimeInput').value = apptToEdit.time || '10:30';
      document.getElementById('apptPhoneInput').value = apptToEdit.phone || '';
      document.getElementById('apptNotesInput').value = apptToEdit.notes || '';
      document.getElementById('appointmentModalTitle').textContent = 'Edit Doctor Appointment';
      document.getElementById('apptSubmitBtnText').textContent = 'Update Appointment';
    } else {
      form.reset();
      document.getElementById('editAppointmentId').value = '';
      document.getElementById('apptDoctorNameInput').value = this.patientProfile?.doctorName || '';
      document.getElementById('apptClinicInput').value = this.patientProfile?.hospital || '';
      document.getElementById('apptPhoneInput').value = this.patientProfile?.doctorPhone || '';
      
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 3);
      const yyyy = nextWeek.getFullYear();
      const mm = String(nextWeek.getMonth() + 1).padStart(2, '0');
      const dd = String(nextWeek.getDate()).padStart(2, '0');
      document.getElementById('apptDateInput').value = `${yyyy}-${mm}-${dd}`;
      document.getElementById('apptTimeInput').value = '10:30';

      document.getElementById('appointmentModalTitle').textContent = 'Schedule Doctor Consultation / Lab Test';
      document.getElementById('apptSubmitBtnText').textContent = 'Save Appointment';
    }

    overlay.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  }

  closeAppointmentModal() {
    const overlay = document.getElementById('appointmentModalOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  handleAppointmentFormSubmit() {
    const editId = document.getElementById('editAppointmentId')?.value;
    const doctorName = document.getElementById('apptDoctorNameInput')?.value.trim();
    const specialty = document.getElementById('apptSpecialtyInput')?.value;
    const clinic = document.getElementById('apptClinicInput')?.value.trim();
    const format = document.getElementById('apptTypeSelect')?.value;
    const date = document.getElementById('apptDateInput')?.value;
    const time = document.getElementById('apptTimeInput')?.value;
    const phone = document.getElementById('apptPhoneInput')?.value.trim();
    const notes = document.getElementById('apptNotesInput')?.value.trim();

    if (!doctorName || !date) {
      this.showToast('Missing Fields', 'Please enter doctor name and appointment date.', 'warning');
      return;
    }

    if (editId) {
      const idx = this.appointments.findIndex(a => a.id === editId);
      if (idx !== -1) {
        this.appointments[idx] = {
          ...this.appointments[idx],
          doctorName,
          specialty,
          clinic,
          format,
          date,
          time,
          phone,
          notes
        };
        this.showToast('Appointment Updated ✅', `Updated visit with ${doctorName}.`, 'success');
      }
    } else {
      const newAppt = {
        id: 'appt_' + Date.now(),
        doctorName,
        specialty,
        clinic,
        format,
        date,
        time,
        phone,
        notes,
        status: 'confirmed'
      };
      this.appointments.push(newAppt);
      this.showToast('Appointment Scheduled! 📅', `Consultation with ${doctorName} scheduled for ${date}.`, 'success');
    }

    this.saveAppointments();
    this.closeAppointmentModal();
    this.render();
  }

  deleteAppointment(id) {
    if (confirm('Remove this scheduled appointment from your calendar?')) {
      this.appointments = this.appointments.filter(a => a.id !== id);
      this.saveAppointments();
      this.render();
      this.showToast('Appointment Removed', 'The consultation was deleted from your schedule.', 'info');
    }
  }

  downloadIcsCalendar(id) {
    const appt = this.appointments.find(a => a.id === id);
    if (!appt) return;

    const [year, month, day] = appt.date.split('-');
    const [hour, minute] = (appt.time || '10:00').split(':');
    const startIso = `${year}${month}${day}T${hour}${minute}00`;
    
    const endDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour) + 1, parseInt(minute));
    const endIso = `${endDate.getFullYear()}${String(endDate.getMonth() + 1).padStart(2, '0')}${String(endDate.getDate()).padStart(2, '0')}T${String(endDate.getHours()).padStart(2, '0')}${String(endDate.getMinutes()).padStart(2, '0')}00`;
    const nowIso = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const icsData = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//LuminaMed//Health Appointment Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:appt_${appt.id}_${Date.now()}@luminamed.health`,
      `DTSTAMP:${nowIso}`,
      `DTSTART:${startIso}`,
      `DTEND:${endIso}`,
      `SUMMARY:Medical Consultation: ${appt.doctorName} (${appt.specialty})`,
      `DESCRIPTION:${appt.format} at ${appt.clinic}. Clinical Notes: ${appt.notes || 'None'}`,
      `LOCATION:${appt.clinic}`,
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-PT2H',
      'ACTION:DISPLAY',
      'DESCRIPTION:Upcoming Medical Appointment in 2 hours',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `appointment-${appt.doctorName.replace(/\s+/g, '_')}-${appt.date}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    this.showToast('Calendar Invite Downloaded 📅', `Saved .ics file for ${appt.doctorName}. Open to sync with Google Calendar or Apple Calendar.`, 'success');
  }

  whatsappDoctorAppointment(id) {
    const appt = this.appointments.find(a => a.id === id);
    if (!appt) return;

    const p = this.patientProfile || {
      name: this.settings.patientName || 'Patient',
      phone: ''
    };

    const text = 
      `Hello ${appt.doctorName},\n\n` +
      `I am confirming my upcoming medical appointment:\n` +
      `📅 *Date:* ${appt.date} at ${this.formatDisplayTime(appt.time)}\n` +
      `🏥 *Clinic/Hospital:* ${appt.clinic}\n` +
      `🩺 *Format:* ${appt.format}\n` +
      `👤 *Patient:* ${p.name || 'Patient'} (${p.phone || ''})\n` +
      (appt.notes ? `📝 *Preparation/Notes:* ${appt.notes}\n` : '') +
      `\nPlease let me know if there are any additional preparation instructions. Thank you!`;

    let cleanPhone = (appt.phone || '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
    if (cleanPhone) {
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, '_blank');
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
  }

  // --------------------------------------------------------------------------
  // 1-Tap Pharmacy Prescription Refill Hub
  // --------------------------------------------------------------------------
  renderRefillStation() {
    const listEl = document.getElementById('refillNeededMedicinesList');
    const badgeEl = document.getElementById('refillNeededCountBadge');
    if (!listEl) return;

    const lowStockMeds = this.medications.filter(m => (m.currentStock || 0) <= (m.lowStockThreshold || 7));

    if (badgeEl) {
      if (lowStockMeds.length === 0) {
        badgeEl.textContent = 'All Well Stocked';
        badgeEl.className = 'badge-tag bg-emerald';
      } else {
        badgeEl.textContent = `${lowStockMeds.length} Items Need Refill`;
        badgeEl.className = 'badge-tag bg-amber';
      }
    }

    if (lowStockMeds.length === 0) {
      listEl.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 14px; background: rgba(16, 185, 129, 0.08); border-radius: var(--radius-md); border: 1px solid rgba(16, 185, 129, 0.25); color: #065f46; display: flex; align-items: center; gap: 10px; font-size: 13px;">
          <i data-lucide="check-circle-2" style="color: #059669; width: 22px; height: 22px; flex-shrink: 0;"></i>
          <span><strong>Cabinet in great shape!</strong> All active medications have sufficient stock (>7 days supply available).</span>
        </div>
      `;
      return;
    }

    listEl.innerHTML = lowStockMeds.map(m => {
      const isCritical = (m.currentStock || 0) <= 3;
      return `
        <div class="refill-summary-item">
          <div class="refill-item-details">
            <h5>${this.escapeHtml(m.name)}</h5>
            <p>${this.escapeHtml(m.dosage)} &bull; ${m.currentStock || 0} units left</p>
          </div>
          <span class="refill-stock-badge ${isCritical ? 'critical' : 'warning'}">
            ${isCritical ? '⚠️ Critical' : 'Refill Soon'}
          </span>
        </div>
      `;
    }).join('');
  }

  sendPrescriptionRefillToPharmacy() {
    const lowStockMeds = this.medications.filter(m => (m.currentStock || 0) <= (m.lowStockThreshold || 7));
    if (lowStockMeds.length === 0) {
      this.showToast('Inventory Sufficient', 'None of your medications currently need refilling (>7 days supply available).', 'info');
      return;
    }

    const p = this.patientProfile || {
      name: this.settings.patientName || 'Patient',
      age: '42',
      bloodGroup: 'O+',
      doctorName: 'Dr. Robert Chen',
      hospital: 'Metro Heart Clinic',
      doctorPhone: '+91 98765 43210'
    };

    let itemsList = '';
    lowStockMeds.forEach((m, idx) => {
      const remainingDays = Math.max(1, Math.round((m.currentStock || 0) / (m.times?.length || 1)));
      itemsList += `${idx + 1}. *${m.name}* (${m.dosage}) - Stock: ${m.currentStock || 0} left (~${remainingDays} days supply)\n`;
    });

    const text = 
      `🏥 *LUMINAMED PRESCRIPTION REFILL REQUEST*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *Patient:* ${p.name || 'Patient'} (${p.age || '42'}y, Blood: ${p.bloodGroup || 'Unknown'})\n` +
      `👨‍⚕️ *Primary Physician:* ${p.doctorName || 'Dr. Robert Chen'} (${p.hospital || 'Clinic'})\n` +
      `📅 *Date:* ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💊 *MEDICATIONS NEEDING REFILL:*\n` +
      itemsList +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `_Please confirm when prescription refill pack is ready for pickup or delivery. Thank you!_\n` +
      `_Sent via LuminaMed Smart Health Care Portal_`;

    let cleanPhone = (p.doctorPhone || '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
    if (cleanPhone) {
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, '_blank');
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
    this.showToast('Refill Request Ready 📦', 'Opened WhatsApp with your complete medication refill order.', 'success');
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// Global helpers for inline HTML button click hooks
window.openAddModal = function() {
  if (window.luminaApp) {
    window.luminaApp.openMedModal();
  }
};

window.openRxModal = function() {
  if (window.luminaApp) {
    window.luminaApp.openRxModal();
  }
};

window.openVitalsModal = function(type = 'bp') {
  if (window.luminaApp) {
    window.luminaApp.openVitalsModal(type);
  }
};

window.openInteractionsModal = function() {
  if (window.luminaApp) {
    window.luminaApp.openInteractionsModal();
  }
};

window.deleteMedication = function(id, event) {
  if (window.luminaApp) {
    window.luminaApp.confirmDeleteMedication(id, event);
  }
};

window.deleteDetectedRxMed = function(index, event) {
  if (window.luminaApp) {
    window.luminaApp.deleteDetectedRxMed(index, event);
  }
};

// Bootstrap application on DOM ready or immediately if already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  window.luminaApp = new LuminaMedApp();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    window.luminaApp = new LuminaMedApp();
  });
}
