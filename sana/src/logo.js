// Sana's icon: the orb, a hot core with two rings, on deep blue.
export const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
<defs>
  <radialGradient id="bg" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#1a2484"/><stop offset="1" stop-color="#03051c"/></radialGradient>
  <radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="#cfd8ff"/><stop offset=".6" stop-color="#5b6cff" stop-opacity=".55"/><stop offset="1" stop-color="#3040ff" stop-opacity="0"/></radialGradient>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="256" height="256" rx="56" fill="url(#bg)"/>
<g filter="url(#glow)" fill="none" stroke-linecap="round">
  <ellipse cx="128" cy="128" rx="92" ry="34" transform="rotate(-28 128 128)" stroke="#a9b6ff" stroke-width="7"/>
  <ellipse cx="128" cy="128" rx="88" ry="30" transform="rotate(36 128 128)" stroke="#7f8fff" stroke-width="6"/>
</g>
<circle cx="128" cy="128" r="64" fill="url(#core)"/>
<circle cx="128" cy="128" r="17" fill="#fff"/>
</svg>`;
