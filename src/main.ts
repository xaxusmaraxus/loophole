import { TIERS } from './puzzle/tiers';

// Placeholder entry point: lists the merge ladder until the board exists.
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <h1>Coaster Merge</h1>
  <ol>${TIERS.map((t) => `<li>${t.name}</li>`).join('')}</ol>
`;
