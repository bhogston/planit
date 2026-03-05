# Planit

A visual factory planner for [Satisfactory](https://www.satisfactorygame.com/), built with React and Vite.

## Features

- **Drag-and-drop canvas** — place and arrange buildings on a grid
- **Belt routing** — orthogonal belt connections with automatic obstacle avoidance and animated flow
- **Full building catalog** — extraction, production, logistics, storage, power, and special buildings
- **Belt marks Mk.1–6** — color-coded belts with correct speed limits (60–1200 items/min)
- **Recipe support** — assign recipes to production buildings with clock speed control
- **Miner configuration** — set node purity (impure/normal/pure) and clock speed per miner
- **Output rate display** — live items/min shown on belts based on building and recipe settings

## Getting Started

```bash
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

## Build

```bash
npm run build
```

## Tech Stack

- [React 18](https://react.dev/)
- [Vite 5](https://vitejs.dev/)
