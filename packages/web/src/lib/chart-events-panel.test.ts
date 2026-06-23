// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  CHART_EVENTS_PANEL_OPEN_KEY,
  getStoredChartEventsPanelOpen,
  setStoredChartEventsPanelOpen,
} from './chart-events-panel';

describe('chart events panel storage', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('defaults to closed when nothing is persisted', () => {
    expect(getStoredChartEventsPanelOpen()).toBe(false);
  });

  it('round-trips the open flag through localStorage', () => {
    setStoredChartEventsPanelOpen(true);
    expect({
      stored: window.localStorage.getItem(CHART_EVENTS_PANEL_OPEN_KEY),
      read: getStoredChartEventsPanelOpen(),
    }).toEqual({ stored: 'true', read: true });
  });

  it('treats a corrupted entry as closed', () => {
    window.localStorage.setItem(CHART_EVENTS_PANEL_OPEN_KEY, 'banana');
    expect(getStoredChartEventsPanelOpen()).toBe(false);
  });
});
