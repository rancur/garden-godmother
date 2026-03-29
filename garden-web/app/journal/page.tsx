'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  getJournalFeed,
  getJournalSuggestions,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  getPhotoUrl,
  getPlants,
  getPlantings,
  getBeds,
  getTrays,
  getGroundPlants,
  getRecentPhotos,
  analyzePhoto,
  getPhotoAnalysis,
  uploadJournalPhotos,
  deleteJournalPhoto,
  getJournalPhotoUrl,
  getExportUrl,
  undoAction,
  generateJournalSummary,
  getPlantTimeline,
  createVoiceNote,
  createPhotoJournalEntry,
} from '../api';
import { getPlantIcon } from '../plant-icons';
import { TypeaheadSelect, TypeaheadOption } from '../typeahead-select';
import { useToast } from '../toast';
import { useModal } from '../confirm-modal';
import { formatGardenDate, getGardenYear } from '../timezone';
import { PullToRefresh } from '../components/PullToRefresh';
import { VoiceRecorder } from '../components/VoiceRecorder';

// -- Types --

interface JournalPhoto {
  id: number;
  filename: string;
  original_filename: string | null;
  caption: string | null;
  created_at: string;
}

interface FeedEntry {
  id: number | string;
  entry_type: string;
  title: string | null;
  content: string;
  plant_id: number | null;
  plant_name: string | null;
  planting_id: number | null;
  bed_id: number | null;
  bed_name: string | null;
  tray_id: number | null;
  tray_name: string | null;
  ground_plant_id: number | null;
  ground_plant_name: string | null;
  photo_id: number | null;
  mood: string | null;
  tags: string[];
  created_at: string;
  source: string;
  category?: string;
  severity?: string;
  milestone_type?: string;
  area_name?: string;
  note_type?: string;
  photos?: JournalPhoto[];
  photo_count?: number;
}

interface AnalysisIssue {
  type: string;
  name: string;
  severity: string;
  description: string;
}

interface PhotoAnalysis {
  photo_id: number;
  plant_identified: string;
  growth_stage: string;
  health: string;
  issues: AnalysisIssue[];
  recommendations: string[];
  confidence: string;
  summary: string;
}

interface QuickAction {
  label: string;
  content: string;
  entry_type: string;
  mood?: string;
  milestone_type?: string;
}

interface Suggestion {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  prompt: string;
  quick_actions: QuickAction[];
  plant_name?: string;
  category?: string;
  planting_id?: number;
  ground_plant_id?: number;
  plant_id?: number;
  container_type?: string;
  days_since_observed?: number;
  status?: string;
  age_days?: number;
  priority: number;
}

// -- Constants --

