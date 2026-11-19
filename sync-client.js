(() => {
  'use strict';

  const Sync = globalThis.KuntokayraSync;
  const retryDelay = 15_000;

  function createController({ readState, writeState, sameStorage, canApply, notify, download, transport }) {
    let task = null;
    let timer = null;
    let pending = false;
    let lastCheck = -Infinity;
    let status = '';

    const metadata = () => Sync.readMetadata(readState()[Sync.metadataKey]);

    function report(message) {
      status = message;
      notify();
    }

    function assertCurrent(signal) {
      if (signal.aborted) throw Error('Pilvihaku keskeytyi. Yritä uudelleen.');
      if (!sameStorage()) throw Error('Merkinnät muuttuivat toisessa välilehdessä. Avaa sivu uudelleen.');
    }

    function deferIfEditing() {
      if (canApply()) return false;
      pending = true;
      return true;
    }

    async function request(signal, body) {
      assertCurrent(signal);
      const response = await transport(body, signal);
      assertCurrent(signal);
      const value = await response.json().catch(() => null);
      assertCurrent(signal);
      if (!value || typeof value !== 'object') throw Error('Pilvipalvelun vastaus ei ollut kelvollinen. Avaa esikatselu uudelleen.');
      if (response.ok) return value;
      if (response.status === 409 && value.error === 'RETRY_WITH_LATEST') return null;
      if (value.error === 'SIGN_IN' || response.status === 401) {
        throw Error('Kirjaudu Googlella uudelleen. Selaimen merkinnät ovat tallessa.');
      }
      if (value.error === 'ACCOUNT_CHANGED') throw Error('Avaa sovellus samalla Google-tilillä, johon tämä päiväkirja yhdistettiin.');
      if (value.error === 'HISTORY_CHANGED') throw Error('Pilvikopio on vaihtunut. Selaimen merkinnät ovat tallessa.');
      throw Error('Pilvipalveluun ei saatu yhteyttä. Yritä uudelleen.');
    }

    async function pull(signal, cursor, account) {
      const incoming = new Map();
      let more;
      do {
        const page = await request(signal, { action: 'pull', after: cursor, ...(account ? { account } : {}) });
        if (!page || !Sync.validAccount(page.account) || (account && page.account !== account) ||
            !Array.isArray(page.commits) || typeof page.more !== 'boolean' || (page.more && !page.commits.length)) {
          throw Error('Pilvikopion tiedot ovat virheelliset.');
        }
        account = page.account;
        more = page.more;
        for (const commit of page.commits) {
          if (!commit || !Sync.validCursor(commit.revision) || commit.revision <= cursor) throw Error('Pilvikopion järjestys on virheellinen.');
          for (const update of Sync.normalizeChanges(commit.changes)) incoming.set(Sync.rowKey(update.kind, update.id), update);
          cursor = commit.revision;
        }
      } while (more);
      return { cursor, account, incoming };
    }

    function commitState(state, meta) {
      if (!writeState({ ...state, [Sync.metadataKey]: meta })) throw Error('Pilvikopion tallennus selaimeen ei onnistunut. Aiemmat merkinnät ovat tallessa.');
    }

    function* batches(changes, account) {
      const encoder = new TextEncoder();
      let batch = [];
      let bytes = encoder.encode(JSON.stringify({ action: 'push', account, after: Number.MAX_SAFE_INTEGER, changes: [] })).length;
      const overhead = bytes;
      for (const { fingerprint, ...change } of changes) {
        const length = encoder.encode(JSON.stringify(change)).length + 1;
        if (overhead + length > Sync.maxBatchBytes) throw Error('Yksi merkintä on liian suuri pilvikokeiluun.');
        if (batch.length === Sync.maxChanges || bytes + length > Sync.maxBatchBytes) {
          yield batch;
          batch = [];
          bytes = overhead;
        }
        batch.push({ change, fingerprint });
        bytes += length;
      }
      if (batch.length) yield batch;
    }

    async function reconcile(signal) {
      let conflicts = 0;
      for (let attempt = 0; attempt < 4; attempt++) {
        let meta = metadata();
        const received = await pull(signal, meta?.cursor ?? 0, meta?.account);
        if (deferIfEditing()) return 'Pilvisynkronointi jatkuu, kun suljet lomakkeen.';

        let snapshot, merged;
        do {
          snapshot = readState();
          merged = received.incoming.size ? await Sync.merge(snapshot, meta?.base ?? {}, received.incoming) : { state: snapshot, base: meta?.base ?? {}, conflicts: 0 };
          assertCurrent(signal);
          if (deferIfEditing()) return 'Pilvisynkronointi jatkuu, kun suljet lomakkeen.';
        } while (snapshot !== readState());

        conflicts += merged.conflicts;
        if (!meta?.enabled || received.cursor !== meta.cursor) {
          meta = {
            account: received.account, cursor: received.cursor, enabled: true, base: merged.base,
            lastSyncedAt: new Date().toISOString(), conflicts: (meta?.conflicts ?? 0) + merged.conflicts,
          };
          commitState(merged.state, meta);
        }

        const local = readState();
        const changes = await Sync.changesSince(local, meta.base);
        assertCurrent(signal);
        if (deferIfEditing()) return 'Pilvisynkronointi jatkuu, kun suljet lomakkeen.';
        if (local !== readState()) {
          pending = true;
          return 'Uudet merkinnät odottavat synkronointia.';
        }

        let retry = false;
        for (const batch of batches(changes, meta.account)) {
          if (deferIfEditing()) return 'Pilvisynkronointi jatkuu, kun suljet lomakkeen.';
          if (Sync.kinds.some(kind => local[kind] !== readState()[kind])) {
            pending = true;
            return 'Uudet merkinnät odottavat synkronointia.';
          }
          const result = await request(signal, { action: 'push', account: meta.account, after: meta.cursor, changes: batch.map(item => item.change) });
          if (!result) {
            retry = true;
            break;
          }
          if (result.account !== meta.account || !Sync.validCursor(result.revision) || result.revision <= meta.cursor) throw Error('Pilvipalvelun kuittaus on virheellinen.');
          const base = { ...meta.base };
          for (const { change, fingerprint } of batch) {
            const key = Sync.rowKey(change.kind, change.id);
            if (fingerprint) base[key] = fingerprint;
            else delete base[key];
          }
          meta = { ...meta, cursor: result.revision, base, lastSyncedAt: new Date().toISOString() };
          // A save during the request stays in the journal and is compared with
          // exactly the versions the cloud acknowledged in the next sync.
          commitState(readState(), meta);
        }
        if (retry) continue;
        return conflicts ? 'Synkronoitu. Ristiriitaisissa muokkauksissa säilytettiin kirjatut versiot.' : 'Merkinnät ovat ajan tasalla.';
      }
      throw Error('Merkinnät päivittyvät toisella laitteella. Yritä hetken kuluttua uudelleen.');
    }

    async function run(work) {
      if (task || !canApply()) return;
      if (navigator.onLine === false) {
        report('Verkkoyhteys puuttuu. Voit jatkaa kirjaamista tässä selaimessa.');
        return;
      }
      clearTimeout(timer);
      timer = null;
      pending = false;
      lastCheck = Date.now();
      const controller = new AbortController();
      task = controller;
      const timeout = setTimeout(() => controller.abort(), 45_000);
      report('Otetaan yhteyttä pilvipalveluun…');
      try {
        const message = await work(controller.signal);
        if (task === controller) report(message);
      } catch (error) {
        if (task === controller) {
          const reason = error instanceof TypeError ? 'Yhteys pilvipalveluun katkesi. Selaimen merkinnät ovat tallessa.' : error.message;
          report(reason);
        }
      } finally {
        clearTimeout(timeout);
        if (task === controller) {
          task = null;
          notify();
          if (pending) schedule();
        }
      }
    }

    function schedule() {
      if (!metadata()?.enabled) return;
      if (task || !canApply()) {
        pending = true;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => sync(), 1000);
    }

    function sync({ automatic = false } = {}) {
      if (!metadata()?.enabled) return;
      if (automatic && !pending && Date.now() - lastCheck < retryDelay) return;
      if (task || !canApply()) {
        pending = true;
        return;
      }
      return run(reconcile);
    }

    function stop() {
      clearTimeout(timer);
      timer = null;
      pending = false;
      task?.abort();
      task = null;
    }

    function pause() {
      const meta = metadata();
      if (!meta || !writeState({ ...readState(), [Sync.metadataKey]: { ...meta, enabled: false } })) return;
      stop();
      report('Synkronointi on pois päältä tällä laitteella.');
    }

    function withPausedSync(state) {
      const meta = metadata();
      // A backup import or device-local reset must not become a cloud deletion.
      return meta ? { ...state, [Sync.metadataKey]: { account: meta.account, cursor: 0, base: {}, enabled: false } } : state;
    }

    return {
      metadata, schedule, sync, stop, pause, withPausedSync,
      afterDialog: () => { if (pending) schedule(); },
      enable: () => run(reconcile),
      status: () => status,
      busy: () => Boolean(task),
      exportCloud: () => run(async signal => {
        const meta = metadata();
        if (!meta) return 'Ota pilvisynkronointi ensin käyttöön.';
        const { incoming } = await pull(signal, 0, meta.account);
        const state = { workouts: [], sleep: [], weight: [] };
        for (const { kind, record } of incoming.values()) if (record) state[kind].push(record);
        assertCurrent(signal);
        download(state);
        return 'Pilvikopio ladattu tiedostoksi.';
      }),
    };
  }

  if (Sync) globalThis.KuntokayraCloud = Object.freeze({ createController });
})();
