/**
 * LuminaMed - Vital Signs & Health Metrics Engine
 * Tracks Blood Pressure, Blood Glucose, Pulse (Heart Rate), and Body Temperature
 * with clinical AHA/ADA classification and interactive SVG trend charts.
 */

(function(window) {
  'use strict';

  const STORAGE_KEY_VITALS = 'luminamed_vitals_records_v1';

  // ==========================================================================
  // Clinical Classification Helpers
  // ==========================================================================
  const VitalsEngine = {
    /**
     * AHA/ACC 2017 Blood Pressure Classification
     */
    classifyBloodPressure(systolic, diastolic) {
      const sys = Number(systolic);
      const dia = Number(diastolic);

      if (!sys || !dia) {
        return { label: 'Invalid', level: 'unknown', color: 'slate', advice: 'Enter both systolic and diastolic values.' };
      }

      if (sys > 180 || dia > 120) {
        return {
          label: 'Hypertensive Crisis',
          level: 'crisis',
          color: 'rose-dark',
          badgeClass: 'badge-crisis',
          advice: 'Emergency range! Re-test immediately. If sustained or experiencing chest pain/headache, contact emergency medical care.'
        };
      }
      if (sys >= 140 || dia >= 90) {
        return {
          label: 'Stage 2 Hypertension',
          level: 'stage2',
          color: 'rose',
          badgeClass: 'badge-danger',
          advice: 'Consistently high reading. Consult your physician regarding antihypertensive medication adjustments.'
        };
      }
      if ((sys >= 130 && sys <= 139) || (dia >= 80 && dia <= 89)) {
        return {
          label: 'Stage 1 Hypertension',
          level: 'stage1',
          color: 'amber',
          badgeClass: 'badge-amber',
          advice: 'Moderately elevated. Recommended lifestyle modifications (low sodium, exercise) and adherence to prescribed medications.'
        };
      }
      if (sys >= 120 && sys <= 129 && dia < 80) {
        return {
          label: 'Elevated BP',
          level: 'elevated',
          color: 'amber-subtle',
          badgeClass: 'badge-amber',
          advice: 'Slightly above normal systolic pressure. Heart is pumping against mild resistance.'
        };
      }
      if (sys < 90 || dia < 60) {
        return {
          label: 'Hypotension (Low BP)',
          level: 'low',
          color: 'blue',
          badgeClass: 'badge-blue',
          advice: 'Blood pressure is below standard range. Stay well-hydrated and avoid abrupt standing if dizzy.'
        };
      }

      return {
        label: 'Optimal / Normal',
        level: 'normal',
        color: 'emerald',
        badgeClass: 'badge-green',
        advice: 'Excellent cardiovascular range (<120 / <80 mmHg). Continue regular physical activity and medication compliance.'
      };
    },

    /**
     * ADA Blood Glucose Classification (mg/dL)
     */
    classifyGlucose(value, context = 'fasting') {
      const val = Number(value);
      if (!val) return { label: 'Unknown', level: 'unknown', color: 'slate' };

      if (val < 70) {
        return {
          label: 'Hypoglycemia (Low)',
          level: 'hypo',
          color: 'rose-dark',
          badgeClass: 'badge-danger',
          advice: 'Blood sugar is low (<70 mg/dL). Follow the 15-15 rule: consume 15g fast-acting carbs (fruit juice, candy) and re-check in 15 mins.'
        };
      }

      if (context === 'fasting' || context === 'before_meal') {
        if (val >= 126) {
          return {
            label: 'High (Diabetic Fasting)',
            level: 'high',
            color: 'rose',
            badgeClass: 'badge-danger',
            advice: 'Fasting glucose is elevated (≥126 mg/dL). Confirm adherence to insulin/metformin doses.'
          };
        }
        if (val >= 100) {
          return {
            label: 'Prediabetes Range',
            level: 'prediabetes',
            color: 'amber',
            badgeClass: 'badge-amber',
            advice: 'Fasting glucose is in pre-diabetes tier (100-125 mg/dL). Track diet carbohydrates and physical activity.'
          };
        }
        return {
          label: 'Normal Fasting',
          level: 'normal',
          color: 'emerald',
          badgeClass: 'badge-green',
          advice: 'Optimal fasting glucose (<100 mg/dL). Perfect metabolic control.'
        };
      } else {
        // Post-prandial / random
        if (val >= 200) {
          return {
            label: 'High (Hyperglycemia)',
            level: 'high',
            color: 'rose',
            badgeClass: 'badge-danger',
            advice: 'Post-meal glucose is high (≥200 mg/dL). Drink water and monitor for symptoms.'
          };
        }
        if (val >= 140) {
          return {
            label: 'Elevated Post-Meal',
            level: 'prediabetes',
            color: 'amber',
            badgeClass: 'badge-amber',
            advice: 'Slightly high for post-meal (140-199 mg/dL).'
          };
        }
        return {
          label: 'Normal Post-Meal',
          level: 'normal',
          color: 'emerald',
          badgeClass: 'badge-green',
          advice: 'Healthy post-prandial response (<140 mg/dL).'
        };
      }
    },

    /**
     * Heart Rate / Pulse Classification (BPM)
     */
    classifyPulse(bpm) {
      const val = Number(bpm);
      if (!val) return { label: 'Unknown', level: 'unknown', color: 'slate' };

      if (val < 50) {
        return {
          label: 'Marked Bradycardia',
          level: 'low',
          color: 'blue',
          badgeClass: 'badge-blue',
          advice: 'Heart rate is quite low. Note if feeling faint or taking beta-blockers.'
        };
      }
      if (val < 60) {
        return {
          label: 'Mild Bradycardia / Athletic',
          level: 'low-normal',
          color: 'blue',
          badgeClass: 'badge-blue',
          advice: 'Normal for conditioned athletes or patients on rate-control medications.'
        };
      }
      if (val > 100) {
        return {
          label: 'Tachycardia',
          level: 'high',
          color: 'rose',
          badgeClass: 'badge-danger',
          advice: 'Resting pulse is above 100 bpm. Rest quietly and re-test; check for dehydration or stress.'
        };
      }
      return {
        label: 'Normal Resting Pulse',
        level: 'normal',
        color: 'emerald',
        badgeClass: 'badge-green',
        advice: 'Normal resting pulse (60-100 bpm).'
      };
    },

    /**
     * Body Temperature Classification (Fahrenheit)
     */
    classifyTemperature(tempF) {
      const val = Number(tempF);
      if (!val) return { label: 'Unknown', level: 'unknown', color: 'slate' };

      if (val >= 103.0) {
        return {
          label: 'High Fever',
          level: 'high-fever',
          color: 'rose-dark',
          badgeClass: 'badge-crisis',
          advice: 'High fever (≥103°F). Take antipyretic if prescribed and seek medical advice if sustained.'
        };
      }
      if (val >= 100.4) {
        return {
          label: 'Fever',
          level: 'fever',
          color: 'rose',
          badgeClass: 'badge-danger',
          advice: 'Fever detected (≥100.4°F). Stay hydrated and monitor symptoms.'
        };
      }
      if (val >= 99.1) {
        return {
          label: 'Low-Grade Temp',
          level: 'low-grade',
          color: 'amber',
          badgeClass: 'badge-amber',
          advice: 'Mild elevation. Monitor over the next few hours.'
        };
      }
      if (val < 95.0) {
        return {
          label: 'Hypothermia Warning',
          level: 'hypothermia',
          color: 'blue',
          badgeClass: 'badge-blue',
          advice: 'Abnormally low body temperature. Keep warm and re-check.'
        };
      }
      return {
        label: 'Normal Temperature',
        level: 'normal',
        color: 'emerald',
        badgeClass: 'badge-green',
        advice: 'Normal healthy body temperature (97.0°F - 99.0°F).'
      };
    },

    // ========================================================================
    // State & Storage
    // ========================================================================
    getRecords() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_VITALS);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length >= 4) {
            return parsed;
          }
        }

        // Pre-populate with realistic clinical tracking logs for instant trend visualization
        const now = Date.now();
        const initialSample = [
          {
            id: 'vital_demo_1',
            type: 'bp',
            systolic: 118,
            diastolic: 78,
            pulse: 70,
            notes: 'Morning routine reading. Calm and rested.',
            timestamp: new Date(now - 1000 * 60 * 60 * 2).toISOString(),
            classification: { label: 'Optimal / Normal', level: 'normal', color: 'emerald', badgeClass: 'badge-green', advice: 'Optimal cardiovascular range.' }
          },
          {
            id: 'vital_demo_2',
            type: 'bp',
            systolic: 122,
            diastolic: 80,
            pulse: 72,
            notes: 'Afternoon seated check after lunch.',
            timestamp: new Date(now - 1000 * 60 * 60 * 20).toISOString(),
            classification: { label: 'Elevated BP', level: 'elevated', color: 'amber', badgeClass: 'badge-amber', advice: 'Slightly above normal systolic.' }
          },
          {
            id: 'vital_demo_3',
            type: 'bp',
            systolic: 124,
            diastolic: 82,
            pulse: 74,
            notes: 'After evening walk.',
            timestamp: new Date(now - 1000 * 60 * 60 * 44).toISOString(),
            classification: { label: 'Stage 1 Hypertension', level: 'stage1', color: 'amber', badgeClass: 'badge-amber', advice: 'Moderately elevated diastolic.' }
          },
          {
            id: 'vital_demo_4',
            type: 'bp',
            systolic: 116,
            diastolic: 76,
            pulse: 68,
            notes: 'Morning relaxed baseline.',
            timestamp: new Date(now - 1000 * 60 * 60 * 68).toISOString(),
            classification: { label: 'Optimal / Normal', level: 'normal', color: 'emerald', badgeClass: 'badge-green', advice: 'Healthy cardiovascular pressure.' }
          },
          {
            id: 'vital_demo_5',
            type: 'bp',
            systolic: 120,
            diastolic: 78,
            pulse: 70,
            notes: 'Evening post-dinner check.',
            timestamp: new Date(now - 1000 * 60 * 60 * 92).toISOString(),
            classification: { label: 'Optimal / Normal', level: 'normal', color: 'emerald', badgeClass: 'badge-green', advice: 'Optimal resting pressure.' }
          },
          {
            id: 'vital_demo_6',
            type: 'glucose',
            value: 94,
            context: 'fasting',
            notes: 'Morning fasting before breakfast.',
            timestamp: new Date(now - 1000 * 60 * 60 * 3).toISOString(),
            classification: { label: 'Normal Fasting', level: 'normal', color: 'emerald', badgeClass: 'badge-green', advice: 'Optimal fasting glucose.' }
          },
          {
            id: 'vital_demo_7',
            type: 'glucose',
            value: 128,
            context: 'post_meal',
            notes: '2 hrs after balanced lunch.',
            timestamp: new Date(now - 1000 * 60 * 60 * 22).toISOString(),
            classification: { label: 'Normal Post-Meal', level: 'normal', color: 'emerald', badgeClass: 'badge-green', advice: 'Healthy post-prandial glycemic response.' }
          },
          {
            id: 'vital_demo_8',
            type: 'glucose',
            value: 98,
            context: 'fasting',
            notes: 'Fasting glucose check.',
            timestamp: new Date(now - 1000 * 60 * 60 * 46).toISOString(),
            classification: { label: 'Normal Fasting', level: 'normal', color: 'emerald', badgeClass: 'badge-green', advice: 'Normal metabolic control.' }
          },
          {
            id: 'vital_demo_9',
            type: 'glucose',
            value: 134,
            context: 'post_meal',
            notes: 'Post-dinner glucose.',
            timestamp: new Date(now - 1000 * 60 * 60 * 70).toISOString(),
            classification: { label: 'Normal Post-Meal', level: 'normal', color: 'emerald', badgeClass: 'badge-green', advice: 'Normal response (<140 mg/dL).' }
          },
          {
            id: 'vital_demo_10',
            type: 'glucose',
            value: 92,
            context: 'fasting',
            notes: 'Morning routine check.',
            timestamp: new Date(now - 1000 * 60 * 60 * 94).toISOString(),
            classification: { label: 'Normal Fasting', level: 'normal', color: 'emerald', badgeClass: 'badge-green', advice: 'Excellent fasting glucose.' }
          },
          {
            id: 'vital_demo_11',
            type: 'pulse',
            value: 70,
            context: 'resting',
            notes: 'Normal resting pulse.',
            timestamp: new Date(now - 1000 * 60 * 60 * 4).toISOString(),
            classification: { label: 'Normal Resting Pulse', level: 'normal', color: 'emerald', badgeClass: 'badge-green', advice: 'Healthy heart rate.' }
          },
          {
            id: 'vital_demo_12',
            type: 'temperature',
            value: 98.4,
            site: 'oral',
            notes: 'Normal body temperature.',
            timestamp: new Date(now - 1000 * 60 * 60 * 5).toISOString(),
            classification: { label: 'Normal Temperature', level: 'normal', color: 'emerald', badgeClass: 'badge-green', advice: 'Afebrile, normal.' }
          }
        ];
        this.saveRecords(initialSample);
        return initialSample;
      } catch (e) {
        console.error('Failed to load vitals records:', e);
        return [];
      }
    },

    saveRecords(records) {
      try {
        localStorage.setItem(STORAGE_KEY_VITALS, JSON.stringify(records));
      } catch (e) {
        console.error('Failed to save vitals records:', e);
      }
    },

    addRecord(entry) {
      const records = this.getRecords();
      const newEntry = {
        id: 'vital_' + Date.now() + Math.random().toString(36).substr(2, 4),
        timestamp: new Date().toISOString(),
        ...entry
      };
      records.unshift(newEntry);
      this.saveRecords(records);
      return newEntry;
    },

    deleteRecord(id) {
      const records = this.getRecords().filter(r => r.id !== id);
      this.saveRecords(records);
      return records;
    },

    getLatest() {
      const records = this.getRecords();
      if (!records || records.length === 0) return null;

      const latestBP = records.find(r => r.type === 'bp');
      const latestGlucose = records.find(r => r.type === 'glucose');
      const latestPulse = records.find(r => r.type === 'pulse' || r.pulse);
      const latestTemp = records.find(r => r.type === 'temperature');

      return {
        bp: latestBP || null,
        glucose: latestGlucose || null,
        pulse: latestPulse || null,
        temperature: latestTemp || null,
        mostRecent: records[0] || null
      };
    },

    // ========================================================================
    // Interactive SVG Trend Chart Generators
    // ========================================================================
    /**
     * Render Blood Pressure Trend SVG Chart (Systolic in Indigo, Diastolic in Cyan)
     */
    generateBPChartSVG(records, width = 640, height = 220) {
      const bpRecords = records.filter(r => r.type === 'bp' && r.systolic && r.diastolic).slice(0, 10).reverse();

      if (bpRecords.length < 2) {
        return `
          <div class="chart-empty-state">
            <i data-lucide="line-chart"></i>
            <p>Log at least 2 blood pressure readings to generate your clinical trend curve.</p>
          </div>
        `;
      }

      const padding = { top: 25, right: 35, bottom: 35, left: 45 };
      const chartW = width - padding.left - padding.right;
      const chartH = height - padding.top - padding.bottom;

      // Fixed Y axis scale for standard clinical BP: 40 to 180 mmHg
      const minY = 50;
      const maxY = 180;
      const getY = (val) => padding.top + chartH - ((Math.min(maxY, Math.max(minY, val)) - minY) / (maxY - minY)) * chartH;
      const getX = (idx) => padding.left + (idx / (bpRecords.length - 1)) * chartW;

      // Normal reference band (Systolic 90-120, Diastolic 60-80)
      const normalSysTop = getY(120);
      const normalSysBottom = getY(90);
      const normalDiaTop = getY(80);
      const normalDiaBottom = getY(60);

      // Points for lines
      const sysPoints = bpRecords.map((r, i) => `${getX(i)},${getY(r.systolic)}`).join(' ');
      const diaPoints = bpRecords.map((r, i) => `${getX(i)},${getY(r.diastolic)}`).join(' ');
      const areaSysPoints = `${getX(0)},${getY(minY)} ${sysPoints} ${getX(bpRecords.length - 1)},${getY(minY)}`;
      const areaDiaPoints = `${getX(0)},${getY(minY)} ${diaPoints} ${getX(bpRecords.length - 1)},${getY(minY)}`;

      // Y-axis grid ticks
      const ticks = [60, 80, 100, 120, 140, 160];
      const gridLines = ticks.map(t => {
        const y = getY(t);
        const isTarget = t === 120 || t === 80;
        return `
          <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" 
                stroke="${isTarget ? 'rgba(37, 99, 235, 0.25)' : 'rgba(226, 232, 240, 0.8)'}" 
                stroke-dasharray="${isTarget ? '4 3' : '2 2'}" stroke-width="${isTarget ? '1.5' : '1'}" />
          <text x="${padding.left - 8}" y="${y + 4}" font-size="10" font-family="'Plus Jakarta Sans', sans-serif" 
                fill="#64748b" text-anchor="end" font-weight="${isTarget ? '600' : '400'}">${t}</text>
        `;
      }).join('');

      // Data markers & labels
      const sysMarkers = bpRecords.map((r, i) => {
        const x = getX(i);
        const y = getY(r.systolic);
        const timeLabel = new Date(r.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
        return `
          <g class="chart-point-group" tabindex="0">
            <circle cx="${x}" cy="${y}" r="4.5" fill="#2563eb" stroke="#ffffff" stroke-width="2" class="chart-dot" />
            <text x="${x}" y="${y - 8}" font-size="10.5" font-weight="700" fill="#1e40af" text-anchor="middle" font-family="'Outfit', sans-serif">${r.systolic}</text>
            <text x="${x}" y="${height - 12}" font-size="9.5" fill="#64748b" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif">${timeLabel}</text>
          </g>
        `;
      }).join('');

      const diaMarkers = bpRecords.map((r, i) => {
        const x = getX(i);
        const y = getY(r.diastolic);
        return `
          <g class="chart-point-group">
            <circle cx="${x}" cy="${y}" r="4" fill="#06b6d4" stroke="#ffffff" stroke-width="2" class="chart-dot" />
            <text x="${x}" y="${y + 16}" font-size="10.5" font-weight="700" fill="#0e7490" text-anchor="middle" font-family="'Outfit', sans-serif">${r.diastolic}</text>
          </g>
        `;
      }).join('');

      return `
        <svg viewBox="0 0 ${width} ${height}" class="vitals-svg-chart" style="width: 100%; height: auto; overflow: visible;">
          <defs>
            <linearGradient id="sysGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#2563eb" stop-opacity="0.14" />
              <stop offset="100%" stop-color="#2563eb" stop-opacity="0.0" />
            </linearGradient>
            <linearGradient id="diaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.12" />
              <stop offset="100%" stop-color="#06b6d4" stop-opacity="0.0" />
            </linearGradient>
          </defs>

          <!-- Optimal Target Zones -->
          <rect x="${padding.left}" y="${normalSysTop}" width="${chartW}" height="${normalSysBottom - normalSysTop}" 
                fill="rgba(37, 99, 235, 0.05)" rx="4" />
          <rect x="${padding.left}" y="${normalDiaTop}" width="${chartW}" height="${normalDiaBottom - normalDiaTop}" 
                fill="rgba(6, 182, 212, 0.05)" rx="4" />

          <!-- Grid Lines -->
          ${gridLines}

          <!-- Gradient Area Fills -->
          <polygon points="${areaSysPoints}" fill="url(#sysGradient)" />
          <polygon points="${areaDiaPoints}" fill="url(#diaGradient)" />

          <!-- Trend Lines -->
          <polyline points="${sysPoints}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
          <polyline points="${diaPoints}" fill="none" stroke="#06b6d4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

          <!-- Dots & Data Labels -->
          ${sysMarkers}
          ${diaMarkers}
        </svg>
      `;
    },

    /**
     * Render Blood Glucose Trend SVG Chart
     */
    generateGlucoseChartSVG(records, width = 640, height = 220) {
      const gRecords = records.filter(r => r.type === 'glucose' && r.value).slice(0, 10).reverse();

      if (gRecords.length < 2) {
        return `
          <div class="chart-empty-state">
            <i data-lucide="activity"></i>
            <p>Log at least 2 blood glucose readings to view your glycemic curve.</p>
          </div>
        `;
      }

      const padding = { top: 25, right: 35, bottom: 35, left: 45 };
      const chartW = width - padding.left - padding.right;
      const chartH = height - padding.top - padding.bottom;

      const minY = 50;
      const maxY = 220;
      const getY = (val) => padding.top + chartH - ((Math.min(maxY, Math.max(minY, val)) - minY) / (maxY - minY)) * chartH;
      const getX = (idx) => padding.left + (idx / (gRecords.length - 1)) * chartW;

      const ticks = [70, 100, 140, 180, 200];
      const gridLines = ticks.map(t => {
        const y = getY(t);
        const isTarget = t === 100 || t === 140;
        return `
          <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" 
                stroke="${isTarget ? 'rgba(16, 185, 129, 0.3)' : 'rgba(226, 232, 240, 0.8)'}" 
                stroke-dasharray="${isTarget ? '4 3' : '2 2'}" stroke-width="${isTarget ? '1.5' : '1'}" />
          <text x="${padding.left - 8}" y="${y + 4}" font-size="10" font-family="'Plus Jakarta Sans', sans-serif" 
                fill="#64748b" text-anchor="end" font-weight="${isTarget ? '600' : '400'}">${t}</text>
        `;
      }).join('');

      const points = gRecords.map((r, i) => `${getX(i)},${getY(r.value)}`).join(' ');
      const areaPoints = `${getX(0)},${getY(minY)} ${points} ${getX(gRecords.length - 1)},${getY(minY)}`;

      const markers = gRecords.map((r, i) => {
        const x = getX(i);
        const y = getY(r.value);
        const classification = VitalsEngine.classifyGlucose(r.value, r.context);
        const dotColor = classification.level === 'normal' ? '#10b981' : (classification.level === 'prediabetes' ? '#f59e0b' : '#f43f5e');
        const timeLabel = new Date(r.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });

        return `
          <g class="chart-point-group">
            <circle cx="${x}" cy="${y}" r="5" fill="${dotColor}" stroke="#ffffff" stroke-width="2" class="chart-dot" />
            <text x="${x}" y="${y - 8}" font-size="10.5" font-weight="700" fill="${dotColor}" text-anchor="middle" font-family="'Outfit', sans-serif">${r.value}</text>
            <text x="${x}" y="${height - 12}" font-size="9.5" fill="#64748b" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif">${timeLabel}</text>
          </g>
        `;
      }).join('');

      return `
        <svg viewBox="0 0 ${width} ${height}" class="vitals-svg-chart" style="width: 100%; height: auto; overflow: visible;">
          <defs>
            <linearGradient id="glucoseGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#10b981" stop-opacity="0.25" />
              <stop offset="100%" stop-color="#10b981" stop-opacity="0.0" />
            </linearGradient>
          </defs>

          <!-- Normal Glycemic Zone (70-140 mg/dL) -->
          <rect x="${padding.left}" y="${getY(140)}" width="${chartW}" height="${getY(70) - getY(140)}" 
                fill="rgba(16, 185, 129, 0.08)" rx="4" />

          ${gridLines}

          <!-- Gradient Area & Curve -->
          <polygon points="${areaPoints}" fill="url(#glucoseGradient)" />
          <polyline points="${points}" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />

          ${markers}
        </svg>
      `;
    }
  };

  window.LuminaVitals = VitalsEngine;

})(window);