const ENTRY_TYPES = [
  { value: 'observation', label: 'Observation', icon: '\u{1F440}', description: 'General note' },
  { value: 'harvest', label: 'Harvest', icon: '\u{1F9FA}', description: 'Record a harvest' },
  { value: 'problem', label: 'Problem', icon: '\u26A0\uFE0F', description: 'Issue or concern' },
  { value: 'milestone', label: 'Milestone', icon: '\u{1F389}', description: 'Growth milestone' },
  { value: 'note', label: 'Note', icon: '\u{1F4DD}', description: 'Quick note' },
  { value: 'weather', label: 'Weather', icon: '\u{1F324}\uFE0F', description: 'Weather event' },
  { value: 'photo', label: 'Photo', icon: '\u{1F4F7}', description: 'Photo only' },
];

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700' },
  { value: 'medium', label: 'Medium', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300 border-orange-300 dark:border-orange-700' },
  { value: 'high', label: 'High', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300 border-red-300 dark:border-red-700' },
  { value: 'critical', label: 'Critical', color: 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-200 border-red-400 dark:border-red-600' },
];

const MILESTONE_OPTIONS = [
  { value: 'sprouted', label: 'Sprouted', icon: '\u{1F331}' },
  { value: 'flowering', label: 'Flowering', icon: '\u{1F33C}' },
  { value: 'fruiting', label: 'Fruiting', icon: '\u{1F345}' },
  { value: 'first_harvest', label: 'First Harvest', icon: '\u{1F389}' },
  { value: 'established', label: 'Established', icon: '\u{1F333}' },
];

const MOODS = [
  { value: 'great', label: 'Great', icon: '\u{1F60A}' },
  { value: 'good', label: 'Good', icon: '\u{1F642}' },
  { value: 'okay', label: 'Okay', icon: '\u{1F610}' },
  { value: 'concerned', label: 'Concerned', icon: '\u{1F61F}' },
  { value: 'bad', label: 'Bad', icon: '\u{1F61E}' },
];

const FILTER_TABS = [
  { value: '', label: 'All' },
  { value: 'note', label: 'Notes' },
  { value: 'observation', label: 'Observations' },
  { value: 'photo', label: 'Photos' },
  { value: 'problem', label: 'Problems' },
  { value: 'milestone', label: 'Milestones' },
  { value: 'weather', label: 'Weather' },
  { value: 'harvest', label: 'Harvest' },
];

function typeIcon(entryType: string): string {
  return ENTRY_TYPES.find((t) => t.value === entryType)?.icon || '\u{1F4DD}';
}

function moodIcon(mood: string | null): string {
  if (!mood) return '';
  return MOODS.find((m) => m.value === mood)?.icon || '';
}

const healthBadge: Record<string, { label: string; className: string }> = {
  healthy: { label: 'Healthy', className: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700' },
  stressed: { label: 'Stressed', className: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700' },
  diseased: { label: 'Diseased', className: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700' },
  dying: { label: 'Dying', className: 'bg-red-200 dark:bg-red-900/40 text-red-800 dark:text-red-300 border-red-400 dark:border-red-700' },
};

const severityColor: Record<string, string> = {
  low: 'text-yellow-600',
  medium: 'text-orange-600',
  high: 'text-red-600',
};

// -- Component --

export default function JournalPage() {
  const { toast } = useToast();
  const { showConfirm } = useModal();
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState('');

  // Smart suggestions state
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());

  // Add entry form state
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState('observation');
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formMood, setFormMood] = useState('');
  const [formPlantId, setFormPlantId] = useState('');
  const [formBedId, setFormBedId] = useState('');
  const [formTrayId, setFormTrayId] = useState('');
  const [formGroundPlantId, setFormGroundPlantId] = useState('');
  const [formPlantingId, setFormPlantingId] = useState('');
  const [formPlantingType, setFormPlantingType] = useState<'planting' | 'ground_plant' | ''>('');
  const [formSeverity, setFormSeverity] = useState('');
  const [formMilestoneType, setFormMilestoneType] = useState('');
  const [formPhotos, setFormPhotos] = useState<File[]>([]);
  const [formPhotoPreviews, setFormPhotoPreviews] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editPhotos, setEditPhotos] = useState<File[]>([]);
  const [editPhotoPreviews, setEditPhotoPreviews] = useState<string[]>([]);
  const [editExistingPhotos, setEditExistingPhotos] = useState<JournalPhoto[]>([]);

  // Typeahead options
  const [plantOptions, setPlantOptions] = useState<TypeaheadOption[]>([]);
  const [bedOptions, setBedOptions] = useState<TypeaheadOption[]>([]);
  const [trayOptions, setTrayOptions] = useState<TypeaheadOption[]>([]);
  const [groundPlantOptions, setGroundPlantOptions] = useState<TypeaheadOption[]>([]);
  const [allPlantingOptions, setAllPlantingOptions] = useState<TypeaheadOption[]>([]);

  // Plant context (shown when a plant is selected in the form)
  const [plantContext, setPlantContext] = useState<{ entries: FeedEntry[]; loading: boolean }>({ entries: [], loading: false });

  // Photo lightbox
  const [lightboxPhotoId, setLightboxPhotoId] = useState<number | null>(null);
  const [lightboxEntry, setLightboxEntry] = useState<FeedEntry | null>(null);
  const [lightboxIsJournalPhoto, setLightboxIsJournalPhoto] = useState(false);
  const [analyses, setAnalyses] = useState<Record<number, PhotoAnalysis>>({});
  const [analyzingIds, setAnalyzingIds] = useState<Set<number>>(new Set());

  // AI Summary state
  const [showSummary, setShowSummary] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [summaryActivity, setSummaryActivity] = useState<{ journal_entries: number; tasks_completed: number; harvests: number } | null>(null);
  const [summaryDays, setSummaryDays] = useState(7);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Quick input state (voice + photo)
  const [voiceTranscribing, setVoiceTranscribing] = useState(false);
  const [photoFlowOpen, setPhotoFlowOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoPlantingId, setPhotoPlantingId] = useState('');
  const [photoSubmitting, setPhotoSubmitting] = useState(false);
  const [photoAiSuggestion, setPhotoAiSuggestion] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const loadFeed = useCallback(() => {
    setLoading(true);
    getJournalFeed({ limit: 200, entry_type: filterType || undefined })
      .then(setFeed)
      .catch(() => setError('Failed to load journal feed'))
      .finally(() => setLoading(false));
  }, [filterType]);

  const loadSuggestions = useCallback(() => {
    setSuggestionsLoading(true);
    getJournalSuggestions()
      .then((data: Suggestion[]) => {
        setSuggestions(Array.isArray(data) ? data : []);
        setDismissedSuggestions(new Set());
      })
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false));
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  const handleQuickAction = useCallback(async (suggestion: Suggestion, action: QuickAction) => {
    const actionId = `${suggestion.id}-${action.label}`;
    setSubmittingActionId(actionId);
    try {
      const data: Parameters<typeof createJournalEntry>[0] = {
        entry_type: action.entry_type,
        content: action.content,
      };
      if (action.mood) data.mood = action.mood;
      if (action.milestone_type) data.milestone_type = action.milestone_type;
      if (suggestion.plant_id) data.plant_id = suggestion.plant_id;
      if (suggestion.container_type === 'ground' && suggestion.ground_plant_id) {
        data.ground_plant_id = suggestion.ground_plant_id;
      } else if (suggestion.planting_id) {
        data.planting_id = suggestion.planting_id;
      }

      await createJournalEntry(data);
      toast(`Logged: ${action.content.substring(0, 60)}${action.content.length > 60 ? '...' : ''}`, 'success');
      // Dismiss the card
      setDismissedSuggestions(prev => new Set(prev).add(suggestion.id));
      // Refresh feed
      loadFeed();
    } catch {
      toast('Failed to save entry', 'error');
    } finally {
      setSubmittingActionId(null);
    }
  }, [toast, loadFeed]);

  const visibleSuggestions = useMemo(
    () => suggestions.filter(s => !dismissedSuggestions.has(s.id)).slice(0, 5),
    [suggestions, dismissedSuggestions]
  );

  // Load typeahead options on mount
  useEffect(() => {
    getPlants()
      .then((plants: { id: number; name: string; category: string }[]) =>
        setPlantOptions(plants.map((p) => ({ value: String(p.id), label: p.name, icon: getPlantIcon(p.name, p.category) })))
      )
      .catch(() => {});
    getBeds()
      .then((beds: { id: number; name: string }[]) =>
        setBedOptions(beds.map((b) => ({ value: String(b.id), label: b.name, icon: '\u{1FAB4}' })))
      )
      .catch(() => {});
    getTrays()
      .then((trays: { id: number; name: string }[]) =>
        setTrayOptions(trays.map((t) => ({ value: String(t.id), label: t.name, icon: '\u{1F33F}' })))
      )
      .catch(() => {});
    getGroundPlants()
      .then((gps: { id: number; name: string; plant_name: string }[]) =>
        setGroundPlantOptions(gps.map((g) => ({ value: String(g.id), label: g.name || g.plant_name, icon: '\u{1F333}' })))
      )
      .catch(() => {});

    // Build unified planting selector: bed plantings + ground plants
    Promise.all([getPlantings(), getGroundPlants()])
      .then(([plantings, groundPlants]: [
        { id: number; plant_name: string; bed_name?: string; status: string }[],
        { id: number; name: string; plant_name: string; area_name?: string }[]
      ]) => {
        const options: TypeaheadOption[] = [
          { value: 'general', label: 'General (no specific plant)' },
        ];
        for (const p of plantings) {
          options.push({
            value: `planting:${p.id}`,
            label: `${p.plant_name}${p.bed_name ? ` (${p.bed_name})` : ''} - ${p.status}`,
            icon: getPlantIcon(p.plant_name),
          });
        }
        for (const g of groundPlants) {
          options.push({
            value: `ground:${g.id}`,
            label: `${g.name || g.plant_name}${(g as Record<string, unknown>).area_name ? ` (${(g as Record<string, unknown>).area_name})` : ''} [ground]`,
            icon: '\u{1F333}',
          });
        }
        setAllPlantingOptions(options);
      })
      .catch(() => {});
  }, []);

  // Load plant context when a plant is selected in the form
  useEffect(() => {
    if (!formPlantingId || formPlantingId === 'general') {
      setPlantContext({ entries: [], loading: false });
      return;
    }
    let plantType = '';
    let plantId = 0;
    if (formPlantingId.startsWith('planting:')) {
      plantType = 'planting';
      plantId = Number(formPlantingId.split(':')[1]);
    } else if (formPlantingId.startsWith('ground:')) {
      plantType = 'ground_plant';
      plantId = Number(formPlantingId.split(':')[1]);
    }
    if (!plantType || !plantId) return;
    setPlantContext({ entries: [], loading: true });
    getPlantTimeline(plantType, plantId)
      .then((data: FeedEntry[]) => setPlantContext({ entries: data.slice(0, 3), loading: false }))
      .catch(() => setPlantContext({ entries: [], loading: false }));
  }, [formPlantingId]);

  // Load cached analysis when lightbox opens (only for planting photos)
  useEffect(() => {
    if (lightboxPhotoId && !lightboxIsJournalPhoto && !analyses[lightboxPhotoId]) {
      getPhotoAnalysis(lightboxPhotoId)
        .then((data: PhotoAnalysis) => setAnalyses((prev) => ({ ...prev, [lightboxPhotoId]: data })))
        .catch(() => {});
    }
  }, [lightboxPhotoId, lightboxIsJournalPhoto]);

  const handleAnalyze = async (photoId: number) => {
    setAnalyzingIds((prev) => new Set(prev).add(photoId));
    try {
      const data = await analyzePhoto(photoId);
      setAnalyses((prev) => ({ ...prev, [photoId]: data }));
    } catch {
      setError('Failed to analyze photo');
    } finally {
      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
    }
  };

  const handleFormPhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setFormPhotos((prev) => [...prev, ...files]);
    const newPreviews = files.map((f) => URL.createObjectURL(f));
    setFormPhotoPreviews((prev) => [...prev, ...newPreviews]);
  };

  const removeFormPhoto = (index: number) => {
    URL.revokeObjectURL(formPhotoPreviews[index]);
    setFormPhotos((prev) => prev.filter((_, i) => i !== index));
    setFormPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleEditPhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setEditPhotos((prev) => [...prev, ...files]);
    const newPreviews = files.map((f) => URL.createObjectURL(f));
    setEditPhotoPreviews((prev) => [...prev, ...newPreviews]);
  };

  const removeEditPhoto = (index: number) => {
    URL.revokeObjectURL(editPhotoPreviews[index]);
    setEditPhotos((prev) => prev.filter((_, i) => i !== index));
    setEditPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDeleteExistingPhoto = async (photoId: number) => {
    try {
      await deleteJournalPhoto(photoId);
      setEditExistingPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch {
      setError('Failed to delete photo');
    }
  };

  const handleSubmit = async () => {
    if (!formContent.trim() && !formTitle.trim()) return;
    setSubmitting(true);
    try {
      // Resolve unified planting selector
      let planting_id: number | undefined;
      let ground_plant_id: number | undefined;
      if (formPlantingId && formPlantingId !== 'general') {
        if (formPlantingId.startsWith('planting:')) {
          planting_id = Number(formPlantingId.split(':')[1]);
        } else if (formPlantingId.startsWith('ground:')) {
          ground_plant_id = Number(formPlantingId.split(':')[1]);
        }
      }

      const entry = await createJournalEntry({
        entry_type: formType,
        title: formTitle.trim() || undefined,
        content: formContent.trim(),
        mood: formMood || undefined,
        planting_id,
        ground_plant_id,
        plant_id: formPlantId ? Number(formPlantId) : undefined,
        bed_id: formBedId ? Number(formBedId) : undefined,
        tray_id: formTrayId ? Number(formTrayId) : undefined,
        severity: formSeverity || undefined,
        milestone_type: formMilestoneType || undefined,
      });
      // Upload photos if any
      if (formPhotos.length > 0 && entry.id) {
        await uploadJournalPhotos(entry.id, formPhotos);
      }
      setFormType('observation');
      setFormTitle('');
      setFormContent('');
      setFormMood('');
      setFormPlantId('');
      setFormBedId('');
      setFormTrayId('');
      setFormGroundPlantId('');
      setFormPlantingId('');
      setFormPlantingType('');
      setFormSeverity('');
      setFormMilestoneType('');
      formPhotoPreviews.forEach((url) => URL.revokeObjectURL(url));
      setFormPhotos([]);
      setFormPhotoPreviews([]);
      setShowForm(false);
      loadFeed();
      toast('Journal entry created!');
    } catch {
      setError('Failed to create journal entry');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (id: number) => {
    try {
      await updateJournalEntry(id, {
        content: editContent.trim(),
        title: editTitle.trim() || undefined,
      });
      // Upload new photos if any
      if (editPhotos.length > 0) {
        await uploadJournalPhotos(id, editPhotos);
      }
      editPhotoPreviews.forEach((url) => URL.revokeObjectURL(url));
      setEditPhotos([]);
      setEditPhotoPreviews([]);
      setEditExistingPhotos([]);
      setEditingId(null);
      loadFeed();
      toast('Journal entry updated');
    } catch {
      setError('Failed to update journal entry');
    }
  };

  const handleDelete = async (id: number | string) => {
    if (typeof id === 'string') return; // Can't delete photo/note feed items from here
    if (!await showConfirm({ title: 'Delete Entry', message: 'Delete this journal entry?', confirmText: 'Delete', destructive: true })) return;
    try {
      const res = await deleteJournalEntry(id);
      loadFeed();
      toast('Journal entry deleted', 'success', {
        action: { label: 'Undo', onClick: async () => { try { await undoAction(res.undo_id); loadFeed(); } catch { toast('Undo failed', 'error'); } } },
      });
    } catch {
      setError('Failed to delete journal entry');
    }
  };

  const handleGenerateSummary = async () => {
    setSummaryLoading(true);
    setSummaryText('');
    setSummaryActivity(null);
    try {
      const data = await generateJournalSummary(summaryDays);
      setSummaryText(data.summary);
      setSummaryActivity(data.activity || null);
      setShowSummary(true);
    } catch {
      setError('Failed to generate AI summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  // Voice note handler
  const handleVoiceRecording = useCallback(async (blob: Blob) => {
    setVoiceTranscribing(true);
    try {
      const formData = new FormData();
      formData.append('file', blob, 'voice-note.webm');
      const result = await createVoiceNote(formData);
      const preview = result.transcription?.substring(0, 30) || 'Voice note';
      toast(`Voice note saved: ${preview}${result.transcription?.length > 30 ? '...' : ''}`, 'success');
      loadFeed();
      loadSuggestions();
    } catch {
      toast('Failed to save voice note', 'error');
    } finally {
      setVoiceTranscribing(false);
    }
  }, [toast, loadFeed, loadSuggestions]);

  // Photo capture handler
  const handlePhotoCaptured = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoCaption('');
    setPhotoPlantingId('');
    setPhotoAiSuggestion(null);
    setPhotoFlowOpen(true);
  }, []);

  const handlePhotoSubmit = useCallback(async () => {
    if (!photoFile) return;
    setPhotoSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('file', photoFile);
      if (photoCaption) formData.append('content', photoCaption);
      if (photoPlantingId) {
        if (photoPlantingId.startsWith('planting:')) {
          formData.append('planting_id', photoPlantingId.split(':')[1]);
        } else if (photoPlantingId.startsWith('ground:')) {
          formData.append('ground_plant_id', photoPlantingId.split(':')[1]);
        }
      }
      const result = await createPhotoJournalEntry(formData);
      if (result.ai_suggestion && !photoCaption) {
        setPhotoAiSuggestion(result.ai_suggestion);
      }
      toast('Photo entry saved!', 'success');
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      setPhotoFlowOpen(false);
      setPhotoFile(null);
      setPhotoPreview(null);
      setPhotoCaption('');
      setPhotoPlantingId('');
      setPhotoAiSuggestion(null);
      loadFeed();
    } catch {
      toast('Failed to save photo entry', 'error');
    } finally {
      setPhotoSubmitting(false);
    }
  }, [photoFile, photoCaption, photoPlantingId, photoPreview, toast, loadFeed]);

  const handlePhotoCancelFlow = useCallback(() => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFlowOpen(false);
    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoCaption('');
    setPhotoPlantingId('');
    setPhotoAiSuggestion(null);
  }, [photoPreview]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours < 1) return `${Math.max(1, Math.round(diffMs / (1000 * 60)))}m ago`;
    if (diffHours < 24) return `${Math.round(diffHours)}h ago`;
    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    const currentYear = getGardenYear();
    return formatGardenDate(dateStr, { month: 'short', day: 'numeric', year: d.getFullYear() !== currentYear ? 'numeric' : undefined });
  };

  const entryTypeStyle = (type: string) => {
    switch (type) {
      case 'problem': return 'border-l-red-400 dark:border-l-red-600';
      case 'milestone': return 'border-l-yellow-400 dark:border-l-yellow-500';
      case 'observation': return 'border-l-blue-400 dark:border-l-blue-500';
      case 'weather': return 'border-l-sky-400 dark:border-l-sky-500';
      case 'harvest': return 'border-l-green-400 dark:border-l-green-500';
      case 'photo': return 'border-l-purple-400 dark:border-l-purple-500';
      default: return 'border-l-earth-300 dark:border-l-gray-600';
    }
  };

  return (
    <PullToRefresh onRefresh={async () => { loadFeed(); loadSuggestions(); }}>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-earth-800 dark:text-gray-100">Garden Journal</h1>
        <div className="flex items-center gap-2">
          <a
            href={getExportUrl('journal')}
            download
            className="px-3 py-2 bg-earth-100 dark:bg-gray-700 text-earth-700 dark:text-gray-300 rounded-lg hover:bg-earth-200 dark:hover:bg-gray-600 transition-colors text-sm font-medium"
          >
            Export
          </a>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition-colors text-sm font-medium flex items-center gap-2"
          >
            {showForm ? 'Cancel' : '+ New Entry'}
          </button>
        </div>
      </div>

      {/* AI Summary Section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            <span className="font-semibold text-earth-800 dark:text-gray-100 text-sm">AI Weekly Summary</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={summaryDays}
              onChange={(e) => setSummaryDays(Number(e.target.value))}
              className="text-xs px-2 py-1 rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-700 dark:text-gray-300"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
            <button
              onClick={handleGenerateSummary}
              disabled={summaryLoading}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700 hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-50"
            >
              {summaryLoading ? 'Generating...' : 'Generate Summary'}
            </button>
          </div>
        </div>
        {showSummary && summaryText && (
          <div className="mt-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-100 dark:border-purple-800">
            <p className="text-sm text-earth-700 dark:text-gray-300 whitespace-pre-line">{summaryText}</p>
            {summaryActivity && (
              <div className="mt-2 flex gap-4 text-xs text-earth-500 dark:text-gray-400">
                <span>{summaryActivity.journal_entries} journal entries</span>
                <span>{summaryActivity.tasks_completed} tasks completed</span>
                <span>{summaryActivity.harvests} harvests</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Smart Suggestions */}
      {suggestionsLoading ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-garden-600 dark:text-garden-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <span className="text-sm font-semibold text-earth-700 dark:text-gray-300">What needs attention</span>
          </div>
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm animate-pulse">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-earth-200 dark:bg-gray-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-earth-200 dark:bg-gray-700 rounded w-1/3" />
                  <div className="h-3 bg-earth-100 dark:bg-gray-700 rounded w-1/4" />
                  <div className="h-3 bg-earth-100 dark:bg-gray-700 rounded w-1/2 mt-2" />
                  <div className="flex gap-2 mt-3">
                    <div className="h-8 bg-earth-100 dark:bg-gray-700 rounded-lg w-20" />
                    <div className="h-8 bg-earth-100 dark:bg-gray-700 rounded-lg w-20" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : visibleSuggestions.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-garden-600 dark:text-garden-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <span className="text-sm font-semibold text-earth-700 dark:text-gray-300">What needs attention</span>
            <span className="text-xs text-earth-400 dark:text-gray-500">({visibleSuggestions.length})</span>
          </div>
          {visibleSuggestions.map((s) => {
            const icon = s.category ? getPlantIcon(s.plant_name || '', s.category) : (s.type === 'heat-check' ? '\uD83C\uDF21\uFE0F' : s.type === 'cold-check' ? '\u2744\uFE0F' : '\uD83C\uDF3B');
            return (
              <div
                key={s.id}
                className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl flex-shrink-0 mt-0.5">{icon}</span>
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
                      {s.quick_actions.map((action) => {
                        const actionId = `${s.id}-${action.label}`;
                        const isSubmitting = submittingActionId === actionId;
                        return (
                          <button
                            key={action.label}
                            onClick={() => handleQuickAction(s, action)}
                            disabled={!!submittingActionId}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all active:scale-95 disabled:opacity-50 ${
                              action.entry_type === 'problem'
                                ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-800'
                                : action.entry_type === 'milestone' || action.entry_type === 'harvest'
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
            );
          })}
        </div>
      ) : null}

      {/* Quick Input Row */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-earth-500 dark:text-gray-400 uppercase tracking-wide">Quick Input</span>
          {voiceTranscribing && (
            <span className="inline-flex items-center gap-1.5 text-xs text-garden-600 dark:text-garden-400">
              <span className="animate-spin w-3 h-3 border-2 border-garden-600 dark:border-garden-400 border-t-transparent rounded-full" />
              Transcribing...
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {/* Voice note */}
          <VoiceRecorder onRecordingComplete={handleVoiceRecording} disabled={voiceTranscribing} />

          {/* Photo capture */}
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="w-14 h-14 rounded-full bg-garden-600 hover:bg-garden-700 text-white flex items-center justify-center transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoCaptured}
            className="hidden"
          />
          <span className="text-xs text-earth-400 dark:text-gray-500">Photo</span>

          {/* Text entry shortcut */}
          <button
            type="button"
            onClick={() => { setShowForm(true); setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth' }), 100); }}
            className="w-14 h-14 rounded-full bg-garden-600 hover:bg-garden-700 text-white flex items-center justify-center transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <span className="text-xs text-earth-400 dark:text-gray-500">Write</span>
        </div>
      </div>

      {/* Photo-First Flow Modal */}
      {photoFlowOpen && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 space-y-4 shadow-md">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-300 uppercase tracking-wide">Photo Journal Entry</h2>
            <button onClick={handlePhotoCancelFlow} className="text-earth-400 hover:text-earth-600 dark:text-gray-500 dark:hover:text-gray-300 text-lg">&times;</button>
          </div>
          {photoPreview && (
            <img src={photoPreview} alt="Captured" className="w-full max-h-64 object-contain rounded-lg border border-earth-200 dark:border-gray-600" />
          )}
          {photoAiSuggestion && !photoCaption && (
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800 p-3">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                <span className="text-xs font-medium text-purple-700 dark:text-purple-300">AI Suggestion</span>
              </div>
              <p className="text-sm text-purple-700 dark:text-purple-300">{photoAiSuggestion}</p>
              <button
                onClick={() => setPhotoCaption(photoAiSuggestion || '')}
                className="mt-2 text-xs text-purple-600 dark:text-purple-400 underline hover:no-underline"
              >
                Use this as caption
              </button>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1 block">Link to plant (optional)</label>
            <TypeaheadSelect
              options={allPlantingOptions}
              value={photoPlantingId}
              onChange={(val) => setPhotoPlantingId(val)}
              placeholder="Search plantings, ground plants..."
            />
          </div>
          <textarea
            value={photoCaption}
            onChange={(e) => setPhotoCaption(e.target.value)}
            placeholder="Add a note (optional, AI will describe if left blank)..."
            rows={2}
            className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none text-sm resize-y"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={handlePhotoCancelFlow}
              className="px-4 py-2 text-sm font-medium text-earth-600 dark:text-gray-400 border border-earth-300 dark:border-gray-600 rounded-lg hover:bg-earth-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handlePhotoSubmit}
              disabled={photoSubmitting}
              className="px-5 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {photoSubmitting ? 'Saving...' : 'Save Entry'}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 font-bold">&times;</button>
        </div>
      )}

      {/* Add Entry Form */}
      {showForm && (
        <div ref={formRef} className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-5 space-y-4 shadow-sm">
          <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-300 uppercase tracking-wide">New Journal Entry</h2>

          {/* Entry type selector - visual cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {ENTRY_TYPES.filter((t) => t.value !== 'photo').map((t) => (
              <button
                key={t.value}
                onClick={() => setFormType(t.value)}
                className={`flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${
                  formType === t.value
                    ? 'bg-garden-50 dark:bg-garden-900/30 border-garden-500 dark:border-garden-500 text-garden-700 dark:text-garden-300 shadow-sm'
                    : 'bg-white dark:bg-gray-700 border-earth-200 dark:border-gray-600 text-earth-600 dark:text-gray-400 hover:border-garden-300 dark:hover:border-garden-600'
                }`}
              >
                <span className="text-lg">{t.icon}</span>
                <span className="text-xs font-semibold">{t.label}</span>
                <span className="text-[10px] text-earth-400 dark:text-gray-500">{t.description}</span>
              </button>
            ))}
          </div>

          {/* What plant is this about? - Unified planting selector */}
          <div>
            <label className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1 block">What plant is this about?</label>
            <TypeaheadSelect
              options={allPlantingOptions}
              value={formPlantingId}
              onChange={(val) => setFormPlantingId(val)}
              placeholder="Search plantings, ground plants..."
            />
          </div>

          {/* Plant context card — shows recent history for the selected plant */}
          {formPlantingId && formPlantingId !== 'general' && (
            <div className="bg-earth-50 dark:bg-gray-700/50 rounded-lg border border-earth-200 dark:border-gray-600 p-3">
              {plantContext.loading ? (
                <div className="text-xs text-earth-400 dark:text-gray-500">Loading plant history...</div>
              ) : plantContext.entries.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider font-medium text-earth-400 dark:text-gray-500 mb-1">Recent History</div>
                  {plantContext.entries.map((e: FeedEntry, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="shrink-0">{typeIcon(e.entry_type || ((e as unknown as Record<string, unknown>).timeline_type as string) || 'note')}</span>
                      <span className="text-earth-600 dark:text-gray-400 truncate flex-1">
                        {e.title || (e.content ? (e.content.length > 60 ? e.content.slice(0, 60) + '...' : e.content) : 'Entry')}
                      </span>
                      <span className="text-earth-300 dark:text-gray-600 shrink-0">{formatDate(e.created_at)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-earth-400 dark:text-gray-500">No previous entries for this plant.</div>
              )}
            </div>
          )}

          {/* Title (optional) */}
          <input
            type="text"
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            placeholder="Title (optional)"
            className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none text-sm"
          />

          {/* Adaptive fields based on entry_type */}

          {/* Problem: severity selector */}
          {formType === 'problem' && (
            <div>
              <label className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1.5 block">Severity</label>
              <div className="flex flex-wrap gap-2">
                {SEVERITY_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setFormSeverity(formSeverity === s.value ? '' : s.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      formSeverity === s.value
                        ? `${s.color} border-current shadow-sm`
                        : 'bg-white dark:bg-gray-700 border-earth-200 dark:border-gray-600 text-earth-600 dark:text-gray-400 hover:border-earth-300'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Milestone: type selector */}
          {formType === 'milestone' && (
            <div>
              <label className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1.5 block">Milestone Type</label>
              <div className="flex flex-wrap gap-2">
                {MILESTONE_OPTIONS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setFormMilestoneType(formMilestoneType === m.value ? '' : m.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      formMilestoneType === m.value
                        ? 'bg-garden-100 dark:bg-garden-900/40 border-garden-400 dark:border-garden-600 text-garden-700 dark:text-garden-300 shadow-sm'
                        : 'bg-white dark:bg-gray-700 border-earth-200 dark:border-gray-600 text-earth-600 dark:text-gray-400 hover:border-earth-300'
                    }`}
                  >
                    {m.icon} {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Content */}
          <textarea
            value={formContent}
            onChange={(e) => setFormContent(e.target.value)}
            placeholder={
              formType === 'problem' ? 'Describe the issue...' :
              formType === 'harvest' ? 'Harvest notes (amounts tracked in Harvest Log)...' :
              formType === 'milestone' ? 'Describe the milestone...' :
              "What's happening in the garden?"
            }
            rows={3}
            className="w-full px-3 py-2 border border-earth-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-garden-500 outline-none text-sm resize-y"
          />

          {/* Mood selector */}
          <div>
            <label className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1 block">Garden Mood</label>
            <div className="flex gap-2">
              {MOODS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setFormMood(formMood === m.value ? '' : m.value)}
                  title={m.label}
                  className={`w-9 h-9 rounded-full text-lg flex items-center justify-center border transition-colors ${
                    formMood === m.value
                      ? 'bg-garden-100 dark:bg-garden-900/40 border-garden-400 dark:border-garden-600 shadow-sm'
                      : 'bg-white dark:bg-gray-700 border-earth-200 dark:border-gray-600 hover:border-garden-300'
                  }`}
                >
                  {m.icon}
                </button>
              ))}
            </div>
          </div>

          {/* Photo upload */}
          <div>
            <label className="text-xs font-medium text-earth-500 dark:text-gray-400 mb-1 block">Photos</label>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-earth-50 dark:bg-gray-700 border border-earth-200 dark:border-gray-600 text-earth-600 dark:text-gray-300 hover:bg-earth-100 dark:hover:bg-gray-600 transition-colors text-sm cursor-pointer">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              Add Photos
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleFormPhotoSelect}
                className="hidden"
              />
            </label>
            {formPhotoPreviews.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formPhotoPreviews.map((url, i) => (
                  <div key={i} className="relative group">
                    <img src={url} alt={`Preview ${i + 1}`} className="w-20 h-20 object-cover rounded-lg border border-earth-200 dark:border-gray-600" />
                    <button
                      onClick={() => removeFormPhoto(i)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Submit */}
          <div className="flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={submitting || (!formContent.trim() && !formTitle.trim())}
              className="px-5 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving...' : 'Add Entry'}
            </button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1.5 pb-1">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilterType(tab.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filterType === tab.value
                ? 'bg-garden-600 text-white'
                : 'bg-white dark:bg-gray-800 border border-earth-200 dark:border-gray-700 text-earth-600 dark:text-gray-400 hover:bg-garden-50 dark:hover:bg-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Feed */}
      {loading ? (
        <div className="text-center py-16 text-earth-400 dark:text-gray-500">Loading journal...</div>
      ) : feed.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700">
          <div className="text-4xl mb-3">{'\u{1F4D3}'}</div>
          <p className="text-earth-500 dark:text-gray-400 mb-2">No journal entries yet</p>
          <p className="text-earth-400 dark:text-gray-500 text-sm">
            Click &quot;+ New Entry&quot; to start recording your garden observations, milestones, and notes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {feed.map((entry) => {
            const isEditing = editingId !== null && entry.id === editingId;
            const isJournalEntry = entry.source === 'journal' && typeof entry.id === 'number';

            return (
              <div
                key={`${entry.source}_${entry.id}`}
                className={`bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 shadow-sm overflow-hidden border-l-4 ${entryTypeStyle(entry.entry_type)}`}
              >
                <div className="p-4">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="text-lg shrink-0" title={entry.entry_type}>{typeIcon(entry.entry_type)}</span>
                      <span className="text-xs font-medium text-earth-400 dark:text-gray-500 uppercase tracking-wide">{entry.entry_type}</span>
                      {entry.mood && <span className="text-sm" title={entry.mood}>{moodIcon(entry.mood)}</span>}
                      <span className="text-xs text-earth-300 dark:text-gray-600">{'\u00B7'}</span>
                      <span className="text-xs text-earth-400 dark:text-gray-500">{formatDate(entry.created_at)}</span>
                      {entry.source === 'planting_note' && (
                        <span className="text-[10px] bg-earth-100 dark:bg-gray-700 text-earth-400 dark:text-gray-500 px-1.5 py-0.5 rounded">planting note</span>
                      )}
                    </div>
                    {/* Actions */}
                    {isJournalEntry && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => {
                            if (isEditing) {
                              setEditingId(null);
                              editPhotoPreviews.forEach((url) => URL.revokeObjectURL(url));
                              setEditPhotos([]);
                              setEditPhotoPreviews([]);
                              setEditExistingPhotos([]);
                            } else {
                              setEditingId(entry.id as number);
                              setEditContent(entry.content);
                              setEditTitle(entry.title || '');
                              setEditExistingPhotos(entry.photos || []);
                              setEditPhotos([]);
                              setEditPhotoPreviews([]);
                            }
                          }}
                          className="p-1.5 rounded-lg text-earth-400 dark:text-gray-500 hover:bg-earth-100 dark:hover:bg-gray-700 hover:text-earth-600 dark:hover:text-gray-300 transition-colors"
                          title={isEditing ? 'Cancel edit' : 'Edit'}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(entry.id)}
                          className="p-1.5 rounded-lg text-earth-400 dark:text-gray-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Title */}
                  {isEditing ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Title (optional)"
                      className="w-full px-2 py-1 mb-2 border border-earth-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-gray-100 text-sm"
                    />
                  ) : (
                    entry.title && <h3 className="text-sm font-semibold text-earth-800 dark:text-gray-100 mb-1">{entry.title}</h3>
                  )}

                  {/* Photo inline (legacy single photo_id) */}
                  {entry.photo_id && (!entry.photos || entry.photos.length === 0) && (
                    <button
                      onClick={() => { setLightboxPhotoId(entry.photo_id); setLightboxEntry(entry); setLightboxIsJournalPhoto(false); }}
                      className="mb-2 block rounded-lg overflow-hidden max-w-xs hover:opacity-90 transition-opacity"
                    >
                      <img
                        src={getPhotoUrl(entry.photo_id)}
                        alt={entry.title || entry.content}
                        className="w-full h-48 object-cover"
                        loading="lazy"
                      />
                    </button>
                  )}

                  {/* Journal entry photos grid */}
                  {entry.photos && entry.photos.length > 0 && (
                    <div className={`mb-2 grid gap-1.5 ${entry.photos.length === 1 ? 'grid-cols-1 max-w-xs' : entry.photos.length === 2 ? 'grid-cols-2 max-w-md' : 'grid-cols-3 max-w-lg'}`}>
                      {entry.photos.map((photo) => (
                        <button
                          key={photo.id}
                          onClick={() => { setLightboxPhotoId(photo.id); setLightboxEntry(entry); setLightboxIsJournalPhoto(true); }}
                          className="block rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
                        >
                          <img
                            src={getJournalPhotoUrl(photo.id)}
                            alt={photo.caption || entry.title || entry.content}
                            className={`w-full object-cover ${entry.photos!.length === 1 ? 'h-48' : 'h-32'}`}
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Content */}
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={3}
                        className="w-full px-2 py-1.5 border border-earth-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 dark:text-gray-100 text-sm resize-y"
                      />
                      {/* Existing photos with delete */}
                      {editExistingPhotos.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {editExistingPhotos.map((photo) => (
                            <div key={photo.id} className="relative group">
                              <img src={getJournalPhotoUrl(photo.id)} alt={photo.caption || ''} className="w-20 h-20 object-cover rounded-lg border border-earth-200 dark:border-gray-600" />
                              <button
                                onClick={() => handleDeleteExistingPhoto(photo.id)}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                              >
                                &times;
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* New photos to add */}
                      {editPhotoPreviews.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {editPhotoPreviews.map((url, i) => (
                            <div key={i} className="relative group">
                              <img src={url} alt={`New ${i + 1}`} className="w-20 h-20 object-cover rounded-lg border border-dashed border-garden-400 dark:border-garden-600" />
                              <button
                                onClick={() => removeEditPhoto(i)}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                              >
                                &times;
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <label className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-earth-50 dark:bg-gray-700 border border-earth-200 dark:border-gray-600 text-earth-500 dark:text-gray-400 hover:bg-earth-100 dark:hover:bg-gray-600 transition-colors text-xs cursor-pointer">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        Add Photos
                        <input type="file" accept="image/*" multiple onChange={handleEditPhotoSelect} className="hidden" />
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(entry.id as number)}
                          className="px-3 py-1 bg-garden-600 text-white rounded text-xs font-medium hover:bg-garden-700"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => { setEditingId(null); editPhotoPreviews.forEach((url) => URL.revokeObjectURL(url)); setEditPhotos([]); setEditPhotoPreviews([]); setEditExistingPhotos([]); }}
                          className="px-3 py-1 bg-earth-100 dark:bg-gray-700 text-earth-600 dark:text-gray-300 rounded text-xs hover:bg-earth-200 dark:hover:bg-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-earth-700 dark:text-gray-300 whitespace-pre-wrap">{entry.content}</p>
                  )}

                  {/* Linked items */}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {entry.plant_name && entry.plant_id && (
                      <Link
                        href={`/plants?highlight=${entry.plant_id}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-garden-50 dark:bg-garden-900/20 text-xs text-garden-700 dark:text-garden-400 hover:bg-garden-100 dark:hover:bg-garden-900/40 transition-colors"
                      >
                        <span>{getPlantIcon(entry.plant_name, entry.category || '')}</span>
                        {entry.plant_name}
                      </Link>
                    )}
                    {entry.bed_name && entry.bed_id && (
                      <Link
                        href={`/planters/${entry.bed_id}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-earth-100 dark:bg-gray-700 text-xs text-earth-600 dark:text-gray-400 hover:bg-earth-200 dark:hover:bg-gray-600 transition-colors"
                      >
                        {'\u{1FAB4}'} {entry.bed_name}
                      </Link>
                    )}
                    {entry.tray_name && entry.tray_id && (
                      <Link
                        href={`/trays/${entry.tray_id}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-earth-100 dark:bg-gray-700 text-xs text-earth-600 dark:text-gray-400 hover:bg-earth-200 dark:hover:bg-gray-600 transition-colors"
                      >
                        {'\u{1F33F}'} {entry.tray_name}
                      </Link>
                    )}
                    {entry.ground_plant_name && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-earth-100 dark:bg-gray-700 text-xs text-earth-600 dark:text-gray-400">
                        {'\u{1F333}'} {entry.ground_plant_name}
                      </span>
                    )}
                    {entry.severity && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        entry.severity === 'critical' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                        entry.severity === 'high' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                        entry.severity === 'medium' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' :
                        entry.severity === 'low' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' :
                        entry.severity === 'warning' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' :
                        'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                      }`}>
                        {entry.severity}
                      </span>
                    )}
                    {entry.milestone_type && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                        {MILESTONE_OPTIONS.find(m => m.value === entry.milestone_type)?.icon || '\u{1F389}'} {entry.milestone_type.replace('_', ' ')}
                      </span>
                    )}
                    {entry.tags && entry.tags.length > 0 && entry.tags.map((tag: string) => (
                      <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded-full bg-earth-50 dark:bg-gray-700 text-xs text-earth-500 dark:text-gray-400">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Photo Lightbox */}
      {lightboxPhotoId && lightboxEntry && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => { setLightboxPhotoId(null); setLightboxEntry(null); setLightboxIsJournalPhoto(false); }}
        >
          <div
            className="relative max-w-3xl w-full bg-white dark:bg-gray-800 rounded-xl overflow-hidden shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setLightboxPhotoId(null); setLightboxEntry(null); setLightboxIsJournalPhoto(false); }}
              className="absolute top-3 right-3 z-10 bg-black/50 text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
            >
              &times;
            </button>
            <img
              src={lightboxIsJournalPhoto ? getJournalPhotoUrl(lightboxPhotoId) : getPhotoUrl(lightboxPhotoId)}
              alt={lightboxEntry.title || lightboxEntry.content}
              className="w-full max-h-[70vh] object-contain bg-earth-100"
            />
            <div className="p-4">
              <div className="flex items-center gap-2 mb-1">
                {lightboxEntry.plant_name && (
                  <>
                    <span className="text-lg">{getPlantIcon(lightboxEntry.plant_name, lightboxEntry.category || '')}</span>
                    {lightboxEntry.plant_id ? (
                      <Link href={`/plants?highlight=${lightboxEntry.plant_id}`} className="font-bold text-earth-800 dark:text-gray-100 hover:text-garden-600 dark:hover:text-garden-400 hover:underline">
                        {lightboxEntry.plant_name}
                      </Link>
                    ) : (
                      <h3 className="font-bold text-earth-800 dark:text-gray-100">{lightboxEntry.plant_name}</h3>
                    )}
                  </>
                )}
                {lightboxEntry.bed_name && lightboxEntry.bed_id && (
                  <>
                    <span className="text-earth-300">&middot;</span>
                    <Link href={`/planters/${lightboxEntry.bed_id}`} className="text-sm text-garden-600 hover:underline">
                      {lightboxEntry.bed_name}
                    </Link>
                  </>
                )}
              </div>
              {lightboxEntry.content && (
                <p className="text-sm text-earth-600 dark:text-gray-400 mb-1">{lightboxEntry.content}</p>
              )}
              <p className="text-xs text-earth-400">
                {formatGardenDate(lightboxEntry.created_at, {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>

              {/* AI Analysis Section */}
              <div className="mt-4 pt-4 border-t border-earth-200 dark:border-gray-700">
                {!lightboxIsJournalPhoto && analyses[lightboxPhotoId] ? (
                  <AnalysisDisplay analysis={analyses[lightboxPhotoId]} />
                ) : !lightboxIsJournalPhoto ? (
                  <button
                    onClick={() => handleAnalyze(lightboxPhotoId)}
                    disabled={analyzingIds.has(lightboxPhotoId)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-garden-50 dark:bg-garden-900/30 border border-garden-200 dark:border-garden-700 text-garden-700 dark:text-garden-300 hover:bg-garden-100 dark:hover:bg-garden-900/50 transition-colors text-sm disabled:opacity-50"
                  >
                    {analyzingIds.has(lightboxPhotoId) ? (
                      <>
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        Analyze Plant Health
                      </>
                    )}
                  </button>
                ) : (
                  <p className="text-xs text-earth-400 dark:text-gray-500">Photo from journal entry</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </PullToRefresh>
  );
}

function AnalysisDisplay({ analysis }: { analysis: PhotoAnalysis }) {
  const badge = healthBadge[analysis.health] || { label: analysis.health, className: 'bg-gray-100 text-gray-600 border-gray-300' };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${badge.className}`}>
          {badge.label}
        </span>
        <span className="text-xs text-earth-400 dark:text-gray-500">
          {analysis.plant_identified} &middot; {analysis.growth_stage} &middot; Confidence: {analysis.confidence}
        </span>
      </div>

      <p className="text-sm text-earth-700 dark:text-gray-300">{analysis.summary}</p>

      {analysis.issues.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-earth-600 dark:text-gray-400 mb-1.5">Issues Detected</p>
          <div className="space-y-1.5">
            {analysis.issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={`font-medium ${severityColor[issue.severity] || 'text-gray-600'}`}>
                  [{issue.severity.toUpperCase()}]
                </span>
                <div>
                  <span className="font-medium text-earth-700 dark:text-gray-300">{issue.name}</span>
                  <span className="text-earth-500 dark:text-gray-400"> ({issue.type})</span>
                  <span className="text-earth-500 dark:text-gray-400"> &mdash; {issue.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {analysis.recommendations.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-earth-600 dark:text-gray-400 mb-1.5">Recommendations</p>
          <ul className="list-disc list-inside space-y-1 text-xs text-earth-600 dark:text-gray-400">
            {analysis.recommendations.map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
