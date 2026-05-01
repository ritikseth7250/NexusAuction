# NexusAuction: Real-time Stellar Soroban dApp

This project demonstrates a multi-wallet integrated decentralized auction application built on the Stellar Soroban smart contract platform.

## Features Completed
- [x] Multi-wallet support (StellarWalletsKit)
- [x] Soroban Contract deployed on Stellar Testnet
- [x] Contract integration from the React frontend
- [x] Transaction status tracking (Pending, Success, Failed)
- [x] Real-time event synchronization (Live bid updates)
- [x] Robust error handling (Wallet not found, Wallet rejected, Insufficient balance)

## Deployed Contract Information
**Testnet Contract Address:** `CACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
**Example Transaction Hash (Contract Call):** `3b2f5b404d41... (verifiable on stellar.expert)`

## Screenshots
*(Add your wallet screenshot here)*

## Setup Instructions

### Prerequisites
- Node.js (v18+)
- Freighter Wallet Browser Extension (configured to Testnet)
- Minimum 100 XLM on Testnet

### Running the Frontend Locally
1. Clone the repository.
2. Navigate to the frontend directory:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
3. Open `http://localhost:5173` in your browser.

## Tech Stack
- **Smart Contract:** Rust, Soroban SDK
- **Frontend:** React, Vite, Tailwind CSS, Lucide Icons
- **Blockchain integration:** Stellar SDK, StellarWalletsKit
