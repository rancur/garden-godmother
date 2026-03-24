'use client';

import { useEffect, useState } from 'react';
import { getCalendarMonth, getSettings } from '../../api';
import { getGardenYear } from '../../timezone';

interface CalendarEvent {
  plant_id: number;
  plant_name: string;
  event_type: string;
  category: string;
  notes: string;
}

type ActionGroup = 'sow' | 'transplant' | 'harvest';

const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const actionLabels: Record<ActionGroup, string> = {
  sow: 'Sow',
  transplant: 'Transplant',
  harvest: 'Harvest',
};

const actionColors: Record<ActionGroup, string> = {
  sow: '#2563eb',
  transplant: '#16a34a',
  harvest: '#ea580c',
};

function classifyAction(eventType: string): ActionGroup {
  if (eventType === 'transplant') return 'transplant';
  if (eventType === 'harvest') return 'harvest';
  return 'sow';
}

function groupByAction(events: CalendarEvent[]): Record<ActionGroup, string[]> {
  const groups: Record<ActionGroup, Set<string>> = {
    sow: new Set(),
    transplant: new Set(),
    harvest: new Set(),
  };
  for (const e of events) {
    const action = classifyAction(e.event_type);
    groups[action].add(e.plant_name);
  }
  return {
    sow: Array.from(groups.sow).sort(),
    transplant: Array.from(groups.transplant).sort(),
    harvest: Array.from(groups.harvest).sort(),
  };
}

