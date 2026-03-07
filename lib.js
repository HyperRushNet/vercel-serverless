// HRNChat.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

export class HRNChat extends EventTarget {
    constructor(customConfig = {}) {
        super();

        // --- Configuration ---
        this.CONFIG = {
            supabaseUrl: customConfig.supabaseUrl || "https://jnhsuniduzvhkpexorqk.supabase.co",
            supabaseKey: customConfig.supabaseKey || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpuaHN1bmlkdXp2aGtwZXhvcnFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjAxMDYsImV4cCI6MjA4NzEzNjEwNn0.9I5bbqskCgksUaNWYlFFo0-6Odht28pOMdxTGZECahY",
            mailApi: customConfig.mailApi || "https://vercel-serverless-hrn.vercel.app/api/mailAPI",
            maxUsers: customConfig.maxUsers || 150,
            maxMessages: customConfig.maxMessages || 50,
            historyLoadLimit: customConfig.historyLoadLimit || 20,
            rateLimitMs: customConfig.rateLimitMs || 1000,
            verificationCodeExpiry: customConfig.verificationCodeExpiry || 600,
            maxMessageLength: customConfig.maxMessageLength || 5000,
            requestTimeout: customConfig.requestTimeout || 3000,
            backgroundDisconnectMs: customConfig.backgroundDisconnectMs || 5000
        };

        this.DB_NAME = 'HRN_LOCAL_DB_7';
        this.DB_VERSION = 1;
        this.MAX_CACHE_SIZE = 100;

        // --- State ---
        this.state = {
            user: null,
            currentRoomId: null,
            currentRoomData: null,
            chatChannel: null,
            presenceChannel: null,
            globalPresenceChannel: null,
            allRooms: [],
            vTimer: null,
            globalOnlineCount: 0,
            sessionStartTime: null,
            isPresenceSubscribed: false,
            processingAction: false,
            isLoadingHistory: false,
            oldestMessageTimestamp: null,
            hasMoreHistory: true,
            lastMessageTime: 0,
            isChatChannelReady: false,
            lastLobbyRefresh: 0,
            profileCache: {},
            profileCacheKeys: [],
            isOfflineMode: false,
            isCapacityBlocked: false,
            authListener: null,
            internetCheckInterval: null,
            backgroundDisconnectTimer: null,
            isBackgroundDisconnectActive: false,
            isHardReconnecting: false,
            isConnecting: false,
            connectionStrength: '4g',
            globalPresenceReady: false,
            connectionTimeoutTimer: null,
            pendingRoomEntry: null,
            cryptoWorker: null,
            pendingResolvers: {},
            selectedAllowedUsers: [] // Internal state for creating/editing rooms
        };

        this.db = createClient(this.CONFIG.supabaseUrl, this.CONFIG.supabaseKey, {
            auth: { persistSession: false, autoRefreshToken: true },
            realtime: { params: { eventsPerSecond: 10 } }
        });

        this.localDB = this._initLocalDB();
        this._initWorker();
    }

