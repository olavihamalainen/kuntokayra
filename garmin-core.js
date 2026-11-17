(() => {
  'use strict';

  const TIME_ZONE = 'Europe/Helsinki';
  const DEFAULT_WINDOW = Object.freeze({ start: '06:00', end: '12:00' });
  const MIN_TIMESTAMP = Date.UTC(2000, 0, 1);
  const MAX_TIMESTAMP = Date.UTC(10000, 0, 1) - 1;
  const MAX_MEASUREMENTS = 10000;
  const localFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });

  function minuteOfTime(value) {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  }

  function validWindow(window) {
    if (!window || typeof window !== 'object' || Array.isArray(window)) return false;
    const start = minuteOfTime(window.start), end = minuteOfTime(window.end);
    return start !== null && end !== null && start < end;
  }

  function assertWindow(window) {
    if (!validWindow(window)) throw new Error('Valitse saman päivän aamuaika muodossa HH:MM. Aloituksen pitää olla ennen lopetusta.');
  }

  function calendarParts(timestamp) {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) {
      throw new Error('Mittauksen aikaleima on virheellinen.');
    }
    const parts = Object.fromEntries(localFormatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
    if (!/^\d{4}$/.test(parts.year)) throw new Error('Mittauksen päivämäärä on sallittujen rajojen ulkopuolella.');
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
  }

  function getDate(timestamp) { return calendarParts(timestamp).date; }

  function validId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 150 &&
      value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
  }

  function validWeight(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 1000; }

  function compareMeasurements(a, b) {
    return a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  function validatedMeasurements(measurements, latestTimestamp) {
    if (!Array.isArray(measurements) || measurements.length > MAX_MEASUREMENTS) {
      throw new Error('Garmin-mittausten määrä tai muoto on virheellinen.');
    }
    const byId = new Map();
    for (const measurement of measurements) {
      if (!measurement || typeof measurement !== 'object' || Array.isArray(measurement) || !validId(measurement.id) ||
          typeof measurement.timestamp !== 'number' || !Number.isFinite(measurement.timestamp) ||
          measurement.timestamp < MIN_TIMESTAMP || measurement.timestamp > latestTimestamp ||
          measurement.timestamp > MAX_TIMESTAMP || !validWeight(measurement.weight)) {
        throw new Error('Garmin-mittauksen tunniste, aikaleima tai paino on virheellinen.');
      }
      // Date/ISO strings have millisecond precision; normalize to that same precision.
      const candidate = { id: measurement.id, timestamp: new Date(measurement.timestamp).getTime(), weight: measurement.weight };
      getDate(candidate.timestamp);
      const previous = byId.get(candidate.id);
      if (previous && (previous.timestamp !== candidate.timestamp || previous.weight !== candidate.weight)) {
        throw new Error('Sama Garmin-tunniste esiintyy ristiriitaisissa mittauksissa.');
      }
      if (!previous) byId.set(candidate.id, candidate);
    }
    return [...byId.values()].sort(compareMeasurements);
  }

  function normalizeMeasurements(measurements, now = Date.now()) {
    if (typeof now !== 'number' || !Number.isFinite(now) || now < MIN_TIMESTAMP || now > MAX_TIMESTAMP) {
      throw new Error('Nykyinen kellonaika on virheellinen.');
    }
    return validatedMeasurements(measurements, now);
  }

  function insideWindow(timestamp, window) {
    const minute = calendarParts(timestamp).minute;
    return minute >= minuteOfTime(window.start) && minute < minuteOfTime(window.end);
  }

  function earliestByDay(measurements, window) {
    const byDate = new Map();
    for (const measurement of measurements) {
      if (!insideWindow(measurement.timestamp, window)) continue;
      const date = getDate(measurement.timestamp);
      if (!byDate.has(date)) byDate.set(date, { ...measurement, date });
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  function selectMorning(measurements, window = DEFAULT_WINDOW, now = Date.now()) {
    assertWindow(window);
    return earliestByDay(normalizeMeasurements(measurements, now), window);
  }

  function isGarminRow(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || record.source !== 'garmin' ||
        !validId(record.garminId) || typeof record.id !== 'string' || !record.id.trim() || !validWeight(record.value) ||
        typeof record.measuredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.measuredAt)) return false;
    const timestamp = Date.parse(record.measuredAt);
    if (!Number.isFinite(timestamp) || timestamp < MIN_TIMESTAMP || timestamp > MAX_TIMESTAMP ||
        new Date(timestamp).toISOString() !== record.measuredAt) return false;
    try { return typeof record.date === 'string' && record.date === getDate(timestamp); }
    catch (_) { return false; }
  }

  function savedRow(measurement) {
    return {
      id: `garmin-${measurement.id}`, date: getDate(measurement.timestamp), value: measurement.weight,
      source: 'garmin', garminId: measurement.id, measuredAt: new Date(measurement.timestamp).toISOString()
    };
  }

  function mergeWeights(existing, selected, window = DEFAULT_WINDOW) {
    if (!Array.isArray(existing)) throw new Error('Nykyisten painomerkintöjen muoto on virheellinen.');
    assertWindow(window);
    // Selection may already contain local dates; always derive them from timestamps.
    const normalized = validatedMeasurements(selected, MAX_TIMESTAMP);
    const candidates = earliestByDay(normalized, window);
    let rows = existing, added = 0, updated = 0, skipped = selected.length - candidates.length;
    const copy = () => { if (rows === existing) rows = [...existing]; };

    for (const measurement of candidates) {
      const candidate = savedRow(measurement);
      const dayIndexes = [], idIndexes = [];
      rows.forEach((row, index) => {
        if (row?.date === candidate.date) dayIndexes.push(index);
        if (row?.id === candidate.id || row?.garminId === candidate.garminId) idIndexes.push(index);
      });
      // Existing ambiguous/legacy records are preserved, never consolidated or deleted.
      if (dayIndexes.length > 1 || dayIndexes.some(index => !isGarminRow(rows[index])) ||
          idIndexes.some(index => !dayIndexes.includes(index))) { skipped++; continue; }
      if (!dayIndexes.length) {
        copy(); rows.push(candidate); added++; continue;
      }
      const index = dayIndexes[0], previous = rows[index], previousTime = Date.parse(previous.measuredAt);
      const sameMeasurement = previous.garminId === candidate.garminId && previousTime === measurement.timestamp;
      if (sameMeasurement && previous.value === candidate.value) { skipped++; continue; }
      if (!sameMeasurement && measurement.timestamp >= previousTime && insideWindow(previousTime, window)) { skipped++; continue; }
      copy(); rows[index] = { ...candidate, id: previous.id }; updated++;
    }
    return { rows, added, updated, skipped };
  }

  function dateRange30(now = Date.now()) {
    const to = getDate(now), start = new Date(`${to}T12:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() - 29);
    return { from: start.toISOString().slice(0, 10), to };
  }

  globalThis.KuntokayraGarmin = Object.freeze({
    DEFAULT_WINDOW, TIME_ZONE, validWindow, getDate, normalizeMeasurements,
    selectMorning, mergeWeights, isGarminRow, dateRange30
  });
})();
