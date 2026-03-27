'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  getMyPlantings,
  getJournalFeed,
  getSensorWeather,
  getSensorForecast,
  createJournalEntry,
  getBeds,
  getGroundPlants,
} from '../../api';
import { getPlantIcon } from '../../plant-icons';
import { useToast } from '../../toast';
import { getGardenTimezone } from '../../timezone';
import { Skeleton, CardSkeleton } from '../../skeleton';

// -- Types --

interface MyPlanting {
  id: number;
  plant_id: number;
  plant_name: string;
  category: string;
  status: string;
  planted_date: string | null;
  container_name: string | null;
  container_type: 'planter' | 'ground' | 'tray';
  container_id: number;
  variety_name: string | null;
  emoji: string | null;
}

interface JournalFeedEntry {
  id: number | string;
  entry_type: string;
  plant_id: number | null;
  planting_id: number | null;
  ground_plant_id: number | null;
  created_at: string;
}

interface WeatherData {
  temperature?: number;
  humidity?: number;
  condition?: string;
}

interface ForecastDay {
  date?: string;
  high?: number;
  low?: number;
  condition?: string;
  tempmax?: number;
  tempmin?: number;
}

interface Suggestion {
  id: string;
  type: 'check-in' | 'harvest-check' | 'heat-check' | 'cold-check' | 'watering' | 'new-planting' | 'milestone';
  icon: string;
  title: string;
  subtitle: string;
  prompt: string;
  quickActions: { label: string; entryContent: string; entryType: string; mood?: string; milestone_type?: string }[];
  planting?: MyPlanting;
  priority: number; // lower = higher priority
}

// -- Screen enum --
type Screen = 'dashboard' | 'photo' | 'voice';

// -- Greeting based on time of day --
function getGreeting(): string {
  const tz = getGardenTimezone();
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date()),
    10
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function daysUntilHarvest(plantedDate: string | null, daysToMaturity: number | null): number | null {
  if (!plantedDate || !daysToMaturity) return null;
  const planted = new Date(plantedDate);
  const harvestDate = new Date(planted.getTime() + daysToMaturity * 86400000);
  return Math.floor((harvestDate.getTime() - Date.now()) / 86400000);
}

// -- Component --

