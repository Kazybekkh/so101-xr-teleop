# Cloudflare camera publisher

This is the recovered Python WebRTC publisher, not the newer Quest-only MJPEG
server. It sends a camera track or generated test pattern to Cloudflare Realtime
and prints a QR code and a complete Zapbox viewer URL.

```bash
python3 -m venv broadcaster/.venv
broadcaster/.venv/bin/python -m pip install -r broadcaster/requirements.txt
cp broadcaster/.env.example broadcaster/.env
# Configure your Cloudflare app and the HTTPS operator URL.
broadcaster/.venv/bin/python broadcaster/main.py
```

Run commands from the repository root. Use the same Cloudflare app for this
publisher and `operator/.env.local`. The copied example contains no credentials.
The example defaults to a generated pattern; choose the camera source explicitly
and set `USE_TEST_PATTERN=false` for camera capture. Set `VIEWER_STEREO=mono` for a
normal single camera, or `sbs` for a real side-by-side stereo image.

Set `BRIDGE_URL=wss://your-bridge-host:8765` to include robot control in the link,
or leave it empty for video only. The link includes `session`, `track`, `stereo`,
and optional `bridge`, matching the recovered operator viewer. Cloudflare carries
video; controller packets go directly to the Python bridge over WebSocket.

No camera capture or Cloudflare publishing was run during consolidation.
