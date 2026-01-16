import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * Performance Monitoring Hooks
 *
 * Utilities for tracking and measuring component performance.
 * Helps identify slow renders and performance bottlenecks.
 */

/**
 * Track component render time and count
 *
 * @param {string} componentName - Name of component for logging
 * @param {Object} options - Options
 * @param {boolean} [options.logRenders=false] - Log each render to console
 * @param {number} [options.warnThreshold=16] - Warn if render takes longer (ms)
 * @returns {Object} - { renderCount, avgRenderTime }
 */
export function useRenderTracking(componentName, options = {}) {
  const { logRenders = false, warnThreshold = 16 } = options;

  const renderCount = useRef(0);
  const totalRenderTime = useRef(0);
  const lastRenderStart = useRef(0);

  // Track render start
  lastRenderStart.current = performance.now();
  renderCount.current += 1;

  useEffect(() => {
    const renderTime = performance.now() - lastRenderStart.current;
    totalRenderTime.current += renderTime;

    if (logRenders) {
      const avgTime = totalRenderTime.current / renderCount.current;
      console.log(
        `[Render] ${componentName}: ${renderTime.toFixed(2)}ms (avg: ${avgTime.toFixed(2)}ms, count: ${renderCount.current})`
      );
    }

    if (renderTime > warnThreshold) {
      console.warn(
        `[Performance] Slow render detected in ${componentName}: ${renderTime.toFixed(2)}ms`
      );
    }
  });

  return {
    renderCount: renderCount.current,
    avgRenderTime: totalRenderTime.current / renderCount.current,
  };
}

/**
 * Track why a component re-rendered (for debugging)
 *
 * @param {string} componentName - Name of component
 * @param {Object} props - Current props
 * @param {Object} state - Current state (optional)
 */
export function useWhyDidUpdate(componentName, props, state = {}) {
  const previousProps = useRef({});
  const previousState = useRef({});

  useEffect(() => {
    const allChanges = {};

    // Check props
    const allProps = { ...previousProps.current, ...props };
    for (const key of Object.keys(allProps)) {
      if (previousProps.current[key] !== props[key]) {
        allChanges[`prop:${key}`] = {
          from: previousProps.current[key],
          to: props[key],
        };
      }
    }

    // Check state
    const allState = { ...previousState.current, ...state };
    for (const key of Object.keys(allState)) {
      if (previousState.current[key] !== state[key]) {
        allChanges[`state:${key}`] = {
          from: previousState.current[key],
          to: state[key],
        };
      }
    }

    if (Object.keys(allChanges).length > 0) {
      console.log(`[WhyDidUpdate] ${componentName}:`, allChanges);
    }

    previousProps.current = props;
    previousState.current = state;
  });
}

/**
 * Measure async operation performance
 *
 * @returns {Object} - { measure, getMeasurements }
 *
 * @example
 * const { measure, getMeasurements } = useAsyncMeasure();
 *
 * const data = await measure('fetchUsers', () => api.getUsers());
 * console.log(getMeasurements());
 */
export function useAsyncMeasure() {
  const measurements = useRef({});

  const measure = useCallback(async (name, asyncFn) => {
    const start = performance.now();
    try {
      const result = await asyncFn();
      const duration = performance.now() - start;

      if (!measurements.current[name]) {
        measurements.current[name] = { count: 0, totalTime: 0, min: Infinity, max: 0 };
      }

      const m = measurements.current[name];
      m.count += 1;
      m.totalTime += duration;
      m.min = Math.min(m.min, duration);
      m.max = Math.max(m.max, duration);
      m.avg = m.totalTime / m.count;

      return result;
    } catch (error) {
      const duration = performance.now() - start;
      console.error(`[Measure] ${name} failed after ${duration.toFixed(2)}ms:`, error);
      throw error;
    }
  }, []);

  const getMeasurements = useCallback(() => {
    return { ...measurements.current };
  }, []);

  const clearMeasurements = useCallback(() => {
    measurements.current = {};
  }, []);

  return { measure, getMeasurements, clearMeasurements };
}

/**
 * Report performance metrics to console or analytics
 *
 * @param {Object} options - Reporting options
 */
export function usePerformanceReporter(options = {}) {
  const {
    reportInterval = 30000, // Report every 30 seconds
    onReport = console.log,
    enabled = process.env.NODE_ENV === 'development',
  } = options;

  const metrics = useRef({
    renders: {},
    apiCalls: {},
    startTime: Date.now(),
  });

  // Report metrics periodically
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - metrics.current.startTime) / 1000;
      onReport('[Performance Report]', {
        elapsedSeconds: elapsed.toFixed(1),
        metrics: metrics.current,
      });
    }, reportInterval);

    return () => clearInterval(interval);
  }, [enabled, reportInterval, onReport]);

  const trackRender = useCallback((name, duration) => {
    if (!metrics.current.renders[name]) {
      metrics.current.renders[name] = { count: 0, totalMs: 0 };
    }
    metrics.current.renders[name].count += 1;
    metrics.current.renders[name].totalMs += duration;
  }, []);

  const trackApiCall = useCallback((name, duration, success) => {
    if (!metrics.current.apiCalls[name]) {
      metrics.current.apiCalls[name] = { count: 0, totalMs: 0, failures: 0 };
    }
    const m = metrics.current.apiCalls[name];
    m.count += 1;
    m.totalMs += duration;
    if (!success) m.failures += 1;
  }, []);

  return { trackRender, trackApiCall, metrics: metrics.current };
}

/**
 * Intersection observer hook for lazy loading
 * Useful for rendering items only when visible
 *
 * @param {Object} options - IntersectionObserver options
 * @returns {Array} - [ref, isVisible]
 */
export function useIntersectionObserver(options = {}) {
  const elementRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(([entry]) => {
      setIsVisible(entry.isIntersecting);
    }, {
      threshold: 0.1,
      rootMargin: '50px',
      ...options,
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [options]);

  return [elementRef, isVisible];
}

export default {
  useRenderTracking,
  useWhyDidUpdate,
  useAsyncMeasure,
  usePerformanceReporter,
  useIntersectionObserver,
};
