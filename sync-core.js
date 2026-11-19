(() => {
  'use strict';

  const kinds = Object.freeze(['workouts', 'sleep', 'weight']);
  const metadataKey = '_journalSync';
  const maxBatchBytes = 450_000;
  const maxChanges = 100;
  const maxRecords = 10_000;
  const hexHash = /^[a-f0-9]{64}$/;

  function validId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 200 &&
      value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const ms = Date.parse(value);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
  }

  function numberIn(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  }

  function normalizeRecord(kind, row) {
    if (!row || !validId(row.id) || !validDate(row.date)) throw Error('Merkinnän tunniste tai päivämäärä on virheellinen.');
    const record = { id: row.id, date: row.date };
    if (kind === 'workouts') {
      if (!Array.isArray(row.exercises) || !row.exercises.length || row.exercises.length > 100) throw Error('Treenin liikelista on virheellinen.');
      record.exercises = row.exercises.map(exercise => {
        if (!exercise || typeof exercise.name !== 'string' || !exercise.name.trim() || exercise.name.length > 80 ||
            !Array.isArray(exercise.sets) || !exercise.sets.length || exercise.sets.length > 100) throw Error('Liikkeen tiedot ovat virheelliset.');
        const sets = exercise.sets.map(set => {
          if (!set || !numberIn(set.weight, 0, 2000) || !Number.isInteger(set.reps) || !numberIn(set.reps, 1, 1000)) throw Error('Sarjan tiedot ovat virheelliset.');
          return { weight: set.weight, reps: set.reps };
        });
        const clean = { name: exercise.name, sets };
        if (exercise.unit !== undefined) {
          if (!['kg', 'lbs'].includes(exercise.unit)) throw Error('Painoyksikkö on virheellinen.');
          clean.unit = exercise.unit;
        }
        return clean;
      });
      if (row.category !== undefined) {
        if (row.category !== null && (typeof row.category !== 'string' || row.category.length > 60 || /[\u0000-\u001f\u007f]/.test(row.category))) throw Error('Treenin kategoria on virheellinen.');
        record.category = row.category;
      }
      if (row.savedAt !== undefined) {
        if (typeof row.savedAt !== 'string' || row.savedAt.length > 100 || !Number.isFinite(Date.parse(row.savedAt))) throw Error('Treenin tallennusaika on virheellinen.');
        record.savedAt = row.savedAt;
      }
    } else if (kind === 'sleep') {
      const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (typeof row.bed !== 'string' || !clock.test(row.bed) || typeof row.wake !== 'string' || !clock.test(row.wake)) throw Error('Yöajan kellonajat ovat virheelliset.');
      const minute = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      let duration = minute(row.wake) - minute(row.bed);
      if (duration <= 0) duration += 1440;
      if (duration > 960) throw Error('Yöajan kesto on virheellinen.');
      Object.assign(record, { bed: row.bed, wake: row.wake, duration: duration / 60 });
    } else if (kind === 'weight') {
      if (!numberIn(row.value, 1, 1000)) throw Error('Painon arvo on virheellinen.');
      record.value = row.value;
      if (row.source !== undefined || row.garminId !== undefined || row.measuredAt !== undefined) {
        if (!globalThis.KuntokayraGarmin?.isGarminRow(row)) throw Error('Garmin-painon tiedot ovat virheelliset.');
        Object.assign(record, { source: 'garmin', garminId: row.garminId, measuredAt: row.measuredAt });
      }
    } else {
      throw Error('Tuntematon merkintätyyppi.');
    }
    return record;
  }

  const rowKey = (kind, id) => `${kind}:${id}`;
  const validAccount = value => typeof value === 'string' && hexHash.test(value);
  const validCursor = value => Number.isSafeInteger(value) && value >= 0;

  function normalizeChanges(changes) {
    if (!Array.isArray(changes) || !changes.length || changes.length > maxChanges) throw Error('Merkintöjen määrä on virheellinen.');
    const keys = new Set();
    return changes.map(change => {
      if (!change || !kinds.includes(change.kind) || !validId(change.id)) throw Error('Synkronoitava merkintä on virheellinen.');
      const key = rowKey(change.kind, change.id);
      if (keys.has(key)) throw Error('Merkintä esiintyy samassa lähetyksessä kahdesti.');
      keys.add(key);
      const record = change.record === null ? null : normalizeRecord(change.kind, change.record);
      if (record && record.id !== change.id) throw Error('Merkinnän tunnisteet eivät täsmää.');
      return { kind: change.kind, id: change.id, record };
    });
  }

  async function hash(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function indexJournal(state) {
    const result = new Map();
    for (const kind of kinds) {
      for (const original of state[kind]) {
        const record = normalizeRecord(kind, original);
        const key = rowKey(kind, record.id);
        if (result.has(key)) throw Error('Kaksi merkintää käyttää samaa tunnistetta.');
        result.set(key, { kind, id: record.id, record, original });
      }
    }
    if (result.size > maxRecords) throw Error('Pilvikokeilu tukee enintään 10 000 merkintää laitteella.');
    return result;
  }

  async function merge(localState, base, incoming) {
    const index = indexJournal(localState);
    const nextBase = { ...base };
    let conflicts = 0;
    const changedKinds = new Set();
    for (const [key, update] of incoming) {
      const local = index.get(key);
      const before = base[key] ?? null;
      const [localHash, cloudHash] = await Promise.all([
        local ? hash(JSON.stringify(local.record)) : null,
        update.record ? hash(JSON.stringify(update.record)) : null,
      ]);
      if (cloudHash) nextBase[key] = cloudHash;
      else delete nextBase[key];
      if (localHash === cloudHash || cloudHash === before) continue;

      if (localHash !== before) {
        conflicts++;
        // Keep an edited entry even if the other device deleted it. For two edits,
        // both versions get a stable identity so a retry cannot add another copy.
        if (!update.record) continue;
        if (local) {
          const copyId = `cloud-copy-${await hash(`${key}\n${localHash}`)}`;
          const copyKey = rowKey(update.kind, copyId);
          if (!index.has(copyKey)) {
            index.set(copyKey, { ...local, id: copyId, record: { ...local.record, id: copyId }, original: { ...local.original, id: copyId } });
          }
        }
      }
      if (update.record) index.set(key, { ...update, original: update.record });
      else index.delete(key);
      changedKinds.add(update.kind);
    }
    if (index.size > maxRecords) throw Error('Yhdistetty päiväkirja ylittää pilvikokeilun merkintärajan.');
    const state = { ...localState };
    for (const kind of changedKinds) state[kind] = [];
    for (const { kind, original } of index.values()) {
      if (changedKinds.has(kind)) state[kind].push(original);
    }
    return { state, base: nextBase, conflicts };
  }

  async function changesSince(state, base) {
    const index = indexJournal(state);
    const changes = [];
    for (const [key, entry] of index) {
      const fingerprint = await hash(JSON.stringify(entry.record));
      if (base[key] !== fingerprint) changes.push({ kind: entry.kind, id: entry.id, record: entry.record, fingerprint });
    }
    for (const key of Object.keys(base)) {
      if (index.has(key)) continue;
      const separator = key.indexOf(':');
      changes.push({ kind: key.slice(0, separator), id: key.slice(separator + 1), record: null, fingerprint: null });
    }
    return changes;
  }

  function readMetadata(raw) {
    if (!raw || !validAccount(raw.account) || !validCursor(raw.cursor) || typeof raw.enabled !== 'boolean' ||
        !raw.base || typeof raw.base !== 'object' || Array.isArray(raw.base)) return null;
    const entries = Object.entries(raw.base);
    if (entries.length > maxRecords || entries.some(([key, value]) => {
      const separator = key.indexOf(':');
      return !kinds.includes(key.slice(0, separator)) || !validId(key.slice(separator + 1)) || !validAccount(value);
    })) return null;
    return raw;
  }

  function retainedBackup(state) {
    const { [metadataKey]: omitted, ...data } = state;
    return data;
  }

  globalThis.KuntokayraSync = Object.freeze({
    kinds, metadataKey, maxBatchBytes, maxChanges, maxRecords, validAccount, validCursor, validId,
    normalizeChanges, rowKey, hash, merge, changesSince, readMetadata, retainedBackup,
  });
})();
