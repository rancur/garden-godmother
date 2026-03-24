'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '../logo';
import { useAuth } from '../auth-context';
import {
  geocodeAddress,
  getFrostDates,
  updateProperty,
  markSetupComplete,
  updateUsdaZone,
  getSettings,
} from '../api';

// ── Zone estimation (same logic as settings page) ──

function estimateUsdaZone(lat: number, lon: number): string {
  if (lat >= 33.0 && lat <= 34.0 && lon >= -112.5 && lon <= -111.5) return '9b';
  if (lat >= 32.0 && lat <= 33.0 && lon >= -111.5 && lon <= -110.5) return '9a';
  if (lat >= 34.5 && lat <= 35.5 && lon >= -112.0 && lon <= -111.0) return '6a';
  if (lat >= 48) return '3b';
  if (lat >= 46) return '4a';
  if (lat >= 44) return '4b';
  if (lat >= 42) return '5a';
  if (lat >= 40) return '5b';
  if (lat >= 38) return '6a';
  if (lat >= 36) return '6b';
  if (lat >= 34) return '7a';
  if (lat >= 32) return '8a';
  if (lat >= 30) return '9a';
  if (lat >= 28) return '9b';
  if (lat >= 26) return '10a';
  if (lat >= 24) return '10b';
  return '11a';
}

