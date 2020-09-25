import { getGlobalObject } from './misc';
import { dynamicRequire, isNodeEnv } from './node';

/**
 * An object that can return the current timestamp in seconds since the UNIX epoch.
 */
interface TimestampSource {
  nowSeconds(): number;
}

/**
 * A TimestampSource implementation for environments that do not support the Performance Web API natively.
 *
 * Note that this TimestampSource does not use a monotonic clock. A call to `nowSeconds` may return a timestamp earlier
 * than a previously returned value. We do not try to emulate a monotonic behavior in order to facilitate debugging. It
 * is more obvious to explain "why does my span have negative duration" than "why my spans have zero duration".
 */
const dateTimestampSource = ((): TimestampSource => ({
  nowSeconds: () => Date.now() / 1000,
}))();

/**
 * A partial definition of the [Performance Web API]{@link https://developer.mozilla.org/en-US/docs/Web/API/Performance}
 * for accessing a high resolution monotonic clock.
 */
interface Performance {
  /**
   * Returns the current millisecond timestamp, where 0 represents the start of measurement.
   */
  now(): number;
  /**
   * The millisecond timestamp at which measurement began, measured in Unix time.
   */
  timeOrigin: number;
}

/**
 * Returns a wrapper around the native Performance API browser implementation, or undefined for browsers that do not
 * support the API.
 *
 * Wrapping the native API works around differences in behavior from different browsers.
 */
function getBrowserPerformance(): Performance | undefined {
  const { performance } = getGlobalObject<Window>();
  if (!performance || !performance.now) {
    return undefined;
  }

  // Replace performance.timeOrigin with our own timeOrigin based on Date.now().
  //
  // This is a workaround for browsers reporting performance.timeOrigin such that performance.timeOrigin +
  // performance.now() gives a date arbitrarily in the past.
  //
  // See https://github.com/getsentry/sentry-javascript/issues/2590.
  //
  // Additionally, computing timeOrigin in this way fills the gap for environments where performance.timeOrigin is
  // undefined.
  const timeOrigin = Date.now() - performance.now();

  return {
    now: () => performance.now(),
    timeOrigin,
  };
}

/**
 * Returns the native Performance API implementation from Node.js. Returns undefined in old Node.js versions that don't
 * implement the API.
 */
function getNodePerformance(): Performance | undefined {
  try {
    const perfHooks = dynamicRequire(module, 'perf_hooks') as { performance: Performance };
    return perfHooks.performance;
  } catch (_) {
    return undefined;
  }
}

/**
 * The Performance API implementation for the current platform, if available.
 */
const platformPerformance = ((): Performance | undefined => {
  if (isNodeEnv()) {
    return getNodePerformance();
  }
  return getBrowserPerformance();
})();

let timestampSource = dateTimestampSource;

if (platformPerformance !== undefined) {
  timestampSource = {
    nowSeconds: () => {
      const ret = (platformPerformance.timeOrigin + platformPerformance.now()) / 1000;
      console.log(platformPerformance.timeOrigin, platformPerformance.now(), ret);
      return ret;
    },
  };
}

export const { nowSeconds: timestampInSeconds } = timestampSource;

// Re-exported with an old name for backwards-compatibility.
export const { nowSeconds: timestampWithMs } = timestampSource;

export const usingPerformanceAPI = platformPerformance !== undefined;