    // --- Utility ---
    _dispatch(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }
    _esc(t) { const p = document.createElement('p'); p.textContent = t; return p.innerHTML; }
    _getTimeFromDate(d) { return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
    
    _fetchWithTimeout(promise, ms = this.CONFIG.requestTimeout) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ms);
        return promise.then(res => { clearTimeout(timeout); return res; }).catch(err => { clearTimeout(timeout); throw err; });
    }

    _execQuery(queryPromise) {
        return Promise.race([
            queryPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Request Timeout")), this.CONFIG.requestTimeout))
        ]);
    }

    _safeAwait(promise) { return promise.then(data => [data, null]).catch(error => [null, error]); }

    // --- Local DB (IndexedDB) ---
    _initLocalDB() {
        const ctx = this;
        return {
            db: null,
            init: () => {
                return new Promise((resolve, reject) => {
                    const request = indexedDB.open(ctx.DB_NAME, ctx.DB_VERSION);
                    request.onerror = (e) => reject(request.error);
                    request.onsuccess = () => { ctx.localDB.db = request.result; resolve(); };
                    request.onupgradeneeded = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains('rooms')) db.createObjectStore('rooms', { keyPath: 'id' });
                        if (!db.objectStoreNames.contains('messages')) {
                            const ms = db.createObjectStore('messages', { keyPath: 'id' });
                            ms.createIndex('room_id', 'room_id', { unique: false });
                        }
                        if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath: 'id' });
                        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'room_id' });
                        if (!db.objectStoreNames.contains('known_users')) db.createObjectStore('known_users', { keyPath: 'id' });
                        if (!db.objectStoreNames.contains('user_tree')) db.createObjectStore('user_tree', { keyPath: 'user_id' });
                    };
                });
            },
            get: (store, key) => {
                return new Promise((res, rej) => {
                    if (!ctx.localDB.db) return rej("DB not init");
                    const tx = ctx.localDB.db.transaction(store, 'readonly');
                    const req = tx.objectStore(store).get(key);
                    req.onsuccess = () => res(req.result);
                    req.onerror = () => rej(req.error);
                });
            },
            getAll: (store) => {
                return new Promise((res, rej) => {
                    if (!ctx.localDB.db) return res([]);
                    const tx = ctx.localDB.db.transaction(store, 'readonly');
                    const req = tx.objectStore(store).getAll();
                    req.onsuccess = () => res(req.result || []);
                    req.onerror = () => rej(req.error);
                });
            },
            put: (store, val) => {
                if (!val || !val.id) return;
                return new Promise((res, rej) => {
                    if (!ctx.localDB.db) return rej("DB not init");
                    const tx = ctx.localDB.db.transaction(store, 'readwrite');
                    tx.objectStore(store).put(val);
                    tx.oncomplete = () => res();
                    tx.onerror = () => rej(tx.error);
                });
            },
            putAll: (store, vals) => {
                if (!vals || vals.length === 0) return;
                return new Promise((res, rej) => {
                    if (!ctx.localDB.db) return rej("DB not init");
                    const tx = ctx.localDB.db.transaction(store, 'readwrite');
                    const os = tx.objectStore(store);
                    vals.forEach(v => { if (v && v.id) os.put(v); });
                    tx.oncomplete = () => res();
                    tx.onerror = () => rej(tx.error);
                });
            },
            clear: (store) => {
                return new Promise((res, rej) => {
                    if (!ctx.localDB.db) return res();
                    const tx = ctx.localDB.db.transaction(store, 'readwrite');
                    tx.objectStore(store).clear();
                    tx.oncomplete = () => res();
                    tx.onerror = () => rej(tx.error);
                });
            },
            delete: (store, key) => {
                return new Promise((res, rej) => {
                    if (!ctx.localDB.db) return res();
                    const tx = ctx.localDB.db.transaction(store, 'readwrite');
                    tx.objectStore(store).delete(key);
                    tx.oncomplete = () => res();
                    tx.onerror = () => rej(tx.error);
                });
            },
            getRoomMessages: async (roomId) => {
                const all = await ctx.localDB.getAll('messages');
                return all.filter(m => m.room_id === roomId).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            },
            clearRoomMessages: (roomId) => {
                return new Promise((resolve, reject) => {
                    if (!ctx.localDB.db) return reject();
                    const tx = ctx.localDB.db.transaction('messages', 'readwrite');
                    const store = tx.objectStore('messages');
                    const index = store.index('room_id');
                    const req = index.openCursor(IDBKeyRange.only(roomId));
                    req.onsuccess = (e) => { const cursor = e.target.result; if (cursor) { cursor.delete(); cursor.continue(); } };
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });
            },
            saveUserTree: (userId, rooms) => {
                return ctx.localDB.put('user_tree', { user_id: userId, room_ids: rooms.map(r => r.id), timestamp: Date.now() });
            },
            getUserTree: (userId) => ctx.localDB.get('user_tree', userId)
        };
    }

    // --- Crypto Worker ---
    _initWorker() {
        const workerCode = `
            self.onmessage = async (e) => { 
                const { id, type, payload } = e.data; 
                const encoder = new TextEncoder(); 
                const decoder = new TextDecoder(); 
                self.keys = self.keys || {};
                try { 
                    if (type === 'deriveKey') { 
                        const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(payload.password), { name: 'PBKDF2' }, false, ['deriveKey']); 
                        const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: encoder.encode(payload.salt), iterations: 300000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); 
                        self.keys[payload.keyId] = key; 
                        self.postMessage({ id, type: 'keyDerived', success: true }); 
                    } else if (type === 'encrypt') { 
                        if (!self.keys[payload.keyId]) throw new Error("Key not derived"); 
                        const iv = crypto.getRandomValues(new Uint8Array(12)); 
                        const encoded = encoder.encode(payload.text); 
                        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, self.keys[payload.keyId], encoded); 
                        const combined = new Uint8Array(iv.length + ciphertext.byteLength); 
                        combined.set(iv, 0); combined.set(new Uint8Array(ciphertext), iv.length); 
                        const base64 = btoa(String.fromCharCode(...combined)); 
                        self.postMessage({ id, type: 'encrypted', result: base64 }); 
                    } else if (type === 'decryptHistory') { 
                        if (!self.keys[payload.keyId]) throw new Error("Key not derived"); 
                        const results = []; 
                        for (const m of payload.messages) { 
                            try { 
                                if (m.content === '/') { results.push({ id: m.id, deleted: true, user_id: m.user_id, user_name: m.user_name, created_at: m.created_at, updated_at: m.updated_at }); continue; } 
                                const binary = atob(m.content); 
                                const bytes = new Uint8Array(binary.length); 
                                for(let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i); 
                                const iv = bytes.slice(0, 12); 
                                const ciphertext = bytes.slice(12); 
                                const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, self.keys[payload.keyId], ciphertext); 
                                const text = decoder.decode(decrypted); 
                                const parts = text.split('|'); 
                                results.push({ id: m.id, time: parts[0], text: parts.slice(1).join('|'), user_id: m.user_id, user_name: m.user_name, created_at: m.created_at, updated_at: m.updated_at }); 
                            } catch (err) { results.push({ id: m.id, error: true }); } 
                        } 
                        self.postMessage({ id, type: 'historyDecrypted', results }); 
                    } else if (type === 'decryptSingle') { 
                        if (!self.keys[payload.keyId]) throw new Error("Key not derived"); 
                        if (payload.content === '/') { self.postMessage({ id, type: 'singleDecrypted', result: { deleted: true } }); return; } 
                        try { 
                            const binary = atob(payload.content); 
                            const bytes = new Uint8Array(binary.length); 
                            for(let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i); 
                            const iv = bytes.slice(0, 12); 
                            const ciphertext = bytes.slice(12); 
                            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, self.keys[payload.keyId], ciphertext); 
                            const text = decoder.decode(decrypted); 
                            const parts = text.split('|'); 
                            self.postMessage({ id, type: 'singleDecrypted', result: { time: parts[0], text: parts.slice(1).join('|') } }); 
                        } catch(e) { self.postMessage({ id, type: 'singleDecrypted', error: e.message }); } 
                    } 
                } catch (error) { self.postMessage({ id, type: 'error', message: error.message }); } 
            };
        `;
        const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
        this.state.cryptoWorker = new Worker(URL.createObjectURL(workerBlob));
        this.state.cryptoWorker.onmessage = (e) => {
            const { id, type, result, error, results, success } = e.data;
            const key = id || type;
            if (this.state.pendingResolvers[key]) {
                if (error || results?.error) this.state.pendingResolvers[key].reject(error || "Decryption failed");
                else if (type === 'keyDerived') this.state.pendingResolvers[key].resolve(success);
                else this.state.pendingResolvers[key].resolve({ type, result, results });
                delete this.state.pendingResolvers[key];
            }
        };
    }

    _workerExec(type, payload) {
        return new Promise((resolve, reject) => {
            const id = crypto.randomUUID();
            this.state.pendingResolvers[id] = { resolve, reject };
            this.state.cryptoWorker.postMessage({ id, type, payload });
        });
    }

    _generateSalt() { const arr = new Uint8Array(16); crypto.getRandomValues(arr); return Array.from(arr, b => b.toString(16).padStart(2, '0')).join(''); }
    async _sha256(text) { const buffer = new TextEncoder().encode(text); const hashBuffer = await crypto.subtle.digest('SHA-256', buffer); const hashArray = Array.from(new Uint8Array(hashBuffer)); return hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); }
    _deriveKey(pass, salt, keyId) { return this._workerExec('deriveKey', { password: pass, salt: salt, keyId: keyId }); }
    async _encryptMessage(text, keyId) {
        const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const res = await this._workerExec('encrypt', { text: time + "|" + text, keyId: keyId });
        return res.result;
    }

    // --- Internal Connection Logic ---
    _getConnectionTimeout() {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        const type = connection?.effectiveType;
        if (type === '4g') return 5000; if (type === '3g') return 10000; if (type === '2g') return 20000; if (type === 'slow-2g') return 30000;
        return 8000;
    }

    async _handleServerFull() {
        if (this.state.isCapacityBlocked) return;
        this.state.isCapacityBlocked = true;
        await this._fullDisconnect();
        this._dispatch('server_full');
    }

    async _cleanupChannels(keepGlobal = false) {
        if (this.state.connectionTimeoutTimer) clearTimeout(this.state.connectionTimeoutTimer);
        this.state.connectionTimeoutTimer = null;
        if (this.state.reconnectTimer) clearTimeout(this.state.reconnectTimer);
        this.state.reconnectTimer = null;
        
        if (this.state.presenceChannel) { try { this.state.presenceChannel.unsubscribe(); } catch (e) {} this.state.presenceChannel = null; this.state.isPresenceSubscribed = false; }
        if (this.state.chatChannel) { try { this.state.chatChannel.unsubscribe(); } catch (e) {} this.state.chatChannel = null; }
        if (!keepGlobal && this.state.globalPresenceChannel) { try { this.state.globalPresenceChannel.unsubscribe(); } catch (e) {} this.state.globalPresenceChannel = null; this.state.globalPresenceReady = false; }
        this.state.isChatChannelReady = false;
        this._dispatch('channel_ready', { ready: false });
    }

    async _fullDisconnect() { await this._cleanupChannels(false); }

    async _trackPresence(channel, userId) { if (!channel || !userId) return; try { await channel.track({ user_id: userId, online_at: new Date().toISOString() }); } catch (e) {} }

    _queryOnlineCountImmediately() {
        if (!this.state.presenceChannel) return;
        const presState = this.state.presenceChannel.presenceState();
        const uniqueUserIds = new Set(Object.values(presState).flat().map(p => p.user_id));
        this._dispatch('room_presence', { count: uniqueUserIds.size });
    }

    async _setupGlobalPresence(userId) {
        if (this.state.isOfflineMode || this.state.isCapacityBlocked) return;
        if (this.state.globalPresenceChannel) { try { this.state.globalPresenceChannel.unsubscribe(); } catch(e) {} this.state.globalPresenceChannel = null; }
        
        this.state.globalPresenceChannel = this.db.channel('global-presence', { config: { presence: { key: userId || `listener_${Date.now()}` } } });
        this.state.globalPresenceChannel.on('presence', { event: 'sync' }, async () => {
            if (!this.state.globalPresenceChannel) return;
            const presState = this.state.globalPresenceChannel.presenceState();
            const uniqueUserIds = new Set();
            Object.values(presState).flat().forEach(p => uniqueUserIds.add(p.user_id));
            this.state.globalOnlineCount = uniqueUserIds.size;
            this.state.globalPresenceReady = true;
            this._dispatch('global_presence', { count: this.state.globalOnlineCount });
            if (this.state.user && !this.state.isOfflineMode && !this.state.isCapacityBlocked && this.state.globalOnlineCount > this.CONFIG.maxUsers) {
                if (!uniqueUserIds.has(this.state.user.id)) this._handleServerFull();
            }
        }).subscribe(async (status) => { if (status === 'SUBSCRIBED' && userId) await this._trackPresence(this.state.globalPresenceChannel, userId); });
    }

    async _hardRefreshRoomMessages(roomId) {
        if (!roomId || !this.state.currentRoomData) return;
        let messages = [];
        try {
            const { data, error } = await this._execQuery(this.db.from('messages').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(this.CONFIG.maxMessages));
            if (error) throw error;
            if (data) {
                data.reverse();
                const res = await this._workerExec('decryptHistory', { messages: data, keyId: roomId });
                messages = res.results.filter(m => !m.error);
                await this.localDB.clearRoomMessages(roomId);
                await this.localDB.putAll('messages', messages.map(m => ({ ...m, room_id: roomId })));
            }
        } catch (e) { return []; }
        this.state.oldestMessageTimestamp = messages.length > 0 ? messages[0].created_at : null;
        this._dispatch('messages_loaded', { messages, reset: true });
        return messages;
    }

    _attemptHardReconnect() {
        if (!this.state.currentRoomId || document.hidden || !this.state.user || this.state.isOfflineMode || this.state.isCapacityBlocked) return;
        if (this.state.isHardReconnecting || this.state.isConnecting) return;
        this.state.isHardReconnecting = true;

        if (this.state.connectionTimeoutTimer) clearTimeout(this.state.connectionTimeoutTimer);
        if (this.state.reconnectTimer) clearTimeout(this.state.reconnectTimer);
        this.state.reconnectTimer = null;
        
        this._cleanupChannels(true);
        this._dispatch('connection_status', { status: 'connecting' });
        
        const timeout = this._getConnectionTimeout();
        this.state.connectionTimeoutTimer = setTimeout(() => { this.state.isHardReconnecting = false; this._attemptHardReconnect(); }, timeout);
        
        try { if (this.db.realtime && typeof this.db.realtime.connect === 'function') this.db.realtime.connect(); } catch (e) {}
        this._initRoomPresence(this.state.currentRoomId);
        this._setupChatChannel(this.state.currentRoomId);
    }

    async _setupChatChannel(id) {
        if (this.state.isOfflineMode) return;
        if (this.state.chatChannel) this.state.chatChannel.unsubscribe();
        this.state.chatChannel = this.db.channel(`room_chat_${id}`, { config: { broadcast: { self: true } } });
        
        this.state.chatChannel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${id}` }, async (payload) => {
            const m = payload.new;
            if (m && this.state.currentRoomId) {
                try {
                    const decRes = await this._workerExec('decryptSingle', { content: m.content, keyId: id });
                    if (decRes.result) {
                        const msgObj = { ...m, ...decRes.result, room_id: m.room_id };
                        await this.localDB.put('messages', msgObj);
                        this._dispatch('message_received', { message: msgObj });
                    }
                } catch (e) {}
            }
        }).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${id}` }, async (payload) => {
            const m = payload.new;
            try {
                const decRes = await this._workerExec('decryptSingle', { content: m.content, keyId: id });
                const deleted = m.content === '/';
                const msgObj = { ...m, ...decRes.result, room_id: m.room_id, deleted, updated_at: m.updated_at };
                const cached = await this.localDB.get('messages', m.id);
                if (cached) { cached.deleted = deleted; cached.text = decRes.result?.text; await this.localDB.put('messages', cached); }
                this._dispatch('message_updated', { message: msgObj });
            } catch (e) {}
        }).subscribe((status) => {
            const wasReady = this.state.isChatChannelReady;
            this.state.isChatChannelReady = (status === 'SUBSCRIBED');
            if (status === 'SUBSCRIBED') {
                if (this.state.connectionTimeoutTimer) clearTimeout(this.state.connectionTimeoutTimer);
                this.state.connectionTimeoutTimer = null; this.state.isHardReconnecting = false;
                if (this.state.reconnectTimer) clearTimeout(this.state.reconnectTimer);
                this._dispatch('connection_status', { status: 'connected' });
                this._hardRefreshRoomMessages(id);
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                if (this.state.connectionTimeoutTimer) clearTimeout(this.state.connectionTimeoutTimer);
                this.state.connectionTimeoutTimer = null;
                if (!this.state.isOfflineMode && !this.state.isCapacityBlocked && !this.state.isBackgroundDisconnectActive && !document.hidden && this.state.currentRoomId) {
                    this.state.isChatChannelReady = false;
                    if (!this.state.isHardReconnecting) { this.state.isHardReconnecting = true; this._dispatch('connection_status', { status: 'connecting' }); this.state.reconnectTimer = setTimeout(() => this._attemptHardReconnect(), 2000); }
                }
            }
            if (wasReady !== this.state.isChatChannelReady) this._dispatch('channel_ready', { ready: this.state.isChatChannelReady });
        });
    }

    async _initRoomPresence(roomId) {
        if (!this.state.user || this.state.isOfflineMode) return;
        if (this.state.presenceChannel) this.state.presenceChannel.unsubscribe();
        const myId = this.state.user.id;
        this.state.presenceChannel = this.db.channel(`room_presence:${roomId}`, { config: { presence: { key: myId } } });
        this.state.presenceChannel.on('presence', { event: 'sync' }, () => { if (!this.state.presenceChannel) return; this._queryOnlineCountImmediately(); })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') { if (!this.state.presenceChannel) return; this.state.isPresenceSubscribed = true; this.state.isHardReconnecting = false; this._queryOnlineCountImmediately(); await this._trackPresence(this.state.presenceChannel, myId); this._queryOnlineCountImmediately(); }
            else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                this.state.isPresenceSubscribed = false;
                if (!this.state.isOfflineMode && !this.state.isCapacityBlocked && !this.state.isBackgroundDisconnectActive && !document.hidden && this.state.currentRoomId) {
                    this.state.isHardReconnecting = true; this._dispatch('connection_status', { status: 'connecting' }); this.state.reconnectTimer = setTimeout(() => this._attemptHardReconnect(), 2000);
                }
            }
        });
    }

    _startInternetCheck() {
        if (this.state.internetCheckInterval) return;
        this.state.internetCheckInterval = setInterval(async () => {
            try { const response = await fetch('./assets/internet-test-file.txt', { cache: 'no-store', headers: { 'Pragma': 'no-cache' } }); if (response.ok) { this._stopInternetCheck(); if (this.state.isOfflineMode) this.goOnline(); } } catch (e) {}
        }, 5000);
    }

    _stopInternetCheck() { if (this.state.internetCheckInterval) { clearInterval(this.state.internetCheckInterval); this.state.internetCheckInterval = null; } }

    _monitorConnection() {
        const onlineHandler = () => { this._stopInternetCheck(); if (this.state.isOfflineMode) this.goOnline(); else { this._dispatch('connection_status', { status: 'connecting' }); try { if (this.db.realtime && typeof this.db.realtime.connect === 'function') this.db.realtime.connect(); } catch (e) {} if (this.state.currentRoomId) this._attemptHardReconnect(); else this._dispatch('connection_status', { status: 'connected' }); } };
        const offlineHandler = async () => { this.setAppMode(true); if (this.state.connectionTimeoutTimer) clearTimeout(this.state.connectionTimeoutTimer); if (this.state.reconnectTimer) clearTimeout(this.state.reconnectTimer); this.state.isHardReconnecting = false; this.state.isConnecting = false; this.state.globalPresenceReady = false; this._cleanupChannels(false); this._startInternetCheck(); };
        window.addEventListener('online', onlineHandler);
        window.addEventListener('offline', offlineHandler);
        document.addEventListener('visibilitychange', async () => {
            if (this.state.isCapacityBlocked) return;
            if (document.visibilityState === 'hidden') {
                if(this.state.reconnectTimer) clearTimeout(this.state.reconnectTimer); this.state.reconnectTimer = null;
                if (this.state.backgroundDisconnectTimer) clearTimeout(this.state.backgroundDisconnectTimer);
                this.state.backgroundDisconnectTimer = setTimeout(async () => { if (!this.state.isOfflineMode && !this.state.isCapacityBlocked) { await this._fullDisconnect(); this.state.isBackgroundDisconnectActive = true; } }, this.CONFIG.backgroundDisconnectMs);
            } else if (document.visibilityState === 'visible') {
                if (this.state.backgroundDisconnectTimer) clearTimeout(this.state.backgroundDisconnectTimer); this.state.backgroundDisconnectTimer = null;
                if (this.state.isBackgroundDisconnectActive) { this.state.isBackgroundDisconnectActive = false; if (this.state.user && !this.state.isOfflineMode) { try { if (this.db.realtime && typeof this.db.realtime.connect === 'function') this.db.realtime.connect(); } catch (e) {} this._setupGlobalPresence(this.state.user.id); if (this.state.currentRoomId) this._attemptHardReconnect(); } }
                else if (!this.state.isChatChannelReady && this.state.currentRoomId) { this._attemptHardReconnect(); }
                else if (navigator.onLine && !this.state.globalPresenceReady) { this.goOnline(); }
                if (this.state.presenceChannel && this.state.user) await this._trackPresence(this.state.presenceChannel, this.state.user.id);
                if (this.state.globalPresenceChannel && this.state.user) await this._trackPresence(this.state.globalPresenceChannel, this.state.user.id);
            }
        });
        window.addEventListener('beforeunload', async () => { await this._fullDisconnect(); });
    }

    // --- Data Helpers ---
    async _resolveRoomDisplay(room) {
        if (!room) return { name: 'Chat', avatar: null, isDirect: false };
        if (!room.is_direct) return { name: room.name, avatar: room.avatar_url || null, isDirect: false };
        const myId = this.state.user?.id;
        if (!myId || !room.allowed_users || room.allowed_users.length === 0) return { name: 'Direct Message', avatar: null, isDirect: true };
        const otherId = room.allowed_users.find(id => id !== myId && id !== '*');
        if (!otherId) return { name: 'Direct Message', avatar: null, isDirect: true };
        const profile = await this.getProfile(otherId);
        if (!profile) return { name: 'Unknown User', avatar: null, isDirect: true };
        return { name: profile.full_name || 'User', avatar: profile.avatar_url || null, isDirect: true };
    }

    async _cacheAvatar(profile) {
        if (!profile) return profile;
        await this.localDB.put('profiles', profile);
        if (!this.state.profileCache[profile.id]) { this.state.profileCacheKeys.push(profile.id); }
        this.state.profileCache[profile.id] = profile;
        if (this.state.profileCacheKeys.length > this.MAX_CACHE_SIZE) { const oldKey = this.state.profileCacheKeys.shift(); delete this.state.profileCache[oldKey]; }
        return profile;
    }

    // --- PUBLIC API ---

    async init() {
        await this.localDB.init();
        this._monitorConnection();
        this._dispatch('initialized');
        const storedEmail = localStorage.getItem('hrn_auth_email');
        const storedPass = localStorage.getItem('hrn_auth_pass');
        if (navigator.onLine) {
            this.setAppMode(false); this._setupGlobalPresence(null);
            if (storedEmail && storedPass) {
                this._dispatch('loading', { active: true, text: "Auto-logging in..." });
                const success = await this._attemptLogin(storedEmail, storedPass);
                this._dispatch('loading', { active: false });
                if (success) { this._setupGlobalPresence(this.state.user.id); this._dispatch('auth_state_changed', { user: this.state.user, state: 'logged_in' }); this.loadRooms(); }
                else {
                    const knownUser = await this.localDB.get('known_users', storedEmail);
                    const hashInput = await this._sha256(storedPass + storedEmail);
                    if (knownUser && knownUser.pass_hash === hashInput) { this.state.user = { id: knownUser.userId, email: knownUser.email, user_metadata: knownUser.metadata }; this.setAppMode(true); this._dispatch('auth_state_changed', { user: this.state.user, state: 'offline_mode' }); this.loadRooms(); }
                    else { localStorage.removeItem('hrn_auth_email'); localStorage.removeItem('hrn_auth_pass'); this._dispatch('auth_state_changed', { user: null, state: 'logged_out' }); }
                }
            } else { this._dispatch('auth_state_changed', { user: null, state: 'logged_out' }); }
        } else {
            this.setAppMode(true); this._startInternetCheck();
            if (storedEmail && storedPass) {
                const knownUser = await this.localDB.get('known_users', storedEmail);
                const hashInput = await this._sha256(storedPass + storedEmail);
                if (knownUser && knownUser.pass_hash === hashInput) { this.state.user = { id: knownUser.userId, email: knownUser.email, user_metadata: knownUser.metadata }; this._dispatch('auth_state_changed', { user: this.state.user, state: 'offline_mode' }); this.loadRooms(); }
                else { this._dispatch('auth_state_changed', { user: null, state: 'logged_out' }); this._dispatch('offline_credentials', { email: storedEmail, pass: storedPass }); }
            } else { this._dispatch('auth_state_changed', { user: null, state: 'logged_out' }); }
        }
    }

    setAppMode(offline) { this.state.isOfflineMode = offline; this._dispatch('mode_changed', { offline }); if(offline) this._dispatch('connection_status', { status: 'offline' }); }

    async goOnline() {
        if (this.state.isConnecting || this.state.isHardReconnecting) return;
        this.state.isConnecting = true; this._stopInternetCheck(); this.state.isCapacityBlocked = false; this._dispatch('server_full', { full: false });
        try { if (this.db.realtime && typeof this.db.realtime.connect === 'function') this.db.realtime.connect(); } catch (e) {}
        if (this.state.user) {
            const storedEmail = localStorage.getItem('hrn_auth_email'); const storedPass = localStorage.getItem('hrn_auth_pass');
            if (storedEmail && storedPass) {
                const success = await this._attemptLogin(storedEmail, storedPass);
                if (success) { this.setAppMode(false); this._setupGlobalPresence(this.state.user.id); this.state.isConnecting = false; if (this.state.currentRoomId) this._attemptHardReconnect(); this.loadRooms(); this._dispatch('notification', { message: "Connected." }); }
                else { this.setAppMode(true); this.state.isConnecting = false; this._dispatch('notification', { message: "Connection failed." }); }
            } else { this.setAppMode(true); this.state.isConnecting = false; }
            return;
        }
        const storedEmail = localStorage.getItem('hrn_auth_email'); const storedPass = localStorage.getItem('hrn_auth_pass');
        if (storedEmail && storedPass) {
            this._dispatch('loading', { active: true, text: "Connecting..." });
            const success = await this._attemptLogin(storedEmail, storedPass);
            if (success) { this.setAppMode(false); this._setupGlobalPresence(this.state.user.id); this.state.isConnecting = false; this._dispatch('auth_state_changed', { user: this.state.user, state: 'logged_in' }); this.loadRooms(); }
            else { this._dispatch('notification', { message: "Connection failed." }); this.state.isConnecting = false; }
            this._dispatch('loading', { active: false });
        } else { this.setAppMode(true); this.state.isConnecting = false; }
    }

    stayOffline() { this._dispatch('server_full', { full: false }); this._fullDisconnect(); this.setAppMode(true); this._dispatch('notification', { message: "Offline mode active." }); if (this.state.user) this.loadRooms(); }

    async _attemptLogin(email, pass) {
        try { const { error } = await this._execQuery(this.db.auth.signInWithPassword({ email, password: pass })); if (error) throw error; } catch (e) { return false; }
        const { data: { user } } = await this.db.auth.getUser();
        this.state.user = user;
        if (user) { const profileData = { id: user.id, full_name: user.user_metadata?.full_name, avatar_url: user.user_metadata?.avatar_url, updated_at: new Date().toISOString() }; await this._cacheAvatar(profileData); }
        const hashInput = await this._sha256(pass + email);
        await this.localDB.put('known_users', { id: email, pass_hash: hashInput, email: email, metadata: user.user_metadata, userId: user.id });
        return true;
    }

    async login(email, pass) {
        if (this.state.processingAction) return; this.state.processingAction = true;
        if (!email || !pass) { this._dispatch('notification', { message: "Missing fields." }); this.state.processingAction = false; return; }
        this._dispatch('loading', { active: true, text: "Signing In..." });
        if (!navigator.onLine) {
            const knownUser = await this.localDB.get('known_users', email);
            if (knownUser && knownUser.metadata) { const hashInput = await this._sha256(pass + email); if (knownUser.pass_hash && knownUser.pass_hash === hashInput) { this.state.user = { id: knownUser.userId, email: knownUser.email, user_metadata: knownUser.metadata }; this.setAppMode(true); this._dispatch('auth_state_changed', { user: this.state.user, state: 'offline_mode' }); this.loadRooms(); this._dispatch('loading', { active: false }); this.state.processingAction = false; this._dispatch('notification', { message: "Offline login successful." }); return; } }
            this._dispatch('notification', { message: "No internet and no offline account found." }); this._dispatch('loading', { active: false }); this.state.processingAction = false; return;
        }
        const success = await this._attemptLogin(email, pass);
        if (success) { localStorage.setItem('hrn_auth_email', email); localStorage.setItem('hrn_auth_pass', pass); this.setAppMode(false); if (this.state.user) this._setupGlobalPresence(this.state.user.id); this._dispatch('auth_state_changed', { user: this.state.user, state: 'logged_in' }); this.loadRooms(); this._dispatch('notification', { message: "Connected." }); }
        else { this._dispatch('notification', { message: "Invalid credentials!" }); }
        this._dispatch('loading', { active: false }); this.state.processingAction = false;
    }

    async register(stepData) {
        if (this.state.processingAction) return; this.state.processingAction = true;
        const { name, email, pass, avatarUrl } = stepData;
        if (!name || !email || pass.length < 8) { this._dispatch('notification', { message: "Invalid input." }); this.state.processingAction = false; return; }
        if (!navigator.onLine) { this._dispatch('notification', { message: "Internet connection required." }); this.state.processingAction = false; return; }
        this._dispatch('loading', { active: true, text: "Sending Code..." });
        try {
            const [r, err] = await this._safeAwait(fetch(this.CONFIG.mailApi, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send", email: email }) }));
            if (err) throw err;
            if (r) {
                if (r.status === 429) { this._dispatch('notification', { message: "Too many attempts." }); this.state.processingAction = false; this._dispatch('loading', { active: false }); return; }
                const j = await r.json();
                if (j.message === "Code sent") { sessionStorage.setItem('temp_reg', JSON.stringify({ name, email, pass, avatar: avatarUrl })); this._dispatch('registration_code_sent', { email }); }
                else { this._dispatch('notification', { message: "Could not send code." }); }
            }
        } catch (err) { this._dispatch('notification', { message: "Network error." }); }
        this._dispatch('loading', { active: false }); this.state.processingAction = false;
    }

    async verifyCode(code) {
        if (this.state.processingAction) return; this.state.processingAction = true;
        const temp = JSON.parse(sessionStorage.getItem('temp_reg'));
        if (!temp) { this._dispatch('notification', { message: "Session expired." }); this.state.processingAction = false; return; }
        this._dispatch('loading', { active: true, text: "Verifying..." });
        try {
            const r = await fetch(this.CONFIG.mailApi, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify", email: temp.email, code: code }) });
            if (r.status === 429) { this._dispatch('notification', { message: "Too many attempts." }); this.state.processingAction = false; this._dispatch('loading', { active: false }); return; }
            const j = await r.json();
            if (j.message === "Verified") await this._finishReg(temp); else { this._dispatch('notification', { message: "Invalid code." }); }
        } catch (err) { this._dispatch('notification', { message: "Verification failed." }); }
        this._dispatch('loading', { active: false }); this.state.processingAction = false;
    }

    async _finishReg(temp) {
        const { error } = await this.db.auth.signUp({ email: temp.email, password: temp.pass, options: { data: { full_name: temp.name, avatar_url: temp.avatar } } });
        if (error) { this._dispatch('notification', { message: "Registration failed." }); }
        else { localStorage.setItem('hrn_auth_email', temp.email); localStorage.setItem('hrn_auth_pass', temp.pass); this._dispatch('registration_success'); }
    }

    async logout() {
        this._dispatch('loading', { active: true, text: "Leaving..." }); this.state.currentRoomId = null; this.state.user = null; await this._fullDisconnect();
        localStorage.removeItem('hrn_auth_email'); localStorage.removeItem('hrn_auth_pass'); this.setAppMode(false); this.state.isCapacityBlocked = false; await this.db.auth.signOut();
        if (this.state.authListener) { this.state.authListener.unsubscribe(); this.state.authListener = null; }
        this._dispatch('auth_state_changed', { user: null, state: 'logged_out' }); this._dispatch('loading', { active: false });
    }

    async getProfile(userId) {
        if (!userId) return null;
        if (this.state.profileCache[userId]) return this.state.profileCache[userId];
        let profile = await this.localDB.get('profiles', userId);
        if (!this.state.isOfflineMode) {
            try {
                const { data: serverProfile, error } = await this.db.from('profiles').select('id, full_name, avatar_url, updated_at').eq('id', userId).single();
                if (serverProfile) { const localTime = profile?.updated_at ? new Date(profile.updated_at).getTime() : 0; const serverTime = serverProfile.updated_at ? new Date(serverProfile.updated_at).getTime() : 0; if (!profile || serverTime > localTime || !profile.full_name) { profile = serverProfile; await this._cacheAvatar(profile); } }
            } catch (e) { console.warn("Profile fetch failed", e); }
        }
        if (profile) this.state.profileCache[userId] = profile;
        return profile;
    }

    async loadRooms() {
        if (!this.state.user) return; const uid = this.state.user.id;
        const processAndRender = async (rooms) => { const processed = []; for (const r of rooms) { if (!r || !r.id) continue; const display = await this._resolveRoomDisplay(r); processed.push({ ...r, display_name: display.name, display_avatar: display.avatar, is_direct: display.isDirect }); } this.state.allRooms = processed; this._dispatch('rooms_updated', { rooms: processed }); };
        if (this.state.isOfflineMode) { const localRooms = await this.localDB.getAll('rooms'); await processAndRender(localRooms); return; }
        this._dispatch('loading', { active: true, text: "Syncing..." });
        try { const { data: rooms, error } = await this._execQuery(this.db.from('rooms').select('*').order('created_at', { ascending: false })); if (error) throw error; if (rooms) { await this.localDB.clear('rooms'); if (rooms.length > 0) await this.localDB.putAll('rooms', rooms); await this.localDB.saveUserTree(uid, rooms); await processAndRender(rooms); } } catch (e) { this._dispatch('notification', { message: "Sync failed." }); }
        this._dispatch('loading', { active: false });
    }

    async createRoom(details) {
        if (this.state.processingAction) return; this.state.processingAction = true;
        const { type, name, targetUser, avatar, password, visible, allowedUsers } = details;
        if (type === 'direct') {
            if (!targetUser) { this._dispatch('notification', { message: "User ID required." }); this.state.processingAction = false; return; }
            const { data: profile, error } = await this.db.from('profiles').select('id, full_name, avatar_url, updated_at').eq('id', targetUser).single();
            if (error || !profile) { this._dispatch('notification', { message: "User not found." }); this.state.processingAction = false; return; }
            await this.localDB.put('profiles', profile); this.state.profileCache[profile.id] = profile;
        } else { if (!name) { this._dispatch('notification', { message: "Name required." }); this.state.processingAction = false; this._dispatch('loading', { active: false }); return; } }
        this._dispatch('loading', { active: true, text: "Creating..." }); const roomSalt = this._generateSalt();
        let finalAllowed = allowedUsers || [];
        if (type === 'direct') finalAllowed = [this.state.user.id, targetUser];
        else { if (finalAllowed.length === 0) finalAllowed = ['*']; if (!finalAllowed.includes(this.state.user.id)) finalAllowed.push(this.state.user.id); }
        const insertData = { name: type === 'direct' ? "Direct Message" : name, avatar_url: avatar, has_password: !!password, is_visible: type === 'direct' ? true : visible, salt: roomSalt, created_by: this.state.user.id, allowed_users: finalAllowed, is_direct: type === 'direct' };
        const { data, error } = await this.db.from('rooms').insert([insertData]).select();
        if (error) { this._dispatch('notification', { message: "Creation failed." }); this.state.processingAction = false; this._dispatch('loading', { active: false }); return; }
        if (data && data.length > 0) {
            const newRoom = data[0];
            if (password) { const accessHash = await this._sha256(password + roomSalt); await this.db.rpc('set_room_password', { p_room_id: newRoom.id, p_hash: accessHash }); }
            await this.localDB.put('rooms', newRoom); this._dispatch('room_created', { room: newRoom, password });
        }
        this.state.processingAction = false; this._dispatch('loading', { active: false });
    }

    async joinRoom(id, password = null) {
        const openLocal = async () => { const meta = await this.localDB.get('rooms', id); if (meta && meta.id) { if (meta.has_password && !password) { this.state.pendingRoomEntry = meta; this._dispatch('room_password_required', { room: meta }); return; } await this._openVault(meta.id, meta.name, password, meta.salt, meta); } else this._dispatch('notification', { message: "Chat not found locally." }); };
        if (this.state.isOfflineMode) { await openLocal(); return; }
        this._dispatch('loading', { active: true, text: "Accessing..." });
        try {
            const { data: canAccess, error: rpcError } = await this._execQuery(this.db.rpc('can_access_room', { p_room_id: id })); if (rpcError) throw rpcError; if (!canAccess) throw new Error("Access denied");
            const { data, error } = await this._execQuery(this.db.from('rooms').select('*').eq('id', id).single()); if (error) throw error;
            this._dispatch('loading', { active: false });
            if (data && data.id) await this.localDB.put('rooms', data);
            if (data.has_password && !password) { this.state.pendingRoomEntry = data; this._dispatch('room_password_required', { room: data }); }
            else await this._openVault(data.id, data.name, password, data.salt, data);
        } catch (e) { this._dispatch('loading', { active: false }); this._dispatch('notification', { message: "Connection lost." }); this.setAppMode(true); await openLocal(); }
    }

    async submitGatePassword(password) {
        if (!this.state.pendingRoomEntry) return;
        if (this.state.isOfflineMode) { await this._openVault(this.state.pendingRoomEntry.id, this.state.pendingRoomEntry.name, password, this.state.pendingRoomEntry.salt, this.state.pendingRoomEntry); return; }
        const inputHash = await this._sha256(password + this.state.pendingRoomEntry.salt);
        this._dispatch('loading', { active: true, text: "Verifying..." });
        const { data } = await this.db.rpc('verify_room_password', { p_room_id: this.state.pendingRoomEntry.id, p_hash: inputHash }); this._dispatch('loading', { active: false });
        if (data === true) { await this._openVault(this.state.pendingRoomEntry.id, this.state.pendingRoomEntry.name, password, this.state.pendingRoomEntry.salt, this.state.pendingRoomEntry); this.state.pendingRoomEntry = null; }
        else this._dispatch('notification', { message: "Incorrect password." });
    }

    async _openVault(id, n, rawPassword, roomSalt, roomData) {
        if (!this.state.user) return this._dispatch('notification', { message: "Please log in." });
        if (this.state.isCapacityBlocked) return;
        this._dispatch('loading', { active: true, text: "Opening chat..." });
        await this._cleanupChannels(true);
        if (!this.state.isOfflineMode) { try { if (this.db.realtime && typeof this.db.realtime.connect === 'function') this.db.realtime.connect(); } catch (e) {} }
        this.state.currentRoomId = id; this.state.oldestMessageTimestamp = null; this.state.hasMoreHistory = true; this.state.isLoadingHistory = false;
        if (!roomData) roomData = await this.localDB.get('rooms', id);
        this.state.currentRoomData = roomData;
        const display = await this._resolveRoomDisplay(roomData);
        const keySource = rawPassword ? (rawPassword + id) : id; await this._deriveKey(keySource, roomData?.salt, id);
        let finalMessages = [];
        if (this.state.isOfflineMode) { let localMessages = await this.localDB.getRoomMessages(id); finalMessages = localMessages; this._dispatch('room_entered', { room: roomData, display, messages: finalMessages, isOffline: true }); this._dispatch('loading', { active: false }); return; }
        try {
            const { data } = await this._execQuery(this.db.from('messages').select('*').eq('room_id', id).order('created_at', { ascending: false }).limit(this.CONFIG.maxMessages));
            if (data && data.length > 0) { data.reverse(); const res = await this._workerExec('decryptHistory', { messages: data, keyId: id }); const validMsgs = res.results.filter(m => !m.error); await this.localDB.clearRoomMessages(id); const messagesWithRoomId = validMsgs.map(m => ({ ...m, room_id: id })); await this.localDB.putAll('messages', messagesWithRoomId); finalMessages = validMsgs; }
            else { await this.localDB.clearRoomMessages(id); }
        } catch (e) { console.error("Fetch error", e); }
        this._dispatch('room_entered', { room: roomData, display, messages: finalMessages });
        this._dispatch('connection_status', { status: 'connecting' });
        await this._initRoomPresence(id); await this._setupChatChannel(id);
        this._dispatch('loading', { active: false });
    }

    async leaveRoom() { this._dispatch('loading', { active: true, text: "Leaving..." }); this.state.currentRoomId = null; this.state.currentRoomData = null; await this._cleanupChannels(true); this._dispatch('connection_status', { status: 'offline' }); this._dispatch('room_left'); this._dispatch('loading', { active: false }); }

    async sendMessage(text) {
        if (!this.state.user || !this.state.currentRoomId || this.state.processingAction) return;
        if (this.state.isOfflineMode) return this._dispatch('notification', { message: "You are offline." });
        if (!this.state.isChatChannelReady) return;
        if (this.state.isCapacityBlocked) return this._dispatch('notification', { message: "Server full." });
        const now = Date.now(); if (now - this.state.lastMessageTime < this.CONFIG.rateLimitMs) return;
        if (!text || text.length > this.CONFIG.maxMessageLength) return this._dispatch('notification', { message: "Message invalid or too long." });
        this.state.processingAction = true; this.state.lastMessageTime = Date.now();
        try { const enc = await this._encryptMessage(text, this.state.currentRoomId); const { error } = await this.db.from('messages').insert([{ room_id: this.state.currentRoomId, user_id: this.state.user.id, user_name: this.state.user.user_metadata?.full_name, content: enc }]).select().single(); if (error) this._dispatch('notification', { message: "Failed to send." }); } catch (err) { this._dispatch('notification', { message: "Send failed." }); }
        this.state.processingAction = false;
    }

    async editMessage(id, newText) {
        if (!this.state.user || !id || !newText) return;
        this._dispatch('loading', { active: true, text: "Saving..." });
        try { const enc = await this._encryptMessage(newText, this.state.currentRoomId); const { error } = await this.db.from('messages').update({ content: enc }).eq('id', id); if (error) this._dispatch('notification', { message: "Failed to edit." }); else this._dispatch('notification', { message: "Message updated." }); } catch (e) { this._dispatch('notification', { message: "Encryption failed." }); }
        this._dispatch('loading', { active: false });
    }

    async deleteMessage(id) {
        if (!this.state.user || !id) return;
        this._dispatch('loading', { active: true, text: "Deleting..." });
        const { error } = await this.db.from('messages').update({ content: '/' }).eq('id', id);
        if (error) this._dispatch('notification', { message: "Failed to delete." });
        this._dispatch('loading', { active: false });
    }

    async loadMoreHistory() {
        if (!this.state.oldestMessageTimestamp || !this.state.currentRoomId || this.state.isLoadingHistory || !this.state.hasMoreHistory) return;
        this.state.isLoadingHistory = true; this._dispatch('history_loading', { loading: true });
        const { data, error } = await this.db.from('messages').select('*').eq('room_id', this.state.currentRoomId).lt('created_at', this.state.oldestMessageTimestamp).order('created_at', { ascending: false }).limit(this.CONFIG.historyLoadLimit);
        if (error || !data || data.length === 0) { this.state.hasMoreHistory = false; this.state.isLoadingHistory = false; this._dispatch('history_loaded', { messages: [], hasMore: false }); return; }
        data.reverse();
        try {
            const res = await this._workerExec('decryptHistory', { messages: data, keyId: this.state.currentRoomId });
            const validMsgs = res.results.filter(m => !m.error);
            if (validMsgs.length > 0) { this.state.oldestMessageTimestamp = validMsgs[0].created_at; await this.localDB.putAll('messages', validMsgs.map(m => ({ ...m, room_id: this.state.currentRoomId }))); this._dispatch('history_loaded', { messages: validMsgs, hasMore: true }); }
        } catch (e) {}
        this.state.isLoadingHistory = false;
    }

    // --- Room Settings & Info API ---

    async getRoomEditData(roomId) {
        if (!roomId) return null;
        const room = await this.localDB.get('rooms', roomId) || this.state.currentRoomData;
        if (!room) return null;
        
        const isOwner = room.created_by === this.state.user.id;
        const resolvedUsers = [];
        if (room.allowed_users && !room.allowed_users.includes('*')) {
            for (const uid of room.allowed_users) {
                const p = await this.getProfile(uid);
                resolvedUsers.push({ id: uid, name: p?.full_name || 'Unknown', avatar: p?.avatar_url });
            }
        }

        return {
            id: room.id,
            name: room.name,
            is_direct: room.is_direct,
            is_visible: room.is_visible,
            has_password: room.has_password,
            isOwner: isOwner,
            allowed_users: resolvedUsers // Resolved names/avatars for UI
        };
    }

    async saveRoomSettings(roomId, settings) {
        if (this.state.processingAction) return;
        this.state.processingAction = true;
        const { name, isVisible, newPassword, removePassword, allowedUserIds } = settings;
        
        if (!name) { this._dispatch('notification', { message: "Name required." }); this.state.processingAction = false; return; }
        
        const room = this.state.currentRoomData; 
        const isChangingPass = newPassword && newPassword.length > 0; 
        const isRemovingPass = removePassword;
        
        this._dispatch('loading', { active: true, text: "Saving..." });
        const updates = { name, is_visible: isVisible, allowed_users: allowedUserIds };
        if (isRemovingPass) updates.has_password = false; 
        else if (isChangingPass) updates.has_password = true;
        
        const { error: updateError } = await this.db.from('rooms').update(updates).eq('id', roomId);
        if (updateError) { this._dispatch('notification', { message: "Save failed." }); this._dispatch('loading', { active: false }); this.state.processingAction = false; return; }
        
        if (isRemovingPass) { 
            await this.db.rpc('set_room_password', { p_room_id: roomId, p_hash: null }); 
            if(this.state.currentRoomData) this.state.currentRoomData.has_password = false; 
        }
        else if (isChangingPass) { 
            const roomSalt = room.salt; 
            const accessHash = await this._sha256(newPassword + roomSalt); 
            await this.db.rpc('set_room_password', { p_room_id: roomId, p_hash: accessHash }); 
            if(this.state.currentRoomData) this.state.currentRoomData.has_password = true; 
        }
        
        const { data: updatedRoom } = await this.db.from('rooms').select('*').eq('id', roomId).single();
        if(updatedRoom) {
            await this.localDB.put('rooms', updatedRoom);
            this.state.currentRoomData = updatedRoom; 
            const display = await this._resolveRoomDisplay(updatedRoom);
            this._dispatch('room_updated', { room: updatedRoom, display });
        }
        this._dispatch('notification', { message: "Saved." });
        
        this.state.processingAction = false; this._dispatch('loading', { active: false });
    }

    async deleteRoom(roomId) { 
        if (!roomId) return; 
        this._dispatch('loading', { active: true, text: "Deleting..." }); 
        const { error } = await this.db.from('rooms').delete().eq('id', roomId); 
        if (error) { this._dispatch('notification', { message: "Delete failed." }); this._dispatch('loading', { active: false }); return; } 
        this._dispatch('notification', { message: "Deleted." }); 
        this.state.currentRoomId = null; this.state.currentRoomData = null; 
        await this.localDB.delete('rooms', roomId);
        this._dispatch('room_left'); 
        this.loadRooms(); 
        this._dispatch('loading', { active: false }); 
    }
}
