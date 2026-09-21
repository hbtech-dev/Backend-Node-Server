# Backend Workspace Rules

## Core System Integrations Stability Rule
- **DHL API Integration & Shipment Generation**: Do NOT modify, alter, or refactor the working DHL shipment creation, ISO-3 country mapping, non-EU customs payload logic in `dhl.service.js` or `dhl.controller.js` without explicit user instruction.
- **Temu Order Sync & Tracking Upload**: Do NOT modify, alter, or refactor `temuSync.service.js` (including clean order SN formatting `192-xxxx` and `bg.logistics.shipment.create` endpoint sequence) without explicit user instruction.
- **Revert to Open Orders Logic**: Preserve the `manuallyRevertedToOpen` flag and exact reversion handlers across frontend and backend.
