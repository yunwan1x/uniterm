# RDP floating keyboard

The status-bar keyboard button toggles one floating keyboard per RDP panel.
The fullscreen toolbar controls the same visibility state. Closing hides the
whole panel; expanding/collapsing changes only its compact/full layout.

- Compact strip: modifiers, Esc/Tab and common complete chords.
- Expanded layout: function, number, letter, punctuation and navigation keys.
- Tap a modifier to apply it once; hold 500 ms to keep it selected for repeated
  virtual chords. Tap again to clear. Each chord is still a balanced remote
  press/release transaction: selected modifiers are never held on the server
  between clicks. Physical keyboard behavior is unchanged.
- Explicit shortcuts send their own complete chord and clear virtual modifiers.
- Close, collapse, disabled connection, window blur, hidden document or hidden
  session clear virtual modifier selections. Unmount releases input too.
- Drag the grip or empty header; a focused grip also accepts arrow keys.
  Position is clamped within the panel and stored as normalized coordinates in
  localStorage. Key states and visibility are not persisted.
- The overlay does not resize the remote framebuffer or intercept pointer input
  outside itself. Narrow displays can horizontally scroll the keys; existing
  mobile system-keyboard controls remain available.

Verification: unit tests cover balanced scancodes, one-shot/locked modifiers,
full letter coverage and drag bounds. Browser tests use the real Vue keyboard
and status-button components in an isolated harness: open/close, expansion,
chords, long press, collapse clearing, dragging, stored positions, disabled
keys, blur/hidden-session clearing and a 390px viewport. This does not claim a
new end-to-end Windows RDP test. Production frontend build passes. The wider
repository has pre-existing type errors; no errors were reported for the new
keyboard files or RDPTabContent in the typecheck output.
