'use client';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl mb-4">🌱</div>
        <h2 className="text-2xl font-bold text-earth-800 dark:text-gray-200 mb-2">Something went wrong</h2>
        <p className="text-earth-600 dark:text-gray-400 mb-6 text-sm">
          {error.message || 'An unexpected error occurred in the garden.'}
        </p>
        <button
          onClick={reset}
          className="px-6 py-3 bg-garden-600 hover:bg-garden-700 text-white font-medium rounded-lg transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
