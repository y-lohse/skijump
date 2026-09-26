# Flight Line — throwaway ski-jump prototype

## Run

```sh
npm start
```

Requires Python 3 and npm; **no npm install needed**. Open http://localhost:8080.
Alternatively run `python3 -m http.server 8080` directly, or open `index.html` in a browser.

For a phone on the same Wi-Fi, open `http://<your-computer-LAN-IP>:8080`.
The development server listens on the local network; stop it with Ctrl+C when done.

## Play

- Hold the bottom zone to start the run. Watch the position dot approach the orange edge.
- Takeoff happens automatically at the edge. Swipe upward through the edge without stopping or releasing. Only movement in the final second counts (or since your swipe began, if later).
- Power = distance × vertical straightness × speed. Distance credit caps at ¾ of screen height; longer swipes remain valid. Sideways motion and reversals reduce precision. Duration includes pauses through takeoff, with full speed credit at 0.2 seconds or faster. No recent upward swipe means no jump power.
- Your held finger immediately becomes the flight input; ski opening smoothly follows its height. There is no center target or pause-to-jump gesture.
- Up opens the skis for lift. Left/right steers yaw; center stops steering, not existing yaw. Counter the wind smoothly.
- Before landing, move down to close the skis and correct yaw. Lift, then tap at ground contact (±150 ms). Only the first tap counts.
- Landing above 9° yaw or 5.6° total V opening causes a fall. Missing the tap alone does not.
- Replay generates new wind. Mouse drag/release/click works too.

Scoring is explicitly simplified: K120 distance points, a landing/style proxy out of 60, and time-averaged head/tailwind compensation. Each result shows the arithmetic. There is no gate compensation or persistence. Distance uses horizontal metres rather than a surveyed hill profile.

`game.js` contains the controls, tunable physics, scoring and Canvas perspective renderer; `style.css` contains the portrait HUD. No external runtime libraries, assets or services.
