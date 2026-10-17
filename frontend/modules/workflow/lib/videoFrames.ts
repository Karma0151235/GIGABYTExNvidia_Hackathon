// Sample a few stills from the displayed MP4 for VLM servers that reject video_url.
export async function sampleVideoFrames(blob: Blob): Promise<{
  image_id: string;
  kind: "other";
  media_type: "image/jpeg";
  data_base64: string;
}[]> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Video metadata timed out.")), 10000);
      video.onloadedmetadata = () => { window.clearTimeout(timer); resolve(); };
      video.onerror = () => { window.clearTimeout(timer); reject(new Error("Responder video could not be decoded.")); };
      video.load();
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
      throw new Error("Responder video has no decodable frames.");
    }

    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Video frame capture is unavailable.");

    const frames = [];
    for (const [index, fraction] of [0.1, 0.35, 0.6, 0.85].entries()) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Video frame capture timed out.")), 10000);
        video.onseeked = () => { window.clearTimeout(timer); resolve(); };
        video.onerror = () => { window.clearTimeout(timer); reject(new Error("Responder video frame could not be decoded.")); };
        video.currentTime = Math.min(video.duration - 0.01, Math.max(0.01, video.duration * fraction));
      });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({
        image_id: `video-frame-${index + 1}`,
        kind: "other" as const,
        media_type: "image/jpeg" as const,
        data_base64: canvas.toDataURL("image/jpeg", 0.82).split(",", 2)[1],
      });
    }
    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