export default function PrintCalendarPage() {
  const [allMonths, setAllMonths] = useState<Record<number, CalendarEvent[]>>({});
  const [loading, setLoading] = useState(true);
  const [lastFrost, setLastFrost] = useState<string | null>(null);
  const [firstFrost, setFirstFrost] = useState<string | null>(null);
  const [usdaZone, setUsdaZone] = useState<string | null>(null);
  const year = getGardenYear();

  useEffect(() => {
    // Fetch settings for frost dates and zone
    getSettings().then((s: any) => {
      if (s?.property?.last_frost_spring) setLastFrost(s.property.last_frost_spring);
      if (s?.property?.first_frost_fall) setFirstFrost(s.property.first_frost_fall);
      // Zone may be in localStorage
      const storedZone = typeof window !== 'undefined' ? localStorage.getItem('garden-usda-zone') : null;
      if (storedZone) setUsdaZone(storedZone);
    }).catch(() => {});

    Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        getCalendarMonth(i + 1)
          .then((data: any) => {
            // API returns { month, year, plants: [{ id, name, category, events: string[] }] }
            // Flatten into CalendarEvent[]
            const plants = data?.plants || data || [];
            const flattened: CalendarEvent[] = [];
            if (Array.isArray(plants)) {
              for (const plant of plants) {
                const eventTypes: string[] = plant.events || [];
                for (const et of eventTypes) {
                  flattened.push({
                    plant_id: plant.id,
                    plant_name: plant.name,
                    event_type: et,
                    category: plant.category,
                    notes: plant.notes || '',
                  });
                }
              }
            }
            return { month: i + 1, events: flattened };
          })
          .catch(() => ({ month: i + 1, events: [] as CalendarEvent[] }))
      )
    ).then((results) => {
      const data: Record<number, CalendarEvent[]> = {};
      for (const r of results) {
        data[r.month] = r.events;
      }
      setAllMonths(data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        Loading calendar data...
      </div>
    );
  }

  return (
    <>
      <style jsx global>{`
        @media print {
          body { margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .print-page {
            padding: 0.25in;
            font-size: 8pt;
          }
          .month-grid {
            grid-template-columns: repeat(3, 1fr) !important;
            gap: 6px !important;
          }
          .month-cell {
            break-inside: avoid;
            padding: 4px !important;
            border: 1px solid #d1d5db !important;
          }
          .month-title {
            font-size: 9pt !important;
            margin-bottom: 2px !important;
          }
          .action-label {
            font-size: 7pt !important;
          }
          .plant-name {
            font-size: 7pt !important;
          }
          .page-header {
            font-size: 12pt !important;
            margin-bottom: 4px !important;
          }
          .page-subheader {
            font-size: 8pt !important;
            margin-bottom: 8px !important;
          }
          @page {
            size: letter landscape;
            margin: 0.3in;
          }
        }

        @media screen {
          .print-page {
            max-width: 1200px;
            margin: 0 auto;
            padding: 1.5rem;
            font-family: system-ui, -apple-system, sans-serif;
            background: white;
          }
        }
      `}</style>

      <div className="print-page" style={{ background: 'white', color: '#1a1a1a' }}>
        {/* Print button - hidden when printing */}
        <div className="no-print" style={{ marginBottom: '1rem' }}>
          <button
            onClick={() => window.print()}
            style={{
              padding: '0.5rem 1.5rem',
              fontSize: '1rem',
              fontWeight: 600,
              background: '#16a34a',
              color: 'white',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              marginRight: '0.75rem',
            }}
          >
            Print Calendar
          </button>
          <a
            href="/calendar"
            style={{
              padding: '0.5rem 1.5rem',
              fontSize: '1rem',
              fontWeight: 600,
              background: '#e5e7eb',
              color: '#374151',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Back to Calendar
          </a>
        </div>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
          <h1 className="page-header" style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>
            {usdaZone ? `Zone ${usdaZone}` : 'Garden Godmother'} — Planting Calendar
          </h1>
          <p className="page-subheader" style={{ fontSize: '0.875rem', color: '#6b7280', margin: '0.25rem 0 0' }}>
            {year} Planting Calendar
            {lastFrost && <>&nbsp;|&nbsp; Last Frost: {lastFrost}</>}
            {firstFrost && <>&nbsp;|&nbsp; First Frost: {firstFrost}</>}
          </p>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginBottom: '0.75rem', fontSize: '0.75rem' }}>
          {(Object.keys(actionLabels) as ActionGroup[]).map((action) => (
            <span key={action} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '2px',
                background: actionColors[action],
              }} />
              <span style={{ fontWeight: 600 }}>{actionLabels[action]}</span>
            </span>
          ))}
        </div>

        {/* 12-month grid: 4 rows x 3 columns */}
        <div
          className="month-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '10px',
          }}
        >
          {months.map((name, i) => {
            const events = allMonths[i + 1] || [];
            const grouped = groupByAction(events);
            const lastFrostMonth = lastFrost ? parseInt(lastFrost.split('-')[0], 10) : 0;
            const firstFrostMonth = firstFrost ? parseInt(firstFrost.split('-')[0], 10) : 0;
            const isLastFrostMonth = lastFrostMonth > 0 && (i + 1) === lastFrostMonth;
            const isFirstFrostMonth = firstFrostMonth > 0 && (i + 1) === firstFrostMonth;
            const isFrostMonth = isLastFrostMonth || isFirstFrostMonth;

            return (
              <div
                key={i}
                className="month-cell"
                style={{
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  padding: '8px',
                  background: isFrostMonth ? '#fefce8' : 'white',
                  minHeight: '100px',
                }}
              >
                <div
                  className="month-title"
                  style={{
                    fontWeight: 700,
                    fontSize: '0.875rem',
                    borderBottom: '1px solid #e5e7eb',
                    paddingBottom: '3px',
                    marginBottom: '5px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>{name}</span>
                  {isLastFrostMonth && lastFrost && (
                    <span style={{ fontSize: '0.625rem', color: '#b45309', fontWeight: 500 }}>
                      Last frost ~{lastFrost}
                    </span>
                  )}
                  {isFirstFrostMonth && firstFrost && (
                    <span style={{ fontSize: '0.625rem', color: '#b45309', fontWeight: 500 }}>
                      First frost ~{firstFrost}
                    </span>
                  )}
                </div>

                {events.length === 0 ? (
                  <div style={{ color: '#9ca3af', fontSize: '0.75rem', fontStyle: 'italic' }}>
                    No plantings
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {(Object.keys(actionLabels) as ActionGroup[]).map((action) => {
                      const plants = grouped[action];
                      if (plants.length === 0) return null;
                      return (
                        <div key={action}>
                          <span
                            className="action-label"
                            style={{
                              color: actionColors[action],
                              fontWeight: 700,
                              fontSize: '0.6875rem',
                              textTransform: 'uppercase',
                              letterSpacing: '0.025em',
                            }}
                          >
                            {actionLabels[action]}:
                          </span>{' '}
                          <span
                            className="plant-name"
                            style={{ fontSize: '0.6875rem', color: '#374151' }}
                          >
                            {plants.join(', ')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
