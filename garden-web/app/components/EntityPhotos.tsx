'use client';

import { useEffect, useState, useCallback } from 'react';
import { getPlantingPhotos, uploadPlantingPhoto, deletePhoto, getPhotoUrl, analyzePhoto, getPhotoAnalysis } from '../api';
import { useToast } from '../toast';

interface Photo {
  id: number;
  planting_id?: number;
  filename: string;
  caption: string | null;
  taken_at: string | null;
  created_at: string;
}

interface PhotoAnalysis {
  id: number;
  summary: string;
  health_score?: number;
  issues?: string[];
  recommendations?: string[];
}

interface EntityPhotosProps {
  entityType: 'planting' | 'ground_plant' | 'journal';
  entityId: number;
}

export default function EntityPhotos({ entityType, entityId }: EntityPhotosProps) {
  const { toast } = useToast();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState('');
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);
  const [analyses, setAnalyses] = useState<Record<number, PhotoAnalysis>>({});
  const [analyzingIds, setAnalyzingIds] = useState<Set<number>>(new Set());

  const loadPhotos = useCallback(async () => {
    try {
      if (entityType === 'planting') {
        const data = await getPlantingPhotos(entityId);
        setPhotos(data);
      }
      // For other entity types, extend when backend supports them
    } catch {
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  // Load existing analyses for photos
  useEffect(() => {
    photos.forEach(async (photo) => {
      if (!analyses[photo.id]) {
        try {
          const analysis = await getPhotoAnalysis(photo.id);
          if (analysis) {
            setAnalyses((prev) => ({ ...prev, [photo.id]: analysis }));
          }
        } catch {
          // No analysis available
        }
      }
    });
  }, [photos]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || entityType !== 'planting') return;

    if (file.size > 10 * 1024 * 1024) {
      toast('Photo must be under 10MB', 'error');
      return;
    }

    setUploading(true);
    try {
      await uploadPlantingPhoto(entityId, file, caption || undefined);
      setCaption('');
      await loadPhotos();
      toast('Photo uploaded');
    } catch {
      toast('Failed to upload photo', 'error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (photoId: number) => {
    try {
      await deletePhoto(photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      if (lightboxPhoto?.id === photoId) setLightboxPhoto(null);
      toast('Photo deleted');
    } catch {
      toast('Failed to delete photo', 'error');
    }
  };

  const handleAnalyze = async (photoId: number) => {
    setAnalyzingIds((prev) => new Set(prev).add(photoId));
    try {
      const data = await analyzePhoto(photoId);
      setAnalyses((prev) => ({ ...prev, [photoId]: data }));
      toast('Photo analyzed');
    } catch {
      toast('Failed to analyze photo', 'error');
    } finally {
      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
    }
  };

  if (loading) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-earth-200 dark:border-gray-700 p-4">
      <h2 className="text-sm font-semibold text-earth-700 dark:text-gray-200 mb-3 flex items-center gap-1.5">
        <span className="text-purple-500">{'📸'}</span> Photos
      </h2>

      {/* Upload */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          placeholder="Caption (optional)"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          className="flex-1 px-2 py-1 text-sm rounded border border-earth-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-earth-800 dark:text-gray-200"
        />
        <label className="px-3 py-1.5 text-sm font-medium rounded-lg bg-garden-600 hover:bg-garden-700 text-white cursor-pointer transition-colors">
          {uploading ? 'Uploading...' : 'Upload'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
        </label>
      </div>

      {/* Photo grid */}
      {photos.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="relative group">
              <img
                src={getPhotoUrl(photo.id)}
                alt={photo.caption || 'Photo'}
                className="w-full aspect-square object-cover rounded-lg border border-earth-200 dark:border-gray-600 cursor-pointer"
                onClick={() => setLightboxPhoto(photo)}
              />
              {analyses[photo.id] && (
                <span className="absolute top-1 left-1 px-1 py-0.5 rounded bg-garden-600/80 text-white text-[9px] font-medium">
                  AI
                </span>
              )}
              <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                {!analyses[photo.id] && (
                  <button
                    onClick={() => handleAnalyze(photo.id)}
                    disabled={analyzingIds.has(photo.id)}
                    className="w-5 h-5 bg-blue-500/80 text-white rounded-full text-[10px] flex items-center justify-center hover:bg-blue-600"
                    title="Analyze with AI"
                  >
                    {analyzingIds.has(photo.id) ? '...' : '🔍'}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(photo.id)}
                  className="w-5 h-5 bg-red-500/80 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                  title="Delete photo"
                >
                  x
                </button>
              </div>
              {photo.caption && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] px-1 py-0.5 rounded-b-lg truncate">
                  {photo.caption}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-earth-400 dark:text-gray-500 text-center py-2">
          No photos yet. Upload one above.
        </div>
      )}

      {/* Lightbox */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setLightboxPhoto(null)}
        >
          <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={getPhotoUrl(lightboxPhoto.id)}
              alt={lightboxPhoto.caption || 'Photo'}
              className="w-full rounded-xl"
            />
            {lightboxPhoto.caption && (
              <div className="absolute bottom-4 left-4 right-4 bg-black/60 text-white text-sm px-3 py-2 rounded-lg">
                {lightboxPhoto.caption}
              </div>
            )}
            <button
              onClick={() => setLightboxPhoto(null)}
              className="absolute top-2 right-2 w-8 h-8 bg-black/60 text-white rounded-full text-lg flex items-center justify-center hover:bg-black/80"
            >
              x
            </button>
            {analyses[lightboxPhoto.id] && (
              <div className="mt-2 bg-white dark:bg-gray-800 rounded-xl p-3 text-sm">
                <div className="font-medium text-earth-700 dark:text-gray-200 mb-1">AI Analysis</div>
                <p className="text-earth-600 dark:text-gray-400">{analyses[lightboxPhoto.id].summary}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