function formatFrostDate(mmdd: string): string {
  if (!mmdd) return '--';
  const [mm, dd] = mmdd.split('-').map(Number);
  if (!mm || !dd) return mmdd;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[mm - 1]} ${dd}`;
}

// ── Steps ──

type Step = 'welcome' | 'location' | 'integrations' | 'done';
const STEPS: Step[] = ['welcome', 'location', 'integrations', 'done'];

export default function SetupPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>('welcome');
  const [saving, setSaving] = useState(false);

  // Location state
  const [addressQuery, setAddressQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [usdaZone, setUsdaZone] = useState('');
  const [lastFrost, setLastFrost] = useState('');
  const [firstFrost, setFirstFrost] = useState('');
  const [frostDays, setFrostDays] = useState(0);
  const [widthFeet, setWidthFeet] = useState('');
  const [heightFeet, setHeightFeet] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Integration state
  const [rachioKey, setRachioKey] = useState('');
  const [haUrl, setHaUrl] = useState('');
  const [haToken, setHaToken] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');

  // Check if already set up
  useEffect(() => {
    getSettings().then((s: any) => {
      if (s?.property?.address && s.property.address.length > 3) {
        setSelectedAddress(s.property.address);
        setLat(s.property.latitude);
        setLon(s.property.longitude);
        if (s.property.last_frost_spring) setLastFrost(s.property.last_frost_spring);
        if (s.property.first_frost_fall) setFirstFrost(s.property.first_frost_fall);
        if (s.property.width_feet) setWidthFeet(String(s.property.width_feet));
        if (s.property.height_feet) setHeightFeet(String(s.property.height_feet));
        const zone = localStorage.getItem('garden-usda-zone');
        if (zone) setUsdaZone(zone);
      }
    }).catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Address search with debounce
  const searchAddress = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 3) {
      setAddressSuggestions([]);
      setShowDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await geocodeAddress(q);
        setAddressSuggestions(Array.isArray(results) ? results.slice(0, 5) : []);
        setShowDropdown(true);
      } catch {
        setAddressSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  const selectAddress = async (addr: { display_name: string; lat: string; lon: string }) => {
    const newLat = parseFloat(addr.lat);
    const newLon = parseFloat(addr.lon);
    setSelectedAddress(addr.display_name);
    setAddressQuery(addr.display_name);
    setLat(newLat);
    setLon(newLon);
    setShowDropdown(false);

    // Auto-detect zone
    const zone = estimateUsdaZone(newLat, newLon);
    setUsdaZone(zone);

    // Fetch frost dates
    try {
      const frost = await getFrostDates(newLat, newLon);
      setLastFrost(frost.last_frost_spring);
      setFirstFrost(frost.first_frost_fall);
      setFrostDays(frost.frost_free_days || 0);
    } catch {
      // Frost date fetch failed
    }
  };

  const saveLocation = async () => {
    if (!selectedAddress || lat === null || lon === null) return;
    setSaving(true);
    try {
      await updateProperty({
        address: selectedAddress,
        latitude: lat,
        longitude: lon,
        width_feet: widthFeet ? parseInt(widthFeet) : undefined,
        height_feet: heightFeet ? parseInt(heightFeet) : undefined,
        last_frost_spring: lastFrost || undefined,
        first_frost_fall: firstFrost || undefined,
        frost_free_days: frostDays || undefined,
      });
      if (usdaZone) {
        localStorage.setItem('garden-usda-zone', usdaZone);
        await updateUsdaZone(usdaZone).catch(() => {});
      }
      setStep('integrations');
    } catch {
      // Save failed
    } finally {
      setSaving(false);
    }
  };

  const finishSetup = async () => {
    setSaving(true);
    try {
      await markSetupComplete();
      setStep('done');
    } catch {
      // Mark complete failed but move on anyway
      setStep('done');
    } finally {
      setSaving(false);
    }
  };

  const goToDashboard = () => {
    router.push('/');
  };

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="min-h-screen bg-earth-50 dark:bg-gray-900 flex flex-col items-center justify-center px-4 py-8">
      {/* Progress bar */}
      <div className="w-full max-w-lg mb-8">
        <div className="flex items-center justify-between mb-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                i <= stepIndex
                  ? 'bg-garden-600 text-white'
                  : 'bg-earth-200 dark:bg-gray-700 text-earth-400 dark:text-gray-500'
              }`}>
                {i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-0.5 w-12 sm:w-20 mx-1 transition-colors ${
                  i < stepIndex ? 'bg-garden-600' : 'bg-earth-200 dark:bg-gray-700'
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="w-full max-w-lg">
        {/* Step 1: Welcome */}
        {step === 'welcome' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm p-8 text-center">
            <div className="flex justify-center mb-4">
              <Logo size={64} />
            </div>
            <h1 className="text-2xl font-bold text-garden-700 dark:text-garden-400 mb-2">
              Welcome to Garden Godmother
            </h1>
            <p className="text-earth-500 dark:text-gray-400 mb-6 leading-relaxed">
              Your personal garden management system. Track plantings, plan your seasons,
              manage irrigation, and grow smarter with AI-powered insights.
            </p>
            <p className="text-earth-400 dark:text-gray-500 text-sm mb-8">
              Let&apos;s set up your garden in a few quick steps.
            </p>
            <button
              onClick={() => setStep('location')}
              className="w-full bg-garden-600 hover:bg-garden-700 text-white py-3 rounded-lg font-medium transition-colors text-base"
            >
              Get Started
            </button>
          </div>
        )}

        {/* Step 2: Garden Location */}
        {step === 'location' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm p-6">
            <h2 className="text-xl font-bold text-earth-800 dark:text-gray-100 mb-1">Garden Location</h2>
            <p className="text-earth-400 dark:text-gray-500 text-sm mb-6">
              Your address helps us detect your USDA zone, frost dates, and soil type automatically.
            </p>

            {/* Address search */}
            <div className="mb-4 relative" ref={dropdownRef}>
              <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Address</label>
              <input
                type="text"
                value={addressQuery || selectedAddress}
                onChange={(e) => {
                  setAddressQuery(e.target.value);
                  searchAddress(e.target.value);
                }}
                placeholder="Search for your address..."
                className="w-full px-3 py-2.5 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
              />
              {searching && (
                <div className="absolute right-3 top-9 text-earth-400 text-sm">Searching...</div>
              )}
              {showDropdown && addressSuggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border border-earth-200 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {addressSuggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => selectAddress(s)}
                      className="w-full text-left px-3 py-2 hover:bg-earth-50 dark:hover:bg-gray-600 text-sm text-earth-700 dark:text-gray-200 border-b border-earth-100 dark:border-gray-600 last:border-0"
                    >
                      {s.display_name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Auto-detected info */}
            {usdaZone && (
              <div className="mb-4 p-3 bg-garden-50 dark:bg-garden-900/20 border border-garden-200 dark:border-garden-800 rounded-lg">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-earth-500 dark:text-gray-400">USDA Zone:</span>{' '}
                    <span className="font-semibold text-garden-700 dark:text-garden-400">{usdaZone}</span>
                  </div>
                  {lastFrost && (
                    <div>
                      <span className="text-earth-500 dark:text-gray-400">Last Frost:</span>{' '}
                      <span className="font-semibold text-earth-700 dark:text-gray-200">{formatFrostDate(lastFrost)}</span>
                    </div>
                  )}
                  {firstFrost && (
                    <div>
                      <span className="text-earth-500 dark:text-gray-400">First Frost:</span>{' '}
                      <span className="font-semibold text-earth-700 dark:text-gray-200">{formatFrostDate(firstFrost)}</span>
                    </div>
                  )}
                  {frostDays > 0 && (
                    <div>
                      <span className="text-earth-500 dark:text-gray-400">Growing Season:</span>{' '}
                      <span className="font-semibold text-earth-700 dark:text-gray-200">~{frostDays} days</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Property dimensions */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div>
                <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Width (feet)</label>
                <input
                  type="number"
                  value={widthFeet}
                  onChange={(e) => setWidthFeet(e.target.value)}
                  placeholder="e.g. 50"
                  className="w-full px-3 py-2.5 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-earth-600 dark:text-gray-300 mb-1">Depth (feet)</label>
                <input
                  type="number"
                  value={heightFeet}
                  onChange={(e) => setHeightFeet(e.target.value)}
                  placeholder="e.g. 100"
                  className="w-full px-3 py-2.5 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('welcome')}
                className="px-4 py-2.5 border border-earth-300 dark:border-gray-600 rounded-lg text-earth-600 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700 transition-colors"
              >
                Back
              </button>
              <button
                onClick={saveLocation}
                disabled={!selectedAddress || saving}
                className="flex-1 bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
              >
                {saving ? 'Saving...' : 'Continue'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Integrations (optional) */}
        {step === 'integrations' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm p-6">
            <h2 className="text-xl font-bold text-earth-800 dark:text-gray-100 mb-1">Integrations</h2>
            <p className="text-earth-400 dark:text-gray-500 text-sm mb-6">
              Connect optional services. You can always set these up later in Settings.
            </p>

            <div className="space-y-4">
              {/* OpenAI */}
              <div className="p-4 border border-earth-200 dark:border-gray-700 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-earth-700 dark:text-gray-200">OpenAI</h3>
                    <p className="text-xs text-earth-400 dark:text-gray-500">AI-powered plant analysis, task suggestions</p>
                  </div>
                </div>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-sm"
                />
                <p className="text-xs text-earth-400 dark:text-gray-500 mt-1">
                  Get a key at{' '}
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-garden-600 dark:text-garden-400 underline">
                    platform.openai.com
                  </a>
                </p>
              </div>

              {/* Rachio */}
              <div className="p-4 border border-earth-200 dark:border-gray-700 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-earth-700 dark:text-gray-200">Rachio</h3>
                    <p className="text-xs text-earth-400 dark:text-gray-500">Smart irrigation integration</p>
                  </div>
                </div>
                <input
                  type="password"
                  value={rachioKey}
                  onChange={(e) => setRachioKey(e.target.value)}
                  placeholder="API key"
                  className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-sm"
                />
                <p className="text-xs text-earth-400 dark:text-gray-500 mt-1">
                  Find your key in the Rachio app under Account Settings
                </p>
              </div>

              {/* Home Assistant */}
              <div className="p-4 border border-earth-200 dark:border-gray-700 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-earth-700 dark:text-gray-200">Home Assistant</h3>
                    <p className="text-xs text-earth-400 dark:text-gray-500">Weather sensors, automations</p>
                  </div>
                </div>
                <input
                  type="text"
                  value={haUrl}
                  onChange={(e) => setHaUrl(e.target.value)}
                  placeholder="http://homeassistant.local:8123"
                  className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-sm mb-2"
                />
                <input
                  type="password"
                  value={haToken}
                  onChange={(e) => setHaToken(e.target.value)}
                  placeholder="Long-lived access token"
                  className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-garden-500 outline-none bg-white dark:bg-gray-700 dark:text-gray-100 text-sm"
                />
                <p className="text-xs text-earth-400 dark:text-gray-500 mt-1">
                  Create a token in HA under Profile &gt; Long-Lived Access Tokens
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStep('location')}
                className="px-4 py-2.5 border border-earth-300 dark:border-gray-600 rounded-lg text-earth-600 dark:text-gray-300 hover:bg-earth-50 dark:hover:bg-gray-700 transition-colors"
              >
                Back
              </button>
              <button
                onClick={finishSetup}
                disabled={saving}
                className="flex-1 bg-garden-600 hover:bg-garden-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
              >
                {saving ? 'Finishing...' : (rachioKey || openaiKey || haToken) ? 'Save & Finish' : 'Skip & Finish'}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 'done' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm p-8 text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-garden-100 dark:bg-garden-900/30 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-garden-600 dark:text-garden-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-garden-700 dark:text-garden-400 mb-2">
              Your garden is ready!
            </h2>
            <p className="text-earth-500 dark:text-gray-400 mb-6 leading-relaxed">
              {usdaZone
                ? `Set up for USDA Zone ${usdaZone}. `
                : ''}
              You can adjust all settings anytime from the Settings page.
            </p>
            <button
              onClick={goToDashboard}
              className="w-full bg-garden-600 hover:bg-garden-700 text-white py-3 rounded-lg font-medium transition-colors text-base"
            >
              Go to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
