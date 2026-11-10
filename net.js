// Noodle Pit party networking — a thin wrapper over PeerJS (WebRTC data channels). The host's phone runs the game;
// guests connect straight to it, introduced by PeerJS's public matchmaking server via a 4-letter room code.
// PeerJS (vendor/peerjs.min.js) is only loaded when someone opens party mode, so solo play never needs the network.
// window.NOODLE_PEER can override the server options ({host, port, path, secure}) — the tests use a local one.
(() => {
  const PREFIX = 'noodlepit-';
  let peer = null, hostConn = null, handler = () => {}, role = null;
  let gen = 0;   // bumped by close(): a host()/join() still in flight notices and stands down instead of going live
  const conns = new Map();   // host: peer id -> DataConnection

  function loadLib() {
    if (window.Peer) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = 'vendor/peerjs.min.js';
      s.onload = () => resolve(); s.onerror = () => reject(new Error("Couldn't load party mode. Are you online?"));
      document.head.appendChild(s);
    });
  }
  const opts = () => ({ debug: 0, ...(window.NOODLE_PEER || {}) });
  // resolve once the peer is registered with the matchmaker, or reject with its first error
  function opened(p, ms = 12000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Couldn't reach the matchmaker. Check your Wi-Fi.")), ms);
      p.once('open', () => { clearTimeout(t); resolve(); });
      p.once('error', e => { clearTimeout(t); reject(e); });
    });
  }
  function wire(conn, id) {
    conn.on('data', data => handler({ type: 'data', id, data }));
    const gone = () => { if (role === 'host') { if (!conns.has(id)) return; conns.delete(id); } else hostConn = null; handler({ type: 'leave', id }); };
    conn.on('close', gone); conn.on('error', gone);
  }

  // host a room: retries a few codes in case one is taken; resolves with the code
  async function host(onEvent, makeCode) {
    close(); const my = gen;
    await loadLib(); cancelled(my);
    handler = onEvent; role = 'host';
    for (let tries = 0; tries < 5; tries++) {
      const code = makeCode(), p = new window.Peer(PREFIX + code, opts());
      try { await opened(p); }
      catch (e) { p.destroy(); cancelled(my); if (e && e.type === 'unavailable-id') continue; role = null; throw friendly(e); }
      if (my !== gen) { p.destroy(); cancelled(my); }
      peer = p;
      p.on('connection', conn => {
        conn.on('open', () => { conns.set(conn.peer, conn); wire(conn, conn.peer); handler({ type: 'join', id: conn.peer, meta: conn.metadata || {} }); });
      });
      // a dropped link to the matchmaker doesn't hurt open games, but reconnect so new guests can still join
      p.on('disconnected', () => { if (peer === p && !p.destroyed) try { p.reconnect(); } catch (e) {} });
      return code;
    }
    role = null; throw new Error("Couldn't get a room code. Try again.");
  }

  // join a room by code
  async function join(code, meta, onEvent) {
    close(); const my = gen;
    await loadLib(); cancelled(my);
    handler = onEvent; role = 'guest';
    const p = new window.Peer(opts());
    try { await opened(p); } catch (e) { p.destroy(); cancelled(my); role = null; throw friendly(e); }
    if (my !== gen) { p.destroy(); cancelled(my); }
    peer = p;
    const conn = p.connect(PREFIX + code, { serialization: 'json', reliable: true, metadata: meta });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('No answer from that game. Is the code right, and is the host on the same Wi-Fi?')), 12000);
      conn.on('open', () => { clearTimeout(t); resolve(); });
      p.on('error', e => { clearTimeout(t); reject(friendly(e)); });
    }).catch(e => { if (my === gen) close(); throw e; });
    if (my !== gen) { try { conn.close(); p.destroy(); } catch (e) {} cancelled(my); }
    hostConn = conn; wire(conn, 'host');
  }

  function cancelled(my) { if (my !== gen) throw new Error('cancelled'); }
  function friendly(e) {
    const type = e && e.type;
    if (type === 'peer-unavailable') return new Error('No game with that code. Check the letters with the host.');
    if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') return new Error("Couldn't reach the matchmaker. Check your Wi-Fi.");
    if (type === 'browser-incompatible') return new Error("This browser can't do party mode.");
    return e instanceof Error ? e : new Error(String(e && e.message || e));
  }

  // skip a send while a slow link still has a backlog, rather than let snapshots pile up behind each other
  function ok(conn) { const dc = conn && conn.dataChannel; return conn && conn.open && (!dc || dc.bufferedAmount < 256 * 1024); }
  // returns whether it went out
  function send(id, msg, always) { const c = conns.get(id); if (c && (always ? c.open : ok(c))) { c.send(msg); return true; } return false; }
  function broadcast(msg) { for (const c of conns.values()) if (c.open) c.send(msg); }
  function toHost(msg) { if (hostConn && hostConn.open) hostConn.send(msg); }
  function kick(id) { const c = conns.get(id); if (c) { conns.delete(id); try { c.close(); } catch (e) {} } }
  function close() {
    gen++;
    handler = () => {};   // first: closing fires 'close' events, and nobody should hear about leaving their own room
    for (const c of conns.values()) try { c.close(); } catch (e) {}
    conns.clear();
    if (hostConn) try { hostConn.close(); } catch (e) {}
    hostConn = null;
    if (peer) try { peer.destroy(); } catch (e) {}
    peer = null; role = null;
  }

  window.Net = {
    host, join, send, broadcast, toHost, kick, close,
    get role() { return role; },
    get guests() { return [...conns.keys()]; },
  };
})();