export default function SmartJournalPage() {
  const { toast } = useToast();

  const [screen, setScreen] = useState<Screen>('dashboard');
  const [loading, setLoading] = useState(true);
  const [plantings, setPlantings] = useState<MyPlanting[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalFeedEntry[]>([]);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  // Photo flow state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoPlanting, setPhotoPlanting] = useState<MyPlanting | null>(null);
  const [photoNote, setPhotoNote] = useState('');
  const [photoSubmitting, setPhotoSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Voice flow state
  const [isRecording, setIsRecording] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const [voicePlanting, setVoicePlanting] = useState<MyPlanting | null>(null);
  const [voiceSubmitting, setVoiceSubmitting] = useState(false);
  const pulseRef = useRef<HTMLButtonElement>(null);

  // Load data
  useEffect(() => {
    setLoading(true);
    Promise.all([
      getMyPlantings().catch(() => []),
      getJournalFeed({ limit: 100 }).catch(() => []),
      getSensorWeather().catch(() => null),
      getSensorForecast().catch(() => []),
    ])
      .then(([p, j, w, f]) => {
        setPlantings(Array.isArray(p) ? p : []);
        setJournalEntries(Array.isArray(j) ? j : []);
        setWeather(w);
        // Forecast can be nested
        const forecastArr = Array.isArray(f) ? f : (f?.days || f?.forecast || []);
        setForecast(Array.isArray(forecastArr) ? forecastArr : []);
      })
      .finally(() => setLoading(false));
  }, []);

  // Generate suggestions from real data
  const suggestions = useMemo<Suggestion[]>(() => {
    const result: Suggestion[] = [];
    const now = Date.now();
    const activePlantings = plantings.filter(p => ['planted', 'growing', 'sprouted', 'flowering', 'fruiting', 'established'].includes(p.status));

    // Map planting IDs to last journal entry date
    const lastObserved: Record<string, number> = {};
    for (const entry of journalEntries) {
      const key = entry.planting_id ? `planting:${entry.planting_id}` : entry.ground_plant_id ? `ground:${entry.ground_plant_id}` : null;
      if (key && (!lastObserved[key] || new Date(entry.created_at).getTime() > lastObserved[key])) {
        lastObserved[key] = new Date(entry.created_at).getTime();
      }
    }

    // Plants not observed in 3+ days
    for (const p of activePlantings) {
      const key = p.container_type === 'ground' ? `ground:${p.id}` : `planting:${p.id}`;
      const lastSeen = lastObserved[key];
      const daysSinceObs = lastSeen ? Math.floor((now - lastSeen) / 86400000) : 999;
      const age = daysSince(p.planted_date);

      if (daysSinceObs >= 3) {
        const icon = getPlantIcon(p.plant_name, p.category);
        const locationStr = p.container_name || 'garden';

        // Check growth stage for tailored prompts
        if (p.status === 'planted' || p.status === 'sprouted') {
          result.push({
            id: `checkin-${key}`,
            type: 'check-in',
            icon,
            title: `${p.plant_name}${p.variety_name ? ` (${p.variety_name})` : ''}`,
            subtitle: `Day ${age}, ${locationStr}`,
            prompt: p.status === 'planted' ? 'Any sprouts yet?' : 'How is it growing?',
            quickActions: [
              { label: 'Sprouted!', entryContent: `${p.plant_name} has sprouted on day ${age}.`, entryType: 'milestone', milestone_type: 'sprouted' },
              { label: 'Not yet', entryContent: `Checked ${p.plant_name} on day ${age} - no sprouts yet.`, entryType: 'observation' },
              { label: 'Problem spotted', entryContent: `Issue noticed with ${p.plant_name} on day ${age}.`, entryType: 'problem' },
            ],
            planting: p,
            priority: 1,
          });
        } else if (p.status === 'growing') {
          result.push({
            id: `checkin-${key}`,
            type: 'check-in',
            icon,
            title: `${p.plant_name}${p.variety_name ? ` (${p.variety_name})` : ''}`,
            subtitle: `Day ${age}, ${locationStr}`,
            prompt: 'Flowering yet?',
            quickActions: [
              { label: 'Yes, flowering!', entryContent: `${p.plant_name} started flowering on day ${age}!`, entryType: 'milestone', milestone_type: 'flowering', mood: 'great' },
              { label: 'Not yet', entryContent: `Checked ${p.plant_name} on day ${age} - still growing, no flowers yet.`, entryType: 'observation' },
              { label: 'Problem spotted', entryContent: `Issue noticed with ${p.plant_name} on day ${age}.`, entryType: 'problem' },
            ],
            planting: p,
            priority: 2,
          });
        } else if (p.status === 'flowering') {
          result.push({
            id: `checkin-${key}`,
            type: 'check-in',
            icon,
            title: `${p.plant_name}${p.variety_name ? ` (${p.variety_name})` : ''}`,
            subtitle: `Day ${age}, ${locationStr}`,
            prompt: 'Setting fruit yet?',
            quickActions: [
              { label: 'Fruiting!', entryContent: `${p.plant_name} is setting fruit on day ${age}!`, entryType: 'milestone', milestone_type: 'fruiting', mood: 'great' },
              { label: 'Still flowering', entryContent: `${p.plant_name} still flowering on day ${age}, looking good.`, entryType: 'observation', mood: 'good' },
              { label: 'Problem spotted', entryContent: `Issue noticed with ${p.plant_name} on day ${age}.`, entryType: 'problem' },
            ],
            planting: p,
            priority: 2,
          });
        } else if (p.status === 'fruiting') {
          result.push({
            id: `checkin-${key}`,
            type: 'harvest-check',
            icon,
            title: `${p.plant_name}${p.variety_name ? ` (${p.variety_name})` : ''}`,
            subtitle: `Day ${age}, ${locationStr}`,
            prompt: 'Ready to harvest?',
            quickActions: [
              { label: 'Harvested today', entryContent: `Harvested ${p.plant_name} on day ${age}!`, entryType: 'harvest', mood: 'great' },
              { label: 'Not ready', entryContent: `Checked ${p.plant_name} on day ${age} - fruit not ready yet.`, entryType: 'observation' },
              { label: 'Problem spotted', entryContent: `Issue noticed with ${p.plant_name} fruit on day ${age}.`, entryType: 'problem' },
            ],
            planting: p,
            priority: 1,
          });
        } else {
          result.push({
            id: `checkin-${key}`,
            type: 'check-in',
            icon,
            title: `${p.plant_name}${p.variety_name ? ` (${p.variety_name})` : ''}`,
            subtitle: `Day ${age}, ${locationStr}`,
            prompt: daysSinceObs > 7 ? `Haven't checked in ${daysSinceObs} days` : 'How does it look?',
            quickActions: [
              { label: 'All good', entryContent: `${p.plant_name} looking healthy on day ${age}.`, entryType: 'observation', mood: 'good' },
              { label: 'Spotted an issue', entryContent: `Issue noticed with ${p.plant_name} on day ${age}.`, entryType: 'problem' },
            ],
            planting: p,
            priority: daysSinceObs > 7 ? 0 : 3,
          });
        }
      }
    }

    // Weather-based suggestions
    const currentTemp = weather?.temperature;
    if (currentTemp !== undefined && currentTemp !== null) {
      if (currentTemp > 100) {
        result.push({
          id: 'heat-stress',
          type: 'heat-check',
          icon: '\uD83C\uDF21\uFE0F',
          title: `Heat wave - ${Math.round(currentTemp)}\u00B0F right now`,
          subtitle: 'Extreme heat can stress plants quickly',
          prompt: 'Any heat stress signs?',
          quickActions: [
            { label: 'Plants look fine', entryContent: `Heat check at ${Math.round(currentTemp)}\u00B0F - all plants handling the heat well.`, entryType: 'weather', mood: 'good' },
            { label: 'Some wilting', entryContent: `Heat stress observed at ${Math.round(currentTemp)}\u00B0F - some plants wilting.`, entryType: 'weather', mood: 'concerned' },
            { label: 'Need shade cloth', entryContent: `Severe heat stress at ${Math.round(currentTemp)}\u00B0F - need to set up shade protection.`, entryType: 'problem', mood: 'bad' },
          ],
          priority: 0,
        });
      } else if (currentTemp > 95) {
        result.push({
          id: 'warm-check',
          type: 'heat-check',
          icon: '\u2600\uFE0F',
          title: `Hot day - ${Math.round(currentTemp)}\u00B0F`,
          subtitle: 'Keep an eye on water-loving plants',
          prompt: 'How do things look in the heat?',
          quickActions: [
            { label: 'All good', entryContent: `Warm day check at ${Math.round(currentTemp)}\u00B0F - plants doing fine.`, entryType: 'observation', mood: 'good' },
            { label: 'Some stress', entryContent: `Some heat stress visible at ${Math.round(currentTemp)}\u00B0F.`, entryType: 'observation', mood: 'concerned' },
          ],
          priority: 2,
        });
      } else if (currentTemp < 40) {
        result.push({
          id: 'cold-check',
          type: 'cold-check',
          icon: '\u2744\uFE0F',
          title: `Cold snap - ${Math.round(currentTemp)}\u00B0F`,
          subtitle: 'Check for frost damage',
          prompt: 'Any cold damage?',
          quickActions: [
            { label: 'All protected', entryContent: `Cold check at ${Math.round(currentTemp)}\u00B0F - all plants protected and fine.`, entryType: 'weather', mood: 'good' },
            { label: 'Frost damage', entryContent: `Frost damage observed at ${Math.round(currentTemp)}\u00B0F.`, entryType: 'problem', mood: 'bad' },
          ],
          priority: 0,
        });
      }
    }

    // Upcoming extreme weather from forecast
    for (const day of forecast.slice(0, 5)) {
      const high = day.high ?? day.tempmax;
      const dateStr = day.date;
      if (high && high > 105 && dateStr) {
        const dayName = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' });
        result.push({
          id: `forecast-heat-${dateStr}`,
          type: 'heat-check',
          icon: '\uD83D\uDD25',
          title: `${Math.round(high)}\u00B0F coming ${dayName}`,
          subtitle: 'Prepare shade and extra watering',
          prompt: 'Ready for the heat?',
          quickActions: [
            { label: 'Prep done', entryContent: `Prepared garden for ${Math.round(high)}\u00B0F heat on ${dayName} - shade cloth and extra water.`, entryType: 'note', mood: 'good' },
            { label: 'Need to prep', entryContent: `${Math.round(high)}\u00B0F coming ${dayName} - need to set up heat protection.`, entryType: 'note', mood: 'concerned' },
          ],
          priority: 1,
        });
        break; // Only show one forecast warning
      }
    }

    // If no check-ins needed but there are active plantings, add a general prompt
    if (result.length === 0 && activePlantings.length > 0) {
      result.push({
        id: 'garden-check',
        type: 'check-in',
        icon: '\uD83C\uDF3B',
        title: 'Garden Check-in',
        subtitle: `${activePlantings.length} active plantings`,
        prompt: 'How does the garden look today?',
        quickActions: [
          { label: 'Everything thriving', entryContent: 'Garden looking great today - all plants healthy and thriving.', entryType: 'observation', mood: 'great' },
          { label: 'Pretty good', entryContent: 'Garden check - things are looking pretty good overall.', entryType: 'observation', mood: 'good' },
          { label: 'Something needs attention', entryContent: 'Garden check - noticed something that needs attention.', entryType: 'problem', mood: 'concerned' },
        ],
        priority: 5,
      });
    }

    return result.sort((a, b) => a.priority - b.priority);
  }, [plantings, journalEntries, weather, forecast]);

  // Quick action handler
  const handleQuickAction = useCallback(async (suggestion: Suggestion, action: Suggestion['quickActions'][0]) => {
    const id = `${suggestion.id}-${action.label}`;
    setSubmittingId(id);
    try {
      const data: Parameters<typeof createJournalEntry>[0] = {
        entry_type: action.entryType,
        content: action.entryContent,
      };
      if (action.mood) data.mood = action.mood;
      if (action.milestone_type) data.milestone_type = action.milestone_type;

      if (suggestion.planting) {
        if (suggestion.planting.container_type === 'ground') {
          data.ground_plant_id = suggestion.planting.id;
        } else {
          data.planting_id = suggestion.planting.id;
        }
        data.plant_id = suggestion.planting.plant_id;
      }

      await createJournalEntry(data);
      toast('Journal entry saved!', 'success');
      // Refresh journal entries
      const updated = await getJournalFeed({ limit: 100 }).catch(() => []);
      setJournalEntries(Array.isArray(updated) ? updated : []);
    } catch {
      toast('Failed to save entry', 'error');
    } finally {
      setSubmittingId(null);
    }
  }, [toast]);

  // Photo handlers
  const handlePhotoCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    // Suggest the most recently active planting
    const active = plantings.filter(p => ['planted', 'growing', 'sprouted', 'flowering', 'fruiting'].includes(p.status));
    if (active.length > 0) setPhotoPlanting(active[0]);
  }, [plantings]);

  const handlePhotoSave = useCallback(async () => {
    if (!photoFile) return;
    setPhotoSubmitting(true);
    try {
      const data: Parameters<typeof createJournalEntry>[0] = {
        entry_type: 'photo',
        content: photoNote || `Photo observation${photoPlanting ? ` of ${photoPlanting.plant_name}` : ''}`,
      };
      if (photoPlanting) {
        data.plant_id = photoPlanting.plant_id;
        if (photoPlanting.container_type === 'ground') {
          data.ground_plant_id = photoPlanting.id;
        } else {
          data.planting_id = photoPlanting.id;
        }
      }
      await createJournalEntry(data);
      toast('Photo observation saved!', 'success');
      setPhotoFile(null);
      setPhotoPreview(null);
      setPhotoNote('');
      setPhotoPlanting(null);
      setScreen('dashboard');
    } catch {
      toast('Failed to save photo entry', 'error');
    } finally {
      setPhotoSubmitting(false);
    }
  }, [photoFile, photoNote, photoPlanting, toast]);

  // Voice handlers (simulated - shows the UX concept)
  const handleVoiceSave = useCallback(async () => {
    if (!voiceNote.trim()) return;
    setVoiceSubmitting(true);
    try {
      const data: Parameters<typeof createJournalEntry>[0] = {
        entry_type: 'observation',
        content: voiceNote,
      };
      if (voicePlanting) {
        data.plant_id = voicePlanting.plant_id;
        if (voicePlanting.container_type === 'ground') {
          data.ground_plant_id = voicePlanting.id;
        } else {
          data.planting_id = voicePlanting.id;
        }
      }
      await createJournalEntry(data);
      toast('Voice note saved!', 'success');
      setVoiceNote('');
      setVoicePlanting(null);
      setScreen('dashboard');
    } catch {
      toast('Failed to save voice note', 'error');
    } finally {
      setVoiceSubmitting(false);
    }
  }, [voiceNote, voicePlanting, toast]);

  // Weather summary line
  const weatherLine = useMemo(() => {
    if (!weather?.temperature) return null;
    const temp = Math.round(weather.temperature);
    const condition = weather.condition || '';
    return `${temp}\u00B0F${condition ? `, ${condition.toLowerCase()}` : ''} today`;
  }, [weather]);

  // -- Render --

  if (screen === 'photo') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => { setScreen('dashboard'); setPhotoFile(null); setPhotoPreview(null); }} className="p-2 rounded-lg hover:bg-earth-100 dark:hover:bg-gray-700 transition-colors">
            <svg className="w-5 h-5 text-earth-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Quick Photo</h1>
        </div>

        {!photoPreview ? (
          <div className="flex flex-col items-center gap-6 py-12">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-32 h-32 rounded-full bg-garden-600 hover:bg-garden-700 transition-all shadow-lg hover:shadow-xl flex items-center justify-center active:scale-95"
            >
              <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <p className="text-earth-500 dark:text-gray-400 text-sm">Tap to take a photo or choose from gallery</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoCapture}
            />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Photo preview */}
            <div className="rounded-xl overflow-hidden border border-earth-200 dark:border-gray-700 shadow-sm">
              <img src={photoPreview} alt="Captured" className="w-full max-h-80 object-cover" />
            </div>

            {/* What's this about? */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm space-y-4">
              <p className="font-semibold text-earth-800 dark:text-gray-100">What&apos;s this about?</p>

              {/* Suggested plant */}
              <div className="flex flex-wrap gap-2">
                {plantings
                  .filter(p => ['planted', 'growing', 'sprouted', 'flowering', 'fruiting'].includes(p.status))
                  .slice(0, 8)
                  .map(p => (
                    <button
                      key={p.id}
                      onClick={() => setPhotoPlanting(p)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                        photoPlanting?.id === p.id
                          ? 'bg-garden-600 text-white ring-2 ring-garden-300'
                          : 'bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-300 hover:bg-earth-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {getPlantIcon(p.plant_name, p.category)} {p.plant_name}
                    </button>
                  ))}
                <button
                  onClick={() => setPhotoPlanting(null)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    !photoPlanting
                      ? 'bg-garden-600 text-white ring-2 ring-garden-300'
                      : 'bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-300 hover:bg-earth-200 dark:hover:bg-gray-600'
                  }`}
                >
                  General
                </button>
              </div>

              {/* Optional note */}
              <textarea
                value={photoNote}
                onChange={(e) => setPhotoNote(e.target.value)}
                placeholder="Add a note (optional)..."
                className="w-full px-3 py-2 border border-earth-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-earth-800 dark:text-gray-100 text-sm focus:ring-2 focus:ring-garden-500 focus:border-transparent resize-none"
                rows={2}
              />

              <button
                onClick={handlePhotoSave}
                disabled={photoSubmitting}
                className="w-full py-3 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition-colors font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {photoSubmitting ? (
                  <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                ) : null}
                Save as observation{photoPlanting ? ` for ${photoPlanting.plant_name}` : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (screen === 'voice') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => { setScreen('dashboard'); setVoiceNote(''); }} className="p-2 rounded-lg hover:bg-earth-100 dark:hover:bg-gray-700 transition-colors">
            <svg className="w-5 h-5 text-earth-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Voice Note</h1>
        </div>

        <div className="flex flex-col items-center gap-6 py-8">
          {!voiceNote ? (
            <>
              {/* Pulsing record button */}
              <div className="relative">
                {isRecording && (
                  <>
                    <div className="absolute inset-0 rounded-full bg-red-400/30 animate-ping" style={{ animationDuration: '1.5s' }} />
                    <div className="absolute -inset-4 rounded-full bg-red-400/10 animate-pulse" />
                  </>
                )}
                <button
                  onMouseDown={() => setIsRecording(true)}
                  onMouseUp={() => {
                    setIsRecording(false);
                    // Simulated transcription for prototype
                    setVoiceNote('The tomatoes are looking great today, I can see several new flowers opening up. The basil next to them seems a little droopy though, might need more water.');
                    const active = plantings.filter(p => ['planted', 'growing', 'sprouted', 'flowering', 'fruiting'].includes(p.status));
                    if (active.length > 0) setVoicePlanting(active[0]);
                  }}
                  onTouchStart={() => setIsRecording(true)}
                  onTouchEnd={() => {
                    setIsRecording(false);
                    setVoiceNote('The tomatoes are looking great today, I can see several new flowers opening up. The basil next to them seems a little droopy though, might need more water.');
                    const active = plantings.filter(p => ['planted', 'growing', 'sprouted', 'flowering', 'fruiting'].includes(p.status));
                    if (active.length > 0) setVoicePlanting(active[0]);
                  }}
                  ref={pulseRef}
                  className={`relative w-28 h-28 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                    isRecording
                      ? 'bg-red-500 shadow-lg shadow-red-500/30 scale-110'
                      : 'bg-garden-600 hover:bg-garden-700 shadow-lg hover:shadow-xl'
                  }`}
                >
                  <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
                  </svg>
                </button>
              </div>
              <p className="text-earth-500 dark:text-gray-400 text-sm font-medium">
                {isRecording ? (
                  <span className="text-red-500 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    Recording... Release to save
                  </span>
                ) : (
                  'Hold to record'
                )}
              </p>
            </>
          ) : (
            <div className="w-full space-y-4">
              {/* Transcription preview */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm space-y-4">
                <div className="flex items-center gap-2 text-xs text-earth-500 dark:text-gray-400 uppercase tracking-wide font-semibold">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                  Transcription
                </div>
                <textarea
                  value={voiceNote}
                  onChange={(e) => setVoiceNote(e.target.value)}
                  className="w-full px-3 py-2 border border-earth-200 dark:border-gray-600 rounded-lg bg-earth-50 dark:bg-gray-900 text-earth-800 dark:text-gray-100 text-sm focus:ring-2 focus:ring-garden-500 focus:border-transparent resize-none"
                  rows={4}
                />

                {/* Plant selector */}
                <div>
                  <p className="text-sm font-medium text-earth-700 dark:text-gray-300 mb-2">Link to plant:</p>
                  <div className="flex flex-wrap gap-2">
                    {plantings
                      .filter(p => ['planted', 'growing', 'sprouted', 'flowering', 'fruiting'].includes(p.status))
                      .slice(0, 6)
                      .map(p => (
                        <button
                          key={p.id}
                          onClick={() => setVoicePlanting(voicePlanting?.id === p.id ? null : p)}
                          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                            voicePlanting?.id === p.id
                              ? 'bg-garden-600 text-white ring-2 ring-garden-300'
                              : 'bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-300 hover:bg-earth-200 dark:hover:bg-gray-600'
                          }`}
                        >
                          {getPlantIcon(p.plant_name, p.category)} {p.plant_name}
                        </button>
                      ))}
                  </div>
                </div>

                <button
                  onClick={handleVoiceSave}
                  disabled={voiceSubmitting}
                  className="w-full py-3 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition-colors font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {voiceSubmitting ? (
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  ) : null}
                  Save as observation{voicePlanting ? ` for ${voicePlanting.plant_name}` : ''}
                </button>
              </div>

              <button
                onClick={() => { setVoiceNote(''); setVoicePlanting(null); }}
                className="w-full py-2 text-earth-500 dark:text-gray-400 text-sm hover:text-earth-700 dark:hover:text-gray-200 transition-colors"
              >
                Re-record
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // -- Dashboard --
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/journal" className="p-1.5 rounded-lg hover:bg-earth-100 dark:hover:bg-gray-700 transition-colors">
              <svg className="w-5 h-5 text-earth-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Smart Journal</h1>
            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">beta</span>
          </div>
          {!loading && weatherLine && (
            <p className="text-sm text-earth-500 dark:text-gray-400 mt-1 ml-9">
              {getGreeting()}! {weatherLine} &mdash; here&apos;s what needs attention:
            </p>
          )}
        </div>
      </div>

      {/* Quick Action Bar */}
      <div className="flex gap-3">
        <button
          onClick={() => setScreen('photo')}
          className="flex-1 py-4 bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all flex flex-col items-center gap-2 active:scale-[0.98]"
        >
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <span className="text-xs font-semibold text-earth-700 dark:text-gray-300">Quick Photo</span>
        </button>
        <button
          onClick={() => setScreen('voice')}
          className="flex-1 py-4 bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all flex flex-col items-center gap-2 active:scale-[0.98]"
        >
          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
            </svg>
          </div>
          <span className="text-xs font-semibold text-earth-700 dark:text-gray-300">Voice Note</span>
        </button>
        <Link
          href="/journal"
          className="flex-1 py-4 bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all flex flex-col items-center gap-2 active:scale-[0.98]"
        >
          <div className="w-10 h-10 rounded-full bg-garden-100 dark:bg-garden-900/30 flex items-center justify-center">
            <svg className="w-5 h-5 text-garden-600 dark:text-garden-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <span className="text-xs font-semibold text-earth-700 dark:text-gray-300">Full Entry</span>
        </Link>
      </div>

      {/* Suggestion Cards */}
      {loading ? (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : suggestions.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-8 shadow-sm text-center">
          <div className="text-4xl mb-3">{'\uD83C\uDF3F'}</div>
          <p className="text-earth-700 dark:text-gray-300 font-semibold">All caught up!</p>
          <p className="text-earth-500 dark:text-gray-400 text-sm mt-1">No plants need attention right now. Check back later or add a new entry.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {suggestions.map((s) => (
            <div
              key={s.id}
              className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0 mt-0.5">{s.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-earth-800 dark:text-gray-100 text-sm">{s.title}</span>
                    {s.priority === 0 && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">urgent</span>
                    )}
                  </div>
                  <p className="text-xs text-earth-500 dark:text-gray-400 mt-0.5">{s.subtitle}</p>
                  <p className="text-sm text-earth-700 dark:text-gray-300 mt-2 italic">&ldquo;{s.prompt}&rdquo;</p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {s.quickActions.map((action) => {
                      const actionId = `${s.id}-${action.label}`;
                      const isSubmitting = submittingId === actionId;
                      return (
                        <button
                          key={action.label}
                          onClick={() => handleQuickAction(s, action)}
                          disabled={!!submittingId}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all active:scale-95 disabled:opacity-50 ${
                            action.entryType === 'problem'
                              ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-800'
                              : action.entryType === 'milestone' || action.entryType === 'harvest'
                              ? 'bg-garden-50 dark:bg-garden-900/20 text-garden-700 dark:text-garden-300 hover:bg-garden-100 dark:hover:bg-garden-900/30 border border-garden-200 dark:border-garden-800'
                              : 'bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-300 hover:bg-earth-200 dark:hover:bg-gray-600 border border-earth-200 dark:border-gray-600'
                          }`}
                        >
                          {isSubmitting ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
                              Saving...
                            </span>
                          ) : (
                            action.label
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stats footer */}
      {!loading && plantings.length > 0 && (
        <div className="bg-earth-50 dark:bg-gray-800/50 rounded-xl border border-earth-200 dark:border-gray-700 p-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-lg font-bold text-garden-600 dark:text-garden-400">
                {plantings.filter(p => ['planted', 'growing', 'sprouted', 'flowering', 'fruiting', 'established'].includes(p.status)).length}
              </div>
              <div className="text-xs text-earth-500 dark:text-gray-400">Active Plants</div>
            </div>
            <div>
              <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                {suggestions.length}
              </div>
              <div className="text-xs text-earth-500 dark:text-gray-400">Need Attention</div>
            </div>
            <div>
              <div className="text-lg font-bold text-purple-600 dark:text-purple-400">
                {journalEntries.filter(e => {
                  const d = new Date(e.created_at);
                  const now = new Date();
                  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
                }).length}
              </div>
              <div className="text-xs text-earth-500 dark:text-gray-400">Entries Today</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
