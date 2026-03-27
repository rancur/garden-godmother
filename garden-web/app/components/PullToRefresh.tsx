'use client';
import { useState, useRef, useCallback } from 'react';

interface Props {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}

export function PullToRefresh({ onRefresh, children }: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop === 0) {
      startY.current = e.touches[0].clientY;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current === 0) return;
    const diff = e.touches[0].clientY - startY.current;
    if (diff > 0 && diff < 150) {
      setPullDistance(diff);
    }
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (pullDistance > 60 && !refreshing) {
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    }
    setPullDistance(0);
    startY.current = 0;
  }, [pullDistance, refreshing, onRefresh]);

  return (
    <div
      ref={scrollRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {(pullDistance > 0 || refreshing) && (
        <div
          className="flex justify-center py-3 transition-all"
          style={{ height: refreshing ? 48 : pullDistance * 0.5 }}
        >
          <div
            className={`w-6 h-6 border-[3px] border-garden-200 border-t-garden-600 rounded-full ${
              refreshing ? 'animate-spin' : ''
            }`}
            style={
              !refreshing
                ? { transform: `rotate(${pullDistance * 3}deg)` }
                : undefined
            }
          />
        </div>
      )}
      {children}
    </div>
  );
}
