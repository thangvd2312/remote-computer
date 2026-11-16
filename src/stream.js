// Chụp màn hình + gửi qua WebRTC tới viewer. Signaling đi qua main process (IPC) -> WebSocket.
(() => {
  const QUALITY = {
    high:   { maxBitrate: 15_000_000, scaleResolutionDownBy: 1,   maxFramerate: 30 },
    medium: { maxBitrate: 6_000_000,  scaleResolutionDownBy: 1.5, maxFramerate: 30 },
    low:    { maxBitrate: 2_000_000,  scaleResolutionDownBy: 2,   maxFramerate: 20 },
  };
  const MAX_WIDTH = 2560; // giới hạn độ phân giải capture (màn Retina rất lớn, tốn CPU encode)

  let pc = null;
  let stream = null;
  let sender = null;
  let quality = 'high';
  let pendingIce = [];

  async function captureDisplay(displayId) {
    const src = await host.getSource(displayId);
    let { width, height } = src;
    const mandatory = { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id, maxFrameRate: 30 };
    // width/height = 0: host không biết kích thước (máy khoá, màn hình tắt) -> KHÔNG đặt giới hạn,
    // để hệ thống chụp theo độ phân giải thật (đặt 0×0 thì macOS từ chối tạo luồng chụp)
    if (width > 0 && height > 0) {
      if (width > MAX_WIDTH) { height = Math.round(height * MAX_WIDTH / width); width = MAX_WIDTH; }
      Object.assign(mandatory, {
        maxWidth: width, maxHeight: height,
        minWidth: Math.min(width, 640), minHeight: Math.min(height, 360),
      });
    }
    const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory } });
    s.getVideoTracks()[0].contentHint = 'detail'; // ưu tiên chữ sắc nét thay vì chuyển động mượt
    return s;
  }

  async function applyQuality() {
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    Object.assign(params.encodings[0], QUALITY[quality] || QUALITY.high);
    params.degradationPreference = 'maintain-resolution';
    try { await sender.setParameters(params); } catch (e) { console.warn('setParameters', e); }
  }

  function stopSession() {
    stopSnapshot();
    if (pc) { pc.close(); pc = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    sender = null;
    pendingIce = [];
  }

  // ---------------- Chế độ dự phòng: ảnh chụp liên tục ----------------
  // macOS: máy khoá + màn hình đã tắt thì luồng chụp trực tiếp không khởi động được nữa
  // ("Could not start video source", ScreenCaptureKit báo kích thước 0×0) cho tới khi mở khoá,
  // kể cả khi đã đánh thức màn hình. Ảnh chụp tĩnh (thumbnail) thì vẫn chụp được màn hình khoá
  // -> vẽ liên tục lên canvas rồi gửi canvas như video (~5 hình/giây, đủ để nhìn & gõ mật khẩu).
  // Trong lúc đó cứ vài giây thử lại luồng trực tiếp; được thì tự chuyển sang (sau khi mở khoá).
  const SNAP_INTERVAL_MS = 200;
  const SNAP_MAX_WIDTH = 1600;
  const LIVE_RETRY_MS = 4000;
  let snap = null;          // { displayId, canvas, ctx, stopped }
  let liveTimer = null;
  let currentDisplayId = null;

  async function drawSnapshot(s) {
    const res = await host.getSnapshot(s.displayId, SNAP_MAX_WIDTH);
    if (!res || s.stopped) return false;
    const bmp = await createImageBitmap(new Blob([res.jpeg], { type: 'image/jpeg' }));
    if (s.canvas.width !== bmp.width || s.canvas.height !== bmp.height) {
      s.canvas.width = bmp.width;
      s.canvas.height = bmp.height;
    }
    s.ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return true;
  }

  async function startSnapshot(displayId) {
    const canvas = document.createElement('canvas');
    const s = { displayId, canvas, ctx: canvas.getContext('2d'), stopped: false };
    if (!(await drawSnapshot(s))) throw new Error('không chụp được ảnh màn hình');
    const out = canvas.captureStream(1000 / SNAP_INTERVAL_MS);
    out.getVideoTracks()[0].contentHint = 'detail';
    (async () => {
      while (!s.stopped) {
        const t0 = performance.now();
        try { await drawSnapshot(s); } catch (e) { console.warn('[snapshot]', e.message); }
        await new Promise((r) => setTimeout(r, Math.max(30, SNAP_INTERVAL_MS - (performance.now() - t0))));
      }
    })();
    snap = s;
    console.log('[capture] chuyển sang chế độ ảnh chụp (máy đang khoá / màn hình tắt)');
    return out;
  }

  function stopSnapshot() {
    if (snap) snap.stopped = true;
    snap = null;
    clearTimeout(liveTimer);
    liveTimer = null;
  }

  // Đang ở chế độ ảnh chụp -> định kỳ thử lại luồng trực tiếp
  function scheduleLiveRetry(seq) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      if (!snap || seq !== sessionSeq || !sender) return;
      try {
        const live = await captureDisplay(currentDisplayId);
        if (!snap || seq !== sessionSeq || !sender) { live.getTracks().forEach((t) => t.stop()); return; }
        await sender.replaceTrack(live.getVideoTracks()[0]);
        const old = stream;
        stream = live;
        stopSnapshot();
        if (old) old.getTracks().forEach((t) => t.stop());
        await applyQuality();
        console.log('[capture] đã chuyển lại hình trực tiếp');
        host.sendSignal({ type: 'notice', message: 'Đã chuyển sang hình trực tiếp' });
      } catch {
        scheduleLiveRetry(seq);
      }
    }, LIVE_RETRY_MS);
  }

  // Thử luồng trực tiếp (thêm 1 lần sau khi đánh thức màn hình); không được thì dùng ảnh chụp
  async function startCapture(displayId, seq) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await captureDisplay(displayId);
      } catch (e) {
        console.warn(`[capture] lần ${attempt} lỗi: ${e.message}`);
        if (seq !== sessionSeq) throw e;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    const s = await startSnapshot(displayId);
    host.sendSignal({ type: 'notice', message: 'Máy host đang khoá — hình cập nhật chậm, đủ để nhập mật khẩu' });
    return s;
  }

  let sessionSeq = 0;
  host.onSessionStart(async (displayId) => {
    stopSession();
    quality = 'high';
    currentDisplayId = displayId;
    const seq = ++sessionSeq;
    try {
      stream = await startCapture(displayId, seq);
    } catch (e) {
      console.error(e);
      if (seq === sessionSeq) host.sendSignal({ type: 'error', message: `Host không chụp được màn hình: ${e.message}` });
      return;
    }
    if (seq !== sessionSeq) { stream.getTracks().forEach((t) => t.stop()); stream = null; stopSnapshot(); return; }

    pc = new RTCPeerConnection({ iceServers: [] }); // cùng mạng Tailscale/LAN: không cần STUN/TURN
    const thisPc = pc;
    pc.onicecandidate = (e) => { if (e.candidate && pc === thisPc) host.sendSignal({ type: 'ice', candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => console.log('[webrtc]', thisPc.connectionState);

    const transceiver = pc.addTransceiver(stream.getVideoTracks()[0], { direction: 'sendonly', streams: [stream] });
    sender = transceiver.sender;

    // Ưu tiên H.264 (thường có tăng tốc phần cứng), sau đó VP9/VP8
    const caps = RTCRtpSender.getCapabilities('video');
    if (caps && transceiver.setCodecPreferences) {
      const rank = (c) => (/h264/i.test(c.mimeType) ? 0 : /vp9/i.test(c.mimeType) ? 1 : /vp8/i.test(c.mimeType) ? 2 : 3);
      transceiver.setCodecPreferences([...caps.codecs].sort((a, b) => rank(a) - rank(b)));
    }

    await applyQuality();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    host.sendSignal({ type: 'offer', sdp: pc.localDescription.toJSON() });
    if (snap) scheduleLiveRetry(seq);
  });

  host.onSignal(async (msg) => {
    if (!pc) return;
    if (msg.type === 'answer') {
      await pc.setRemoteDescription(msg.sdp);
      for (const c of pendingIce) await pc.addIceCandidate(c).catch(() => {});
      pendingIce = [];
    } else if (msg.type === 'ice' && msg.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(msg.candidate).catch(() => {});
      else pendingIce.push(msg.candidate);
    }
  });

  host.onSwitchDisplay(async (displayId) => {
    if (!sender) return;
    currentDisplayId = displayId;
    if (snap) { snap.displayId = displayId; return; } // chế độ ảnh chụp: chỉ cần đổi màn hình nguồn
    try {
      let next;
      try {
        next = await captureDisplay(displayId);
      } catch (e) {
        console.warn('[capture] đổi màn hình lỗi, dùng ảnh chụp:', e.message);
        next = await startSnapshot(displayId);
        scheduleLiveRetry(sessionSeq);
      }
      await sender.replaceTrack(next.getVideoTracks()[0]);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = next;
      await applyQuality();
    } catch (e) {
      console.error('switch display', e);
    }
  });

  host.onQuality(async (level) => {
    if (!QUALITY[level]) return;
    quality = level;
    await applyQuality();
  });

  host.onSessionEnd(() => { sessionSeq++; stopSession(); });
})();
