import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";

/** Camera QR scanner. Browsers only allow the camera on https or localhost. */
export function QrScan({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!video.current) return;
    const scanner = new QrScanner(
      video.current,
      (result) => {
        scanner.stop();
        onResult(result.data);
      },
      { returnDetailedScanResult: true, highlightScanRegion: true }
    );
    scanner.start().catch(() =>
      setProblem(
        window.isSecureContext
          ? "Camera access was blocked. Allow it in your browser, or paste the link instead."
          : "The camera only works on https or localhost. Paste the link instead, or scan with your phone's camera app."
      )
    );
    return () => {
      scanner.stop();
      scanner.destroy();
    };
  }, [onResult]);

  return (
    <div className="scanner">
      {problem ? <p className="note">{problem}</p> : <video ref={video} muted playsInline />}
      <button type="button" className="quiet" onClick={onClose}>Close camera</button>
    </div>
  );
}
