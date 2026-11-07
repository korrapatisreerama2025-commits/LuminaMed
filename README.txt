> Why do I have a folder named ".vercel" in my project?
The ".vercel" folder is created when you link a directory to a Vercel project.

> What does the "project.json" file contain?
The "project.json" file contains:
- The ID of the Vercel project that you linked ("projectId")
- The ID of the user or team your Vercel project is owned by ("orgId")

> Should I commit the ".vercel" folder?
No, you should not share the ".vercel" folder with anyone.
Upon creation, it will be automatically added to your ".gitignore" file.


LuminaMed — Smart Light-Glass Medicine Reminder & Health Tracker
LuminaMed is a medicine reminder and health tracking web application crafted with a Light Glassmorphism aesthetic (backdrop-filter, silky pastel gradients, frosted translucent glass cards, crisp typography, and micro-animations).

🌟 Key Features
1. 📄 Scan & Upload Doctor's Medical Receipt (New!)
AI OCR & Medical Prescription Parser (
rxParser.js
):
Upload doctor prescription photos, clinic slips, or pharmacy receipts (JPG, PNG, WEBP).
Client-side neural OCR via Tesseract.js running in-browser with zero backend or API key required.
Automatically resolves doctor shorthand & frequency codes:
1-0-1 / BD / BID → 08:00 AM & 08:00 PM
1-1-1 / TDS / TID → 08:00 AM, 01:00 PM, 08:00 PM
1-0-0 / OD → 08:00 AM
0-0-1 / HS → 09:00 PM (Bedtime)
Food relations (After meal, Empty stomach, With food), course duration, and initial stock quantities.
Animated Laser Scanning Visualizer: Translucent glass preview frame with live scanning laser beam and progress indicator.
Editable Review Cards: Verify, tweak dosage or times, or deselect any medicine before importing.
"Try Sample Doctor's Receipt": One-click instant demonstration that generates a realistic doctor slip and extracts 4 prescriptions on the spot.
2. 🔔 Precision On-Time Audio Alarm
Zero-Dependency Web Audio API Synthesizer: Procedural acoustic chimes with 4 selectable sound profiles:
Crystal Medical Bell (Harmonic chime with shimmering overtones)
Harp Serenade (Warm, relaxing arpeggio)
Digital Health Pulse (Crisp high-clarity rhythmic tone for noisy environments)
Zen Gong & Resonator (Deep grounding tone)
Continuous Ringing Mode: Chime repeats every 3.5 seconds until acknowledged.
Visual Fullscreen Glass Alert: Pulsing ripple rings, medicine name, dosage, food intake instructions, and direct actions.
Snooze & Skip Logic: Configurable snooze durations (5m, 10m, 15m, 30m) with automatic re-triggering.
Browser & Desktop Notifications: Works alongside system notification banners for cross-tab alerts.
Haptic Vibration: Pulse vibration support on compatible mobile devices.
2. 💊 Complete Medicine & Inventory Tracking
Interactive Dosing Timeline: Chronologically organized for Morning, Afternoon, Evening, and Night.
One-Click Actions: Mark as Taken, Snooze, or Skip with timestamped audit logging.
Inventory & Refill Watchlist:
Live count of remaining pills/doses.
Automatic inventory decrement whenever a dose is marked as "Taken".
Low stock warning badges when supply falls below user-configured thresholds.
Quick Refill Modal (+10, +30, +60, +100 or custom amount).
Comprehensive Medication Profiles: Name, dosage (mg, ml, drops, puffs), form (Tablet, Capsule, Syrup, Injection, Drops, Inhaler), multiple scheduled times, meal relations (Before meal, With meal, After meal, Bedtime), color themes, and doctor prescription notes.
3. 📊 Adherence & Dynamic Countdowns
Real-Time Countdown: Live second-by-second countdown to your immediate next dose (e.g., in 14m 20s (Metformin)).
Daily Adherence Ring & Progress: Live ratio of doses taken vs. scheduled today (Adherence %).
History Audit Trail: Log of all intakes, snoozes, and skips with date, time, dose, and status.
🎨 Design Philosophy: Light Theme Glassmorphism
Translucent Frosted Panels: rgba(255, 255, 255, 0.72) with backdrop-filter: blur(20px) saturate(180%).
Soft Ambient Glow Orbs: Subtle background gradients in cyan, lavender, and mint.
Deep Slate Typography: Ultra-crisp #0f172a text using Plus Jakarta Sans and Outfit for contrast and legibility.
Micro-interactions: Hover lifts, smooth tab transitions, and animated pulsing alarm icons.
🚀 How to Run Locally
The application is already running on your local machine:

Local URL: http://localhost:3000
To start or stop it manually at any time:

bash

# Navigate to project folder
cd "c:\Users\Korra\Downloads\New folder"
# Run with Python
python -m http.server 3000
Or simply open 
index.html
 directly in any modern browser.

📁 Project Structure
index.html
: Semantic layout, accessible modal dialogs, and alarm overlays.
styles.css
: Complete light glassmorphism styling, animations, and responsive layout.
audio.js
: Procedural Web Audio API synthesizer chime engine.
app.js
: Application state, alarms scheduler, inventory tracker, and adherence calculations.
