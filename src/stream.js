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
    if (width > MAX_WIDTH) { height = Math.round(height * MAX_WIDTH / width); width = MAX_WIDTH; }
    const s = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: src.id,
          maxWidth: width, maxHeight: height,
          minWidth: Math.min(width, 640), minHeight: Math.min(height, 360),
          maxFrameRate: 30,
        },
      },
    });
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
    if (pc) { pc.close(); pc = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    sender = null;
    pendingIce = [];
  }

  host.onSessionStart(async (displayId) => {
    stopSession();
    quality = 'high';
    try {
      stream = await captureDisplay(displayId);
    } catch (e) {
      console.error(e);
      host.sendSignal({ type: 'error', message: `Host không chụp được màn hình: ${e.message}` });
      return;
    }

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
    try {
      const next = await captureDisplay(displayId);
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

  host.onSessionEnd(stopSession);
})();
