# Third-party notices

LifeHub itself is released under the MIT License (see `LICENSE`). The files below are adapted from other projects and remain under their original licenses.

## React Bits — MIT + Commons Clause

- Project: <https://reactbits.dev> · <https://github.com/DavidHDev/react-bits> — © David Haz
- Used in:
  - `app/static/vendor/aurora.js` — the Aurora background, ported from React/OGL to plain WebGL2 (shader unchanged).
  - `app/static/vendor/borderglow.css`, `app/static/vendor/borderglow.js` — the BorderGlow card (CSS unchanged apart from removing the light variant; pointer tracking rewritten without React).
  - The checkbox in `app/static/app.css` is modelled on the SpringCheck component.
- The Commons Clause restricts **selling** these components themselves (for example as part of a paid component library). Using them inside an application, as this project does, is allowed. If you redistribute LifeHub commercially, read the React Bits license first.

## Theme Switch — Apache License 2.0

- Project: GUI Challenges by Adam Argyle / Google Chrome Labs — <https://github.com/GoogleChromeLabs/gui-challenges>, article: <https://web.dev/articles/building/a-theme-switch-component>
- Used in: `app/static/vendor/theme-toggle.css` and the sun/moon SVG in `app/static/index.html`.
- Changes: selectors adapted to this project, easing curves inlined instead of Open Props variables.
- License text: <https://www.apache.org/licenses/LICENSE-2.0>

## Animated Theme Toggler — MIT

- Project: Magic UI — <https://magicui.design>
- The circular-reveal theme transition in `app/static/app.js` (`toggleTheme`) follows the same technique (View Transitions API + `clip-path`). No code was copied.

## Fonts

Inter and Noto Sans TC are loaded from Google Fonts at runtime (SIL Open Font License 1.1). They are not bundled in this repository.